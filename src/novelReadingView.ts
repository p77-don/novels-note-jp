// ─────────────────────────────────────────
// Novels Note JP — Novel Reading View
// 仕様書 v1.1 準拠
//
// 【設計方針】
//   - mode:novel ファイルを開いているリーフを
//     そのまま NovelReadingView に差し替える。
//   - View が file を自身で保持するため、
//     タブ順序変更・他タブへの移動後も表示維持。
//   - ツールバーの「編集に戻る」でリーフを
//     markdown に戻す（ファイルは維持）。
// ─────────────────────────────────────────

import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { NOVEL_READING_VIEW_TYPE } from "./types";
import { RubyStyle } from "./settings";
import { convertRuby } from "./verticalPreview";

// ─────────────────────────────────────────
// HTML 属性エスケープ
// ─────────────────────────────────────────
function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────
// Frontmatter 除去
// ─────────────────────────────────────────
function stripFrontmatter(source: string): string {
  return source.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n?/, "");
}

// ─────────────────────────────────────────
// 1行をHTMLへ変換
//
// 処理順序：
//   1. ルビ記法 → <ruby>タグ
//   2. WikiLink → プレースホルダ（タグ内混入防止）
//   3. テキスト部分のHTMLエスケープ（既存タグは保護）
//   4. プレースホルダ → <a class="internal-link">
// ─────────────────────────────────────────
function renderLine(rawLine: string, rubyStyle: RubyStyle): string {
  // Step 1: ルビ変換
  let line = convertRuby(rawLine, rubyStyle);

  // Step 2: WikiLink をプレースホルダに置換
  line = line.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, target, display) =>
    `\x00WL\x01${escapeAttr(target)}\x01${display}\x00`
  );
  line = line.replace(/\[\[([^\]]+)\]\]/g, (_, target) =>
    `\x00WL\x01${escapeAttr(target)}\x01${target}\x00`
  );

  // Step 3: テキスト部分のみHTMLエスケープ（<tag>は保護）
  const parts = line.split(/(<[^>]+>)/g);
  line = parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }).join("");

  // Step 4: プレースホルダ → <a class="internal-link">
  line = line.replace(
    /\x00WL\x01([^\x01]*)\x01([^\x00]*)\x00/g,
    (_, href, display) =>
      `<a class="internal-link" data-href="${href}">${display}</a>`
  );

  return line;
}

// ─────────────────────────────────────────
// ソーステキスト → 横書き小説 HTML 変換
//
//   空行              → <p class="nn-blank"></p>
//   先頭全角スペース   → <p class="nn-indent">…</p>
//   その他            → <p>…</p>
// ─────────────────────────────────────────
export function toReadingHtml(source: string, rubyStyle: RubyStyle): string {
  const body = stripFrontmatter(source);
  const lines = body.split("\n");
  const parts: string[] = [];

  for (const rawLine of lines) {
    const isBlank =
      rawLine.length === 0 ||
      (rawLine.trim() === "" && rawLine.replace(/\u3000/g, "").trim() === "");

    if (isBlank) {
      parts.push(`<p class="nn-blank"></p>`);
      continue;
    }

    const hasIndent = rawLine.startsWith("\u3000");
    // 先頭全角スペースはCSSのtext-indentで制御するためテキストから除去する
    const lineToRender = hasIndent ? rawLine.slice(1) : rawLine;
    const rendered = renderLine(lineToRender, rubyStyle);

    parts.push(hasIndent
      ? `<p class="nn-indent">${rendered}</p>`
      : `<p>${rendered}</p>`
    );
  }

  return parts.join("\n");
}

// ─────────────────────────────────────────
// Novel Reading View 本体
// ─────────────────────────────────────────
export class NovelReadingView extends ItemView {
  private rootEl!: HTMLElement;
  private titleEl!: HTMLElement;

  /** このビューが表示するファイル（タブ切り替え後も保持） */
  public _file: TFile | null = null;

  private getRubyStyle:  () => RubyStyle = () => "narou";
  private getWrapColumn: () => number    = () => 40;

  /** ファイルを外から設定する（activateNovelReadingView から呼ぶ） */
  setFile(file: TFile): void {
    this._file = file;
  }

  setRubyStyleGetter(fn: () => RubyStyle): void  { this.getRubyStyle  = fn; }
  setWrapColumnGetter(fn: () => number): void     { this.getWrapColumn = fn; }

  constructor(leaf: WorkspaceLeaf) { super(leaf); }

  getViewType(): string    { return NOVEL_READING_VIEW_TYPE; }
  getDisplayText(): string {
    return this._file?.basename ?? "小説ビュー";
  }
  getIcon(): string        { return "book-open"; }

  // ─────────────────────────────────────────
  // 状態の保存・復元（Obsidian の leaf 永続化）
  // ─────────────────────────────────────────
  getState(): Record<string, unknown> {
    return { filePath: this._file?.path ?? null };
  }

  async setState(state: Record<string, unknown>): Promise<void> {
    const filePath = state?.filePath;
    if (typeof filePath === "string") {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        this._file = file;
      }
    }
    // DOM が構築済みであれば即座に再描画
    if (this.rootEl) await this.loadCurrentFile();
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("nn-reading-container");

    // ─── ツールバー ───
    const toolbar = container.createEl("div", { cls: "nn-reading-toolbar" });
    this.titleEl = toolbar.createEl("span", { cls: "nn-reading-toolbar-title" });
    this.titleEl.textContent = this._file?.basename ?? "小説閲覧";

    const btnWrap = toolbar.createEl("div", { cls: "nn-reading-toolbar-buttons" });

    // 編集モードに戻るボタン（pencil-line アイコン）
    const editBtn = btnWrap.createEl("button", {
      cls: "nn-btn",
      title: "編集モードに戻る",
    });
    editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>`;
    editBtn.addEventListener("click", () => this.switchToEdit());

    // ─── 本文領域 ───
    this.rootEl = container.createEl("div", { cls: "nn-reading-root" });

    await this.loadCurrentFile();

    // ファイル編集時に更新（500ms デバウンス）
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        if (updateTimer) clearTimeout(updateTimer);
        updateTimer = setTimeout(() => this.loadCurrentFile(), 500);
      })
    );

    // Vault 上のファイル変更（外部ツール等）にも追従
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file === this._file) {
          this.loadCurrentFile();
        }
      })
    );
  }

  async onClose(): Promise<void> {
    // nothing to clean up
  }

  // ─────────────────────────────────────────
  // 編集モードへ切り替え
  // このリーフを markdown ビューに戻す
  // ─────────────────────────────────────────
  private async switchToEdit(): Promise<void> {
    if (!this._file) return;
    const filePath = this._file.path;
    await this.leaf.setViewState({
      type: "markdown",
      state: { file: filePath, mode: "source" },
    });
  }

  // ─────────────────────────────────────────
  // ファイル読み込み・レンダリング
  // ─────────────────────────────────────────
  async loadCurrentFile(): Promise<void> {
    if (!this.rootEl) return;

    const file = this._file;

    if (!file) {
      this.renderMessage("ファイルが指定されていません。");
      return;
    }

    // mode: novel チェック
    const cache = this.app.metadataCache.getFileCache(file);
    const mode  = cache?.frontmatter?.mode;
    if (mode !== "novel") {
      this.renderMessage(
        "このファイルは対象外です。\nFrontmatter に `mode: novel` を設定してください。"
      );
      return;
    }

    // Vault から直接テキスト取得（Markdown レンダラを使わない）
    let source: string;
    try {
      source = await this.app.vault.read(file);
    } catch {
      this.renderMessage("ファイルの読み込みに失敗しました。");
      return;
    }

    this.renderContent(source);
    // タブタイトルを更新
    this.app.workspace.requestSaveLayout();
  }

  private renderContent(source: string): void {
    if (!this.rootEl) return;

    // ツールバーのタイトルをファイル名に更新
    if (this.titleEl) {
      this.titleEl.textContent = this._file?.basename ?? "小説閲覧";
    }

    // 折り返し幅を設定値に合わせる
    const wrapCol = this.getWrapColumn();
    this.rootEl.style.maxWidth = `${wrapCol}em`;

    const html = toReadingHtml(source, this.getRubyStyle());
    this.rootEl.innerHTML = html;

    // WikiLink クリックでファイルを開く
    this.rootEl.querySelectorAll<HTMLAnchorElement>("a.internal-link").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const href = a.dataset.href;
        if (!href) return;
        this.app.workspace.openLinkText(href, "", false);
      });
    });
  }

  private renderMessage(message: string): void {
    if (!this.rootEl) return;
    this.rootEl.innerHTML = "";
    this.rootEl.style.maxWidth = "";
    const p = this.rootEl.createEl("p", { cls: "nn-reading-message" });
    p.textContent = message;
  }

  /** ルビ設定変更・折り返し幅変更などの際に外部から強制再描画 */
  forceReload(): void {
    this.loadCurrentFile();
  }
}
