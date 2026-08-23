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

import { ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import { NOVEL_READING_VIEW_TYPE } from "../types";
import { RubyStyle, NovelsNoteSettings, DEFAULT_SETTINGS } from "../settings";
import { convertRubyAndEscape } from "../core/rubyPatterns";
import { ExportModal } from "../export/exportModal";
import type { ManuscriptRules } from "../manuscript-rules/types/rules";
import { cleanManuscript } from "../manuscript-rules/cleaner/manuscriptCleaner";
import { createDefaultManuscriptRules } from "../manuscript-rules/rules/ruleDefaults";

// ─────────────────────────────────────────
// 原稿テキストのクリーニング
//
// 【2026-08 修正】以前はこのビュー専用の固定正規表現でクリーニングを
// 行っており、Export・文字数カウントが使う cleanManuscript()（選択中の
// ManuscriptRules）と処理内容が食い違っていた（見出しを残す／
// WikiLinkを削除するなどのユーザー設定が閲覧ビューに反映されない）。
// このビューは縦書きプレビューと異なりカーソル位置と行番号の
// 1:1対応を必要としないため、Export・文字数カウントと同じ
// cleanManuscript() エンジンをそのまま利用できる。
//
// ただし、ルビ記法だけは例外的に「そのまま維持」させる
// （mode: "none" を強制する）。ルビのHTML化・エスケープは、
// このビュー独自の convertRubyAndEscape()（core/rubyPatterns.ts）が
// 1行ずつ安全に行う設計になっており、cleanManuscript() 側で
// 先にルビ記法を変換・除去してしまうと、
//   - ユーザーが選択中の定義のルビmodeと、このビューの表示用
//     ルビスタイル設定（getRubyStyle）が異なる場合に変換結果が
//     噛み合わなくなる
//   - mode: "html" 変換によって生成された生の <ruby> タグが
//     convertRubyAndEscape() の想定外の形で扱われる
// といった問題が起きるため、表示直前のルビ処理は従来どおり
// このビュー側に残す。frontmatter除去も cleanManuscript() 側の
// metadata.frontmatter ルールに委譲する。
// ─────────────────────────────────────────
function cleanSource(source: string, rules: ManuscriptRules, rubyStyle: RubyStyle): string {
  const displayRules: ManuscriptRules = {
    ...rules,
    inline: { ...rules.inline, ruby: { mode: "none" } },
  };
  return cleanManuscript(source, displayRules, rubyStyle);
}

// ─────────────────────────────────────────
// 1行をHTMLへ変換
//
// 【セキュリティ】
// 旧実装は「ルビ記法 → <ruby>タグに変換」→「タグらしき文字列を
// 正規表現で検出し、それ以外をエスケープ」という2段階の処理だった。
// この方式は、ルビの親文字・ルビ文字に "<" ">" を含む文字列が
// マッチした場合や、cleanSource() が温存する <ruby>/<rt> タグに
// 任意の属性（onerror 等）が付いていた場合に、それらがエスケープ
// されずに実DOMへ挿入されてしまう脆弱性があった（XSS）。
//
// convertRubyAndEscape()（core/rubyPatterns.ts）は、ルビ記法として
// 正しく認識できる範囲だけを厳密に検出し、親文字・ルビ文字を
// 個別にエスケープしてから <ruby> タグを組み立てる。それ以外の
// 部分（属性付きの <ruby ...> タグなど、厳密なルビ記法として
// 認識できないもの）はすべてプレーンテキストとしてエスケープされる。
// ─────────────────────────────────────────
function renderLine(rawLine: string, rubyStyle: RubyStyle): string {
  return convertRubyAndEscape(rawLine, rubyStyle);
}

// ─────────────────────────────────────────
// ソーステキスト → 横書き小説 HTML 変換
//
//   空行              → <p class="nn-blank"></p>
//   先頭全角スペース   → <p class="nn-indent">…</p>
//   その他            → <p>…</p>
// ─────────────────────────────────────────
export function toReadingHtml(source: string, rules: ManuscriptRules, rubyStyle: RubyStyle): string {
  const cleaned = cleanSource(source, rules, rubyStyle);

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
  /** 表示クリーニングに使う、アクティブな原稿クリーニング定義（Export・文字数カウントと共通）。 */
  private getManuscriptRules: () => ManuscriptRules = () => createDefaultManuscriptRules();
  /** Export モーダルへ渡すプラグイン設定全体（登録済み原稿クリーニング定義の参照用） */
  private getSettings: () => NovelsNoteSettings | null = () => null;
  /**
   * Export モーダルへ渡すプラグイン専用フォルダのパス（定義ファイルの実体はこの配下 rules/ にある）。
   * main.ts の setPluginDirGetter() で実際の manifest.dir に基づく値へ差し替えられるまでの、
   * 暫定フォールバック値。ハードコードした ".obsidian" ではなく Vault#configDir を参照する。
   */
  private getPluginDir: () => string = () =>
    `${this.app.vault.configDir}/plugins/novels-note-jp`;

  /** ファイルを外から設定する（activateNovelReadingView から呼ぶ） */
  setFile(file: TFile): void {
    this._file = file;
  }

  setRubyStyleGetter(fn: () => RubyStyle): void  { this.getRubyStyle  = fn; }
  setWrapColumnGetter(fn: () => number): void     { this.getWrapColumn = fn; }
  setFontSizeGetter(fn: () => number): void       { this.getFontSize   = fn; }
  setManuscriptRulesGetter(fn: () => ManuscriptRules): void { this.getManuscriptRules = fn; }
  setSettingsGetter(fn: () => NovelsNoteSettings): void { this.getSettings = fn; }
  setPluginDirGetter(fn: () => string): void { this.getPluginDir = fn; }

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
    const toolbar = container.createDiv({ cls: "nn-reading-toolbar" });
    this.titleEl = toolbar.createSpan({ cls: "nn-reading-toolbar-title" });
    this.titleEl.textContent = this._file?.basename ?? "小説閲覧";

    const btnWrap = toolbar.createDiv({ cls: "nn-reading-toolbar-buttons" });

    // エクスポートボタン（file-output アイコン）
    const exportBtn = btnWrap.createEl("button", {
      cls: "nn-btn",
      title: "現在のファイルを原稿 Export する",
    });
    setIcon(exportBtn, "file-output");
    exportBtn.addEventListener("click", () => {
      if (!this._file) return;
      const settings = this.getSettings() ?? { ...DEFAULT_SETTINGS, rubyStyle: this.getRubyStyle() };
      new ExportModal(this.app, this._file, settings, this.getPluginDir()).open();
    });

    // 編集モードに戻るボタン（pencil-line アイコン）
    const editBtn = btnWrap.createEl("button", {
      cls: "nn-btn",
      title: "編集モードに戻る",
    });
    setIcon(editBtn, "pencil");
    editBtn.addEventListener("click", () => { void this.switchToEdit(); });

    // ─── 本文領域 ───
    this.rootEl = container.createDiv({ cls: "nn-reading-root" });

    await this.loadCurrentFile();

    // ファイル編集時に更新（500ms デバウンス）
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, view) => {
        // 現在このビューが表示しているファイル以外の変更は無視する
        if (!("file" in view) || (view as { file: unknown }).file !== this._file) return;
        if (updateTimer) window.clearTimeout(updateTimer);
        updateTimer = window.setTimeout(() => { void this.loadCurrentFile(); }, 500);
      })
    );

    // Vault 上のファイル変更（外部ツール等）にも追従
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file === this._file) {
          void this.loadCurrentFile();
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
    const frontmatter = cache?.frontmatter;
    if (frontmatter?.["mode"] !== "novel") {
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

    // 折り返し幅・フォントサイズを設定値に合わせる
    const wrapCol = this.getWrapColumn();
    const maxWidth = wrapCol + NovelReadingView.WRAP_MARGIN_EM;
    const fontSize = this.getFontSize();
    this.rootEl.style.setProperty("max-width", `${maxWidth}em`);
    this.rootEl.style.setProperty("font-size", `${fontSize}px`);

    const html = toReadingHtml(source, this.getManuscriptRules(), this.getRubyStyle());
    this.rootEl.empty();
    const contentEl = this.rootEl.createDiv({ cls: "nn-reading-content" });
    // DOMParser でパースしてノードを直接追加（innerHTML 不使用）
    const parsed = new DOMParser().parseFromString(html, "text/html");
    for (const node of Array.from(parsed.body.childNodes)) {
      contentEl.appendChild(contentEl.ownerDocument.adoptNode(node));
    }
  }

  private renderMessage(message: string): void {
    if (!this.rootEl) return;
    this.rootEl.empty();
    this.rootEl.style.removeProperty("max-width");
    this.rootEl.style.removeProperty("font-size");
    const p = this.rootEl.createEl("p", { cls: "nn-reading-message" });
    p.textContent = message;
  }

  /** ルビ設定変更・折り返し幅変更などの際に外部から強制再描画 */
  forceReload(): void {
    void this.loadCurrentFile();
  }
}

