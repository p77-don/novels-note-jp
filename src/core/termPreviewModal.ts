import { App, Component, MarkdownRenderer, Modal, Notice, TFile } from "obsidian";
import type { TermEntry } from "../types";

// ─────────────────────────────────────────
// 用語プレビューモーダル
//
// 「選択した文字列の用語ノートを開く」コマンドは、
// マウスホバーによるページプレビュー（Obsidian標準機能）の
// 代替として用意したもの。ホバーは「見るだけ」で原稿から
// 離れないのに対し、コマンドでいきなりノートを開いてしまうと
// 原稿から画面遷移してしまい、ホバーの代替として体験が異なる。
// そのため、まずはモーダルで用語ノートの内容そのものを
// プレビュー表示し、必要であれば明示的に
// 「用語ページを開く」を選んでもらう。
// ─────────────────────────────────────────
export class TermPreviewModal extends Modal {
  private term: TermEntry;
  private onOpenNote: () => void;
  // MarkdownRenderer.render() はライフサイクル管理用に Component を
  // 要求する。Modal 自体は Component ではないため、専用に用意し、
  // モーダルを閉じるタイミングで unload してレンダリングを破棄する。
  private renderComponent = new Component();

  constructor(app: App, term: TermEntry, onOpenNote: () => void) {
    super(app);
    this.term = term;
    this.onOpenNote = onOpenNote;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nn-term-preview-modal");
    this.renderComponent.load();

    contentEl.createEl("h3", { text: this.term.name, cls: "nn-modal-title" });

    if (this.term.aliases.length > 0) {
      const aliasEl = contentEl.createDiv({ cls: "nn-modal-info" });
      aliasEl.createSpan({ text: "別名：", cls: "nn-modal-label" });
      aliasEl.createSpan({
        text: this.term.aliases.join("、"),
        cls: "nn-modal-value",
      });
    }

    // ノート本文プレビュー（Page Preview と同様に Markdown を描画）
    const previewEl = contentEl.createDiv({ cls: "nn-term-preview-body" });
    void this.renderNoteContent(previewEl);

    const btnRow = contentEl.createDiv({ cls: "nn-modal-btn-row" });
    const closeBtn = btnRow.createEl("button", {
      text: "閉じる",
      cls: "nn-modal-btn nn-modal-btn-cancel",
    });
    const openBtn = btnRow.createEl("button", {
      text: "用語ページを開く",
      cls: "nn-modal-btn nn-modal-btn-create",
    });

    closeBtn.addEventListener("click", () => this.close());
    openBtn.addEventListener("click", () => {
      this.close();
      this.onOpenNote();
    });
  }

  private async renderNoteContent(previewEl: HTMLElement): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.term.filePath);
    if (!(file instanceof TFile)) {
      previewEl.createEl("p", {
        text: "ノートが見つかりませんでした。",
        cls: "nn-empty nn-empty-hint",
      });
      return;
    }

    try {
      const raw = await this.app.vault.cachedRead(file);
      // フロントマター（--- ... ---）はプレビューとして
      // 表示する意味がないので取り除く
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

      if (!body) {
        previewEl.createEl("p", {
          text: "（本文がありません）",
          cls: "nn-empty nn-empty-hint",
        });
        return;
      }

      await MarkdownRenderer.render(
        this.app,
        body,
        previewEl,
        file.path,
        this.renderComponent
      );
    } catch {
      new Notice("用語ノートの読み込みに失敗しました。");
      previewEl.createEl("p", {
        text: "本文の読み込みに失敗しました。",
        cls: "nn-empty nn-empty-hint",
      });
    }
  }

  onClose(): void {
    this.renderComponent.unload();
    this.contentEl.empty();
  }
}
