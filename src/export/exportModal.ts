// ─────────────────────────────────────────
// Novels Note JP — Export モーダル
// ─────────────────────────────────────────

import { App, Modal, Setting, TFile, Notice, normalizePath } from "obsidian";
import { RubyStyle } from "../settings";
import {
  ExportOptions,
  DEFAULT_EXPORT_OPTIONS,
  ExportFormat,
  RubyConvertMode,
  exportText,
  makeExportFilename,
} from "./exporter";

export class ExportModal extends Modal {
  private sourceFile: TFile | null;
  private sourceText: string = "";
  private opts: ExportOptions;
  private previewEl!: HTMLElement;
  private fileNameEl!: HTMLInputElement;

  /** 現在設定されているルビ方式（設定画面から渡す） */
  private currentRubyStyle: RubyStyle;

  constructor(app: App, activeFile: TFile | null, rubyStyle: RubyStyle) {
    super(app);
    this.sourceFile      = activeFile;
    this.currentRubyStyle = rubyStyle;
    this.opts = {
      ...DEFAULT_EXPORT_OPTIONS,
      sourceRubyStyle: rubyStyle,
    };
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

    // ── 設定エリア ────────────────────────────────
    const settingsEl = contentEl.createEl("div", { cls: "nn-export-settings" });

    // 出力形式
    new Setting(settingsEl)
      .setName("出力形式")
      .addDropdown(drop =>
        drop
          .addOption("txt", ".txt（プレーンテキスト）")
          .addOption("md",  ".md（Markdown）")
          .setValue(this.opts.format)
          .onChange(value => {
            this.opts.format = value as ExportFormat;
            this.updateFileNameSuggestion();
          })
      );

    // 連続空行の圧縮
    new Setting(settingsEl)
      .setName("連続する空行を1行に圧縮する")
      .addToggle(toggle =>
        toggle.setValue(this.opts.removeBlankLines)
          .onChange(value => {
            this.opts.removeBlankLines = value;
            this.updatePreview();
          })
      );

    // ルビ変換
    // 現在の入力方式を表示しつつ、変換先を選択させる
    const rubyStyleLabel: Record<RubyStyle, string> = {
      narou:  "なろう式（|漢字《ルビ》）",
      aozora: "青空文庫式（｜漢字《ルビ》）",
      denden: "でんでん式（{漢字|ルビ}）",
      html:   "HTMLタグ（<ruby>）",
    };
    new Setting(settingsEl)
      .setName("ルビの変換")
      .setDesc(`現在の入力方式：${rubyStyleLabel[this.currentRubyStyle]}`)
      .addDropdown(drop => {
        drop.addOption("none", "変換しない（そのまま出力）");
        drop.addOption("narou",  "なろう式に変換（|漢字《ルビ》）");
        drop.addOption("aozora", "青空文庫式に変換（｜漢字《ルビ》）");
        drop.addOption("denden", "でんでん式に変換（{漢字|ルビ}）");
        drop.addOption("html",   "HTMLタグに変換（<ruby>）");
        drop.addOption("remove", "ルビ記号を削除（親文字のみ残す）");
        drop.setValue(this.opts.rubyConvert);
        drop.onChange(value => {
          this.opts.rubyConvert = value as RubyConvertMode;
          this.updatePreview();
        });
      });

    // 出力ファイル名
    new Setting(settingsEl)
      .setName("出力ファイル名")
      .setDesc("Vault 内に保存されます（Vault ルート直下）")
      .addText(text => {
        this.fileNameEl = text.inputEl;
        text.inputEl.style.width = "100%";
        text.setValue(makeExportFilename(this.sourceFile!.name, this.opts.format));
      });

    // ── プレビューエリア ──────────────────────────
    const previewWrap = contentEl.createEl("div", { cls: "nn-export-preview-wrap" });
    previewWrap.createEl("p", {
      text: "プレビュー（変換後の本文・先頭2000字）",
      cls: "nn-export-preview-label",
    });
    this.previewEl = previewWrap.createEl("pre", { cls: "nn-export-preview" });
    this.updatePreview();

    // ── ボタンエリア ──────────────────────────────
    const btnArea = contentEl.createEl("div", { cls: "nn-export-buttons" });

    const exportBtn = btnArea.createEl("button", { text: "Export する", cls: "mod-cta" });
    exportBtn.addEventListener("click", () => this.doExport());

    const cancelBtn = btnArea.createEl("button", { text: "キャンセル" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void { this.contentEl.empty(); }

  private async loadSourceFile(file: TFile): Promise<void> {
    this.sourceText = await this.app.vault.read(file);
  }

  private updatePreview(): void {
    if (!this.previewEl || !this.sourceText) return;
    const converted = exportText(this.sourceText, this.opts);
    const PREVIEW_LIMIT = 2000;
    this.previewEl.textContent =
      converted.length > PREVIEW_LIMIT
        ? converted.substring(0, PREVIEW_LIMIT) + "\n\n…（以下省略）"
        : converted;
  }

  private updateFileNameSuggestion(): void {
    if (!this.fileNameEl || !this.sourceFile) return;
    this.fileNameEl.value = makeExportFilename(this.sourceFile.name, this.opts.format);
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

    const converted = exportText(this.sourceText, this.opts);
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
