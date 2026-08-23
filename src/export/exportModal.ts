// ─────────────────────────────────────────
// Novels Note JP — Export モーダル
//
// 【2026-08 一本化】
// かつては「登録済み原稿クリーニング定義」と「従来のExport詳細設定」の
// 2系統が併存していたが、後者は処理内容が不透明でユーザーの
// 混乱を招くため廃止した。Export処理は必ず
// ManuscriptRulesDefinition（登録済み定義ファイル、または
// 未登録時は組み込みのデフォルト定義）を経由する単一の経路のみを持つ。
// ─────────────────────────────────────────

import { App, Modal, Setting, TFile, Notice, normalizePath, ConfirmationModal } from "obsidian";
import { NovelsNoteSettings } from "../settings";
import type { ManuscriptRulesDefinition } from "../manuscript-rules/types/rules";
import { cleanManuscript } from "../manuscript-rules/cleaner/manuscriptCleaner";
import { createDefaultManuscriptRulesDefinition } from "../manuscript-rules/rules/ruleDefaults";
import { readRuleFile, ManuscriptRulesFileError } from "../manuscript-rules/adapter/pluginRuleStore";
import { ExportFormat, makeExportFilename } from "./exporter";

/** 定義ファイルが1件も登録されていない場合に使う、組み込みのデフォルト定義。 */
const BUILT_IN_DEFAULT_LABEL = "組み込みの初期設定";

// ─────────────────────────────────────────
// 出力ファイル名の検証
//
// UI上の説明では「Vault ルート直下」に保存すると案内しているが、
// normalizePath() は入力の正規化を行うだけで、Vaultルート直下への
// 制限やパストラバーサル対策を保証するものではない
// （".." やサブフォルダを含む相対パスもそのまま通過しうる）。
// そのため、ここでは仕様どおり「ルート直下のファイル名のみ」を
// 明示的に検証する： "/"・"\"・".."・制御文字・空文字を拒否し、
// 拡張子は選択した出力形式（txt / md）のみを許可する。
// ─────────────────────────────────────────
function validateExportFileName(rawName: string, format: ExportFormat): string | null {
  const name = rawName.trim();
  if (!name) return "出力ファイル名を入力してください。";
  if (name.includes("/") || name.includes("\\")) {
    return "出力ファイル名にフォルダ区切り文字（/ や \\）は使用できません（Vault ルート直下にのみ保存できます）。";
  }
  if (name === "." || name === ".." || name.includes("..")) {
    return "出力ファイル名が不正です。";
  }
  // eslint-disable-next-line no-control-regex -- ファイル名に制御文字が含まれていないか検証するため意図的に制御文字コード範囲(\x00-\x1f)を使用
  if (/[\x00-\x1f]/.test(name)) {
    return "出力ファイル名に制御文字は使用できません。";
  }
  const expectedExt = `.${format}`;
  if (!name.toLowerCase().endsWith(expectedExt)) {
    return `出力ファイル名の拡張子は ${expectedExt} にしてください。`;
  }
  if (name === expectedExt) {
    return "出力ファイル名を入力してください。";
  }
  return null;
}

export class ExportModal extends Modal {
  private sourceFile: TFile | null;
  private sourceText: string = "";
  private format: ExportFormat = "txt";
  private previewEl!: HTMLElement;
  private fileNameEl!: HTMLInputElement;
  private rulesStatusEl!: HTMLElement;

  /** プラグイン設定全体（登録済み原稿クリーニング定義の参照用） */
  private settings: NovelsNoteSettings;
  /** プラグイン専用フォルダのパス（定義ファイルの実体はこの配下 rules/ にある） */
  private pluginDir: string;

  /** 現在選択中の定義ファイル名（空文字＝組み込みのデフォルト定義を使う） */
  private selectedRulesFileName: string;
  /** 選択中の定義の読み込み結果（読み込みに失敗している間は null） */
  private selectedRulesDef: ManuscriptRulesDefinition | null = null;

  // ─────────────────────────────────────────
  // 世代管理（非同期競合対策）
  //
  // ドロップダウンで定義を切り替えるたびに applyRulesSelection() が
  // 非同期でファイルを読み込むが、先に選択した定義Aの読み込みが
  // 遅れて完了すると、後から選択した定義Bの結果を上書きしてしまう
  // おそれがある。呼び出しごとに世代番号を発行し、await後に
  // 「自分が最新の呼び出しか」を確認してから状態を更新することで、
  // 古い結果による上書きを防ぐ。
  // ─────────────────────────────────────────
  private rulesSelectionGeneration = 0;

  constructor(app: App, activeFile: TFile | null, settings: NovelsNoteSettings, pluginDir: string) {
    super(app);
    this.sourceFile = activeFile;
    this.settings = settings;
    this.pluginDir = pluginDir;
    this.selectedRulesFileName = settings.defaultManuscriptRulesFileName ?? "";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nn-export-modal");

    // ── タイトル ──────────────────────────────────
    contentEl.createEl("h2", { text: "原稿 Export" });

    // ── ソースファイル情報 ────────────────────────
    if (this.sourceFile) {
      await this.loadSourceFile(this.sourceFile);
      contentEl.createEl("p", {
        text: `対象ファイル：${this.sourceFile.path}`,
        cls: "nn-export-filepath",
      });
    } else {
      contentEl.createEl("p", {
        text: "⚠️ 開いているファイルがありません。先に .txt または .md ファイルを開いてください。",
        cls: "nn-export-filepath nn-export-no-file",
      });
      return;
    }

    const settingsEl = contentEl.createDiv({ cls: "nn-export-settings" });

    // ── 使用する原稿クリーニング定義 ──────────────────────
    // レイアウト：上段「タイトル＋ドロップダウン」／中段「説明文」／
    // 下段「選択済み定義ファイル」。標準の Setting レイアウトのままだと
    // ドロップダウンの選択肢文言が長く、説明文の領域が圧迫されて
    // 読みづらくなるため、setDesc() で作られる descEl を下段へ移動し、
    // 選択済み定義ファイルの表示もさらにその下へ並べる
    // （設定画面「原稿クリーニング定義」と同じ調整方針）。
    const rulesFiles = this.settings.manuscriptRulesFiles ?? [];
    const rulesEl = settingsEl.createDiv({ cls: "nn-export-rules-select" });
    const rulesSetting = new Setting(rulesEl)
      .setName("使用する原稿クリーニング定義")
      .setDesc(
        rulesFiles.length > 0
          ? "この原稿をExportする際に適用するクリーニングルールです。設定画面「原稿クリーニング定義」で編集・追加できます。"
          : `定義ファイルが未登録のため、${BUILT_IN_DEFAULT_LABEL}を使用します。設定画面「原稿クリーニング定義」から編集用のファイルを作成できます。`
      )
      .addDropdown(drop => {
        drop.addOption("", BUILT_IN_DEFAULT_LABEL);
        for (const f of rulesFiles) {
          drop.addOption(f.fileName, f.label ? `${f.label}（${f.fileName}）` : f.fileName);
        }
        drop.setValue(this.selectedRulesFileName);
        drop.onChange(value => {
          this.selectedRulesFileName = value;
          void this.applyRulesSelection();
        });
      });

    rulesSetting.settingEl.addClass("nn-setting-balanced");
    rulesSetting.descEl.addClass("nn-setting-fullwidth-desc");
    rulesSetting.settingEl.appendChild(rulesSetting.descEl);

    this.rulesStatusEl = rulesSetting.settingEl.createEl("p", {
      cls: "nn-export-rules-status nn-setting-fullwidth-desc",
    });

    // ── 出力形式 ──────────────────────────────────
    new Setting(settingsEl)
      .setName("出力形式")
      .addDropdown(drop =>
        drop
          .addOption("txt", ".txt（プレーンテキスト）")
          .addOption("md", ".md（Markdown）")
          .setValue(this.format)
          .onChange(value => {
            this.format = value as ExportFormat;
            this.updateFileNameSuggestion();
          })
      );

    // ── 出力ファイル名 ────────────────────────────
    new Setting(settingsEl)
      .setName("出力ファイル名")
      .setDesc("Vault 内に保存されます（Vault ルート直下）")
      .addText(text => {
        this.fileNameEl = text.inputEl;
        text.inputEl.addClass("nn-export-filename-input");
        text.setValue(makeExportFilename(this.sourceFile!.name, this.format));
      });

    // ── プレビューエリア ──────────────────────────
    const previewWrap = contentEl.createDiv({ cls: "nn-export-preview-wrap" });
    previewWrap.createEl("p", {
      text: "プレビュー（変換後の本文・先頭2000字）",
      cls: "nn-export-preview-label",
    });
    this.previewEl = previewWrap.createEl("pre", { cls: "nn-export-preview" });

    // 定義を読み込んでからプレビューを表示する
    await this.applyRulesSelection();

    // ── ボタンエリア ──────────────────────────────
    const btnArea = contentEl.createDiv({ cls: "nn-export-buttons" });

    const exportBtn = btnArea.createEl("button", { text: "Export する", cls: "mod-cta" });
    exportBtn.addEventListener("click", () => { void this.doExport(); });

    const cancelBtn = btnArea.createEl("button", { text: "キャンセル" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void { this.contentEl.empty(); }

  // ─────────────────────────────────────────
  // 定義の選択が変わったときの処理
  // 空選択（＝組み込みのデフォルト定義）の場合はVaultアクセスなしで即座に確定する。
  // ─────────────────────────────────────────
  private async applyRulesSelection(): Promise<void> {
    // この呼び出し自身の世代番号を発行する。
    // await の後にこの番号が最新（=this.rulesSelectionGenerationと一致）
    // でなければ、その間に別の選択が行われたということなので、
    // 自分の結果は古いとみなして状態の更新を破棄する。
    const myGeneration = ++this.rulesSelectionGeneration;

    if (!this.selectedRulesFileName) {
      if (myGeneration !== this.rulesSelectionGeneration) return;
      this.selectedRulesDef = createDefaultManuscriptRulesDefinition();
      if (this.rulesStatusEl) {
        this.rulesStatusEl.setText(`✓ ${BUILT_IN_DEFAULT_LABEL}を使用します。`);
        this.rulesStatusEl.removeClass("nn-export-rules-error");
      }
      this.updatePreview();
      return;
    }

    try {
      const def = await readRuleFile(this.app, this.pluginDir, this.selectedRulesFileName);
      if (myGeneration !== this.rulesSelectionGeneration) return; // 古い結果は破棄
      this.selectedRulesDef = def;
      if (this.rulesStatusEl) {
        this.rulesStatusEl.setText(`✓ ${this.selectedRulesFileName} を使用します。`);
        this.rulesStatusEl.removeClass("nn-export-rules-error");
      }
    } catch (e) {
      if (myGeneration !== this.rulesSelectionGeneration) return; // 古い結果は破棄
      this.selectedRulesDef = null;
      const message = e instanceof ManuscriptRulesFileError ? e.message : String(e);
      if (this.rulesStatusEl) {
        this.rulesStatusEl.setText(`⚠️ 定義ファイルを読み込めませんでした：${message}`);
        this.rulesStatusEl.addClass("nn-export-rules-error");
      }
      new Notice(`定義ファイルを読み込めませんでした：${message}`);
    }

    this.updatePreview();
  }

  // ─────────────────────────────────────────
  // 変換本体（常に manuscript-rules エンジンを経由する）
  // ─────────────────────────────────────────
  private convert(): string | null {
    if (!this.selectedRulesDef) return null;
    return cleanManuscript(this.sourceText, this.selectedRulesDef.rules, this.settings.rubyStyle);
  }

  private async loadSourceFile(file: TFile): Promise<void> {
    this.sourceText = await this.app.vault.read(file);
  }

  private updatePreview(): void {
    if (!this.previewEl || !this.sourceText) return;
    const converted = this.convert();
    if (converted === null) {
      this.previewEl.textContent = "（定義ファイルを読み込めなかったため、プレビューできません）";
      return;
    }
    const PREVIEW_LIMIT = 2000;
    this.previewEl.textContent =
      converted.length > PREVIEW_LIMIT
        ? converted.substring(0, PREVIEW_LIMIT) + "\n\n…（以下省略）"
        : converted;
  }

  private updateFileNameSuggestion(): void {
    if (!this.fileNameEl || !this.sourceFile) return;
    this.fileNameEl.value = makeExportFilename(this.sourceFile.name, this.format);
  }

  private async doExport(): Promise<void> {
    if (!this.sourceFile || !this.sourceText) return;
    const rawName = this.fileNameEl?.value ?? "";

    // ルート直下のファイル名として妥当かを明示的に検証する
    // （normalizePath はパストラバーサル対策の代替にはならないため）。
    const validationError = validateExportFileName(rawName, this.format);
    if (validationError) {
      new Notice(validationError);
      return;
    }
    const outputName = normalizePath(rawName.trim());
    if (!outputName || outputName === "." || outputName === "/") {
      new Notice("出力ファイル名が不正です。正しいファイル名を入力してください。");
      return;
    }

    const converted = this.convert();
    if (converted === null) {
      new Notice("定義ファイルを読み込めなかったため、Export できません。選択している定義を見直してください。");
      return;
    }

    const existing = this.app.vault.getAbstractFileByPath(outputName);
    if (existing instanceof TFile) {
      // 同名ファイルが既に存在する場合、無確認で上書きせず、
      // 対象パスを明示した確認ダイアログを挟む。
      new ConfirmationModal(this.app)
        .setTitle("既存ファイルの上書き")
        .setContent(`${outputName} は既に存在します。上書きしてもよろしいですか？`)
        .addButton(b => b.setButtonText("キャンセル").setCancel().setInitialFocus())
        .addButton(b =>
          b.setButtonText("上書きする").setDestructive()
            .onClick(async () => {
              await this.writeExportFile(outputName, existing, converted);
            })
        )
        .open();
      return;
    }

    await this.writeExportFile(outputName, null, converted);
  }

  private async writeExportFile(outputName: string, existing: TFile | null, converted: string): Promise<void> {
    try {
      if (existing) {
        await this.app.vault.modify(existing, converted);
        new Notice(`上書き保存しました：${outputName}`);
      } else {
        await this.app.vault.create(outputName, converted);
        new Notice(`Export しました：${outputName}`);
      }
      this.close();
    } catch (e) {
      console.error("Novels Note JP Export エラー:", e);
      new Notice(`Export に失敗しました：${String(e)}`);
    }
  }
}
