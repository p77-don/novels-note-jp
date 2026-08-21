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

import { App, Modal, Setting, TFile, Notice, normalizePath } from "obsidian";
import { NovelsNoteSettings } from "../settings";
import type { ManuscriptRulesDefinition } from "../manuscript-rules/types/rules";
import { cleanManuscript } from "../manuscript-rules/cleaner/manuscriptCleaner";
import { createDefaultManuscriptRulesDefinition } from "../manuscript-rules/rules/ruleDefaults";
import { readRuleFile, ManuscriptRulesFileError } from "../manuscript-rules/adapter/pluginRuleStore";
import { ExportFormat, makeExportFilename } from "./exporter";

/** 定義ファイルが1件も登録されていない場合に使う、組み込みのデフォルト定義。 */
const BUILT_IN_DEFAULT_LABEL = "組み込みの初期設定";

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
    if (!this.selectedRulesFileName) {
      this.selectedRulesDef = createDefaultManuscriptRulesDefinition();
      if (this.rulesStatusEl) {
        this.rulesStatusEl.setText(`✓ ${BUILT_IN_DEFAULT_LABEL}を使用します。`);
        this.rulesStatusEl.removeClass("nn-export-rules-error");
      }
      this.updatePreview();
      return;
    }

    try {
      this.selectedRulesDef = await readRuleFile(this.app, this.pluginDir, this.selectedRulesFileName);
      if (this.rulesStatusEl) {
        this.rulesStatusEl.setText(`✓ ${this.selectedRulesFileName} を使用します。`);
        this.rulesStatusEl.removeClass("nn-export-rules-error");
      }
    } catch (e) {
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
    const rawName = this.fileNameEl?.value.trim();
    if (!rawName) { new Notice("出力ファイル名を入力してください。"); return; }

    // パストラバーサル（../ など）・不正文字を normalizePath で正規化する
    const outputName = normalizePath(rawName);
    // 正規化後に空になった場合や、ルート直下への不正アクセスを弾く
    if (!outputName || outputName === "." || outputName === "/") {
      new Notice("出力ファイル名が不正です。正しいファイル名を入力してください。");
      return;
    }

    const converted = this.convert();
    if (converted === null) {
      new Notice("定義ファイルを読み込めなかったため、Export できません。選択している定義を見直してください。");
      return;
    }

    try {
      const existing = this.app.vault.getAbstractFileByPath(outputName);
      if (existing instanceof TFile) {
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
