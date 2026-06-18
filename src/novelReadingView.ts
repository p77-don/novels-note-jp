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
//   - 表示テキストはエクスポートと同じクリーニングを適用する。
//     WikiLink・タグ・Markdown記号などの原稿外情報を排除する。
// ─────────────────────────────────────────

import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { NOVEL_READING_VIEW_TYPE } from "./types";
import { RubyStyle } from "./settings";
import { convertRuby } from "./verticalPreview";
import { ExportModal } from "./exportModal";
import { stripHashtags } from "./hashtags";

// ─────────────────────────────────────────
// Frontmatter 除去
// ─────────────────────────────────────────
function stripFrontmatter(source: string): string {
  return source.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n?/, "");
}

// ─────────────────────────────────────────
// 原稿テキストのクリーニング
//
// エクスポートと同じ処理でMarkdown記法・WikiLink・タグなどを除去する。
// ルビ記法はそのまま残す（convertRubyで後処理する）。
// ─────────────────────────────────────────
function cleanSource(source: string): string {
  let text = source;

  // Obsidian コメント削除
  text = text.replace(/%%[\s\S]*?%%/g, "");

  // Callout ブロック削除
  text = text.replace(/^(>[ \t]*\[![\w-]+\][^\n]*\n(?:>[ \t]*[^\n]*\n?)*)/gm, "");

  // WikiLink を表示テキストに変換（[[target|display]] → display、[[target]] → target）
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // タグ削除
  // タグの判定ロジックは hashtags.ts に共通化されている
  // （Export・小説閲覧ビュー・文字数カウントで判定基準を統一するため）。
  text = stripHashtags(text);
  // タグ除去後の連続スペース・行頭末尾スペースを正規化
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/^[ \t]+$/gm, "");

  // Markdown 見出し記号除去
  text = text.replace(/^#{1,6}[ \t]+/gm, "");

  // Markdown 引用記号除去
  text = text.replace(/^>[ \t]?/gm, "");

  // Markdown リスト記号除去
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  text = text.replace(/^[ \t]*\d+\.[ \t]+/gm, "");

  // Markdown 強調記号除去（**bold**、*italic*、__bold__、_italic_）
  text = text.replace(/(\*{1,3}|_{1,3})([\s\S]*?)\1/g, "$2");

  // Markdown 水平線除去
  text = text.replace(/^[-*_]{3,}[ \t]*$/gm, "");

  // Markdown コードブロック除去
  text = text.replace(/^```[\s\S]*?^```[ \t]*$/gm, "");
  text = text.replace(/^~~~[\s\S]*?^~~~[ \t]*$/gm, "");
  text = text.replace(/`([^`]+)`/g, "$1");

  // Markdown リンク変換（画像は除去、テキストリンクは表示テキストのみ残す）
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // HTML タグ除去（ruby・rt は除外）
  text = text.replace(/<(?!\/?(ruby|rt)\b)[^>]+>/gi, "");

  return text;
}

// ─────────────────────────────────────────
// HTML 属性エスケープ
// ─────────────────────────────────────────
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─────────────────────────────────────────
// 1行をHTMLへ変換
//
// 処理順序：
//   1. ルビ記法 → <ruby>タグ
//   2. テキスト部分のHTMLエスケープ（既存タグは保護）
// ─────────────────────────────────────────
function renderLine(rawLine: string, rubyStyle: RubyStyle): string {
  // Step 1: ルビ変換
  let line = convertRuby(rawLine, rubyStyle);

  // Step 2: テキスト部分のみHTMLエスケープ（<ruby><rt>タグは保護）
  const parts = line.split(/(<[^>]+>)/g);
  line = parts.map((part, i) => {
    if (i % 2 === 1) return part; // タグ部分はそのまま
    return escapeHtml(part);
  }).join("");

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
  // Frontmatter 除去 → 原稿クリーニング
  const stripped = stripFrontmatter(source);
  const cleaned  = cleanSource(stripped);

  const lines = cleaned.split("\n");
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
  private getFontSize:   () => number    = () => 16;

  /** ファイルを外から設定する（activateNovelReadingView から呼ぶ） */
  setFile(file: TFile): void {
    this._file = file;
  }

  setRubyStyleGetter(fn: () => RubyStyle): void  { this.getRubyStyle  = fn; }
  setWrapColumnGetter(fn: () => number): void     { this.getWrapColumn = fn; }
  setFontSizeGetter(fn: () => number): void       { this.getFontSize   = fn; }

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

    // エクスポートボタン（file-output アイコン）
    const exportBtn = btnWrap.createEl("button", {
      cls: "nn-btn",
      title: "現在のファイルを原稿 Export する",
    });
    exportBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="-5 -5 34 34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-output-icon lucide-file-output"><path d="M4.226 20.925A2 2 0 0 0 6 22h12a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.127"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m5 11-3 3"/><path d="m5 17-3-3h10"/></svg>`;
    exportBtn.addEventListener("click", () => {
      if (!this._file) return;
      new ExportModal(this.app, this._file, this.getRubyStyle()).open();
    });

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
      this.app.workspace.on("editor-change", (_editor, view) => {
        // 現在このビューが表示しているファイル以外の変更は無視する
        if (!("file" in view) || (view as { file: unknown }).file !== this._file) return;
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

  // 実測の結果、本文の折り返し幅は wrapColumn(em) ちょうどでは
  // 設定文字数より少ない文字数で折り返ってしまうため、
  // 1.2em のマージンを加えて補正する。
  // ※ verticalPreview.ts の PUNCTUATION_MARGIN_EM とは別の値・別要因
  //   （縦書き側は句点グリフの縦幅特性による超過、横書き側は
  //   このビュー特有の幅計算のズレによるもの）。
  // ※ 使用フォントやレイアウトを変更した場合はこの補正値の再調整が必要。
  private static readonly WRAP_MARGIN_EM = 1.2;

  private renderContent(source: string): void {
    if (!this.rootEl) return;

    // ツールバーのタイトルをファイル名に更新
    if (this.titleEl) {
      this.titleEl.textContent = this._file?.basename ?? "小説閲覧";
    }

    // 折り返し幅を設定値に合わせる（補正マージンを加算）
    const wrapCol = this.getWrapColumn();
    const maxWidth = wrapCol + NovelReadingView.WRAP_MARGIN_EM;
    this.rootEl.style.maxWidth = `${maxWidth}em`;

    // フォントサイズをエディター設定値に合わせる
    // （var(--font-text-size) は Obsidian 本体の外観設定であり、
    //   プラグイン側の wrapColumn(em) 計算の前提とズレるため）
    const fontSize = this.getFontSize();
    this.rootEl.style.fontSize = `${fontSize}px`;

    const html = toReadingHtml(source, this.getRubyStyle());
    this.rootEl.innerHTML = html;
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
