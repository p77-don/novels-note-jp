// ─────────────────────────────────────────
// Novels Note JP — 縦書きプレビュー View
// ─────────────────────────────────────────

import { ItemView, WorkspaceLeaf, MarkdownView, TFile } from "obsidian";
import { VERTICAL_VIEW_TYPE } from "../types";
import { RubyStyle } from "../settings";

// ─────────────────────────────────────────
// ルビ変換
// ─────────────────────────────────────────
export function convertRuby(text: string, style: RubyStyle): string {
  switch (style) {
    case "narou":
      text = text.replace(/\|([^《\n]+)《([^》\n]*)》/g, "<ruby>$1<rt>$2</rt></ruby>");
      // u フラグ: \u{20000}-\u{3FFFF}（BMP外CJK Extension B-G）を正しく解釈するために必須
      text = text.replace(/([\u3005\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u{20000}-\u{3FFFF}]+)《([^》\n]*)》/gu, "<ruby>$1<rt>$2</rt></ruby>");
      return text;
    case "aozora":
      text = text.replace(/｜([^《\n]+)《([^》\n]*)》/g, "<ruby>$1<rt>$2</rt></ruby>");
      text = text.replace(/([\u3005\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u{20000}-\u{3FFFF}]+)《([^》\n]*)》/gu, "<ruby>$1<rt>$2</rt></ruby>");
      return text;
    case "denden":
      text = text.replace(/\{([^|\n]+)\|([^}\n]+)\}/g, "<ruby>$1<rt>$2</rt></ruby>");
      return text;
    case "html":
      return text;
  }
}

// ─────────────────────────────────────────
// HTML エスケープ（ruby タグ除外）
// ─────────────────────────────────────────
function escapeHtmlExceptRuby(text: string): string {
  const parts = text.split(/(<ruby>[\s\S]*?<\/ruby>)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }).join("");
}

// ─────────────────────────────────────────
// 縦中横（ruby タグ外のみ）
// ─────────────────────────────────────────
function applyTcy(text: string): string {
  const parts = text.split(/(<ruby>[\s\S]*?<\/ruby>|<rt>[\s\S]*?<\/rt>)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;

    return part.replace(
      /([A-Za-z0-9._:/+-]+)/g,
      (m) => {
        if (m.length <= 2) {
          return `<span class="tcy">${m}</span>`;
        }
        return `<span class="latin">${m}</span>`;
      }
    );}).join("");
}

// ─────────────────────────────────────────
// 文分割
//
// 1行のテキストを「文章単位」に分割する。
//
// 分割点の定義：
//   ・句点（。）の直後
//   ・感嘆符・疑問符（！？!?）の直後
//   ・閉じカギカッコ（」』）の直後（= セリフの終わり）
//   ・先頭全角スペースの直後（= 段落冒頭の字下げを独立させる）
//
// 例）「こんにちは。今日はいい天気ですね。明日はどうでしょうか。」
//  →  ["こんにちは。", "今日はいい天気ですね。", "明日はどうでしょうか。"]
//
// 例）「 むかしむかし、あるところに」
//  →  [" ", "むかしむかし、あるところに"]
//
// ─────────────────────────────────────────
function splitIntoSentences(line: string): string[] {
  if (line.length === 0) return [];

  const sentences: string[] = [];
  let buf = "";
  // プレーンテキスト部分の長さ（タグを除いた文字数）を追跡
  let plainBuf = "";
  let i = 0;

  while (i < line.length) {
    // HTML タグをまるごとスキップしてバッファに追加
    if (line[i] === "<") {
      const closeIdx = line.indexOf(">", i);
      if (closeIdx !== -1) {
        buf += line.slice(i, closeIdx + 1);
        i = closeIdx + 1;
        continue;
      }
    }

    const ch = line[i];
    buf += ch;
    plainBuf += ch;
    i++;

    // 文の終端となる文字（タグ外の実テキストのみ判定）
    const isEnd =
      ch === "。" || ch === "！" || ch === "？" ||
      ch === "!" || ch === "?" ||
      ch === "」" || ch === "』" || ch === "）" || ch === ")";

    // 先頭全角スペース：字下げ部分を独立した文として切り出す
    const isLeadingSpace = plainBuf === "\u3000";

    if (isEnd || isLeadingSpace) {
      sentences.push(buf);
      buf = "";
      plainBuf = "";
    }
  }

  // 残りがあれば最後の文として追加
  if (buf.length > 0) {
    sentences.push(buf);
  }

  return sentences;
}

// ─────────────────────────────────────────
// カーソル位置（行内文字位置）から文インデックスを特定
//
// sentences：その行の文リスト
// ch：カーソルの行内文字位置（getCursor().ch）
// ─────────────────────────────────────────
function cursorChToSentIdx(sentences: string[], ch: number): number {
  let pos = 0;
  for (let i = 0; i < sentences.length; i++) {
    pos += sentences[i].length;
    if (ch < pos) return i;
  }
  return sentences.length - 1;
}

// ─────────────────────────────────────────
// 変換結果の型
// ─────────────────────────────────────────

interface VerticalHtmlResult {
  html: string;
  /**
   * ソース行番号 → その行の文リスト（ソース原文）
   * カーソル位置（行 + 文字位置）から文を特定するために使う
   */
  lineSentences: Map<number, string[]>;
}

// ─────────────────────────────────────────
// テキスト → 縦書き HTML 変換
//
// 【HTML 構造】
//
//   <span class="nn-sent" data-line="N" data-sent="M">文テキスト</span>
//   <br>  ← 文の後に改行（= 縦書きの行送り）
//   <span class="nn-sent" ...>次の文</span>
//   <br>
//   <span class="nn-sep"></span><br>  ← 段落区切り
//
// ・nn-sent は display:inline-block
// ・data-line でソース行、data-sent で行内文インデックスを保持
// ・カーソル行 + カーソル文字位置 → 対応する nn-sent を特定可能
// ─────────────────────────────────────────
export function toVerticalHtml(
  source: string,
  rubyStyle: RubyStyle,
  selectedText: string = ""
): VerticalHtmlResult {

  // ─────────────────────────────────────────
  // Step 0: 選択テキストのマーカーを変換前に埋め込む
  //
  // ルビ変換後に選択テキストをマッチしようとすると
  //   "漢字"  →  <ruby>漢字<rt>かんじ</rt></ruby>
  // のようにDOMが分裂して文字列マッチが壊れる。
  // そのため「ルビ変換 / HTML生成より前」にプレーンテキストへ
  // マーカーを埋め込んでおき、後工程でタグへ置換する。
  // ─────────────────────────────────────────
  const SEL_START = "\x00\x01\x00";
  const SEL_END   = "\x00\x02\x00";

  let cleaned = source;

  if (selectedText.length > 0) {
    // selectedText をそのまま検索してマーカーで挟む（最初の1か所のみ）
    const idx = cleaned.indexOf(selectedText);
    if (idx !== -1) {
      cleaned =
        cleaned.slice(0, idx) +
        SEL_START +
        cleaned.slice(idx, idx + selectedText.length) +
        SEL_END +
        cleaned.slice(idx + selectedText.length);
    }
  }
  // Step 1〜5: Markdown・Obsidian 記号除去
  // Frontmatter は文書の先頭（行0）から始まる場合のみ除去
  cleaned = cleaned.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n?/, "");
  cleaned = cleaned.replace(/%%[\s\S]*?%%/g, "");
  cleaned = cleaned.replace(/^(>[ \t]*\[![\w-]+\][^\n]*\n(?:>[ \t]*[^\n]*\n?)*)/gm, "");
  cleaned = cleaned.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  cleaned = cleaned.replace(/\[\[([^\]]+)\]\]/g, "$1");
  cleaned = cleaned.replace(/^#[^\s#][^\n]*$/gm, "");
  cleaned = cleaned.replace(/^#{1,6}[ \t]+/gm, "");
  cleaned = cleaned.replace(/^>[ \t]?/gm, "");
  cleaned = cleaned.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  cleaned = cleaned.replace(/^[ \t]*\d+\.[ \t]+/gm, "");
  cleaned = cleaned.replace(/(\*{1,3}|_{1,3})([\s\S]*?)\1/g, "$2");
  // 区切り線 --- は小説の文章区切りとして「―――」に変換（縦書きで自然に見える）
  cleaned = cleaned.replace(/^(-{3,})[ \t]*$/gm, (_: string, dashes: string) => "―".repeat(dashes.length));
  cleaned = cleaned.replace(/^[*_]{3,}[ \t]*$/gm, "");
  cleaned = cleaned.replace(/^```[\s\S]*?^```[ \t]*$/gm, "");
  cleaned = cleaned.replace(/^~~~[\s\S]*?^~~~[ \t]*$/gm, "");
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Step 6: ルビ変換
  cleaned = convertRuby(cleaned, rubyStyle);

  // Step 7: HTML エスケープ
  cleaned = escapeHtmlExceptRuby(cleaned);

  // Step 8: 縦中横
  cleaned = applyTcy(cleaned);

  // Step 9: 埋め込みマーカー → ハイライトタグへ置換
  //
  // SEL_S〜SEL_E の区間を取り出し、その中の <ruby> タグを分解して
  // ルビの「親文字」部分だけに <mark> を付ける。
  // こうすることで：
  //   ・ルビの位置ずれが発生しない（<mark> が <ruby> を外側から囲まない）
  //   ・ルビ読み（<rt>）はハイライトされない
  //   ・ルビを含まないテキストも正しくハイライトされる
  //
  // 例: SEL_S + "文章中の<ruby>漢字<rt>かんじ</rt></ruby>を" + SEL_E
  //   → <mark>文章中の</mark><ruby><mark>漢字</mark><rt>かんじ</rt></ruby><mark>を</mark>
  //
  if (selectedText.length > 0) {
    let hlResult = "";
    let pos = 0;
    while (true) {
      const start = cleaned.indexOf(SEL_START, pos);
      if (start === -1) { hlResult += cleaned.slice(pos); break; }
      const end = cleaned.indexOf(SEL_END, start + SEL_START.length);
      if (end === -1) { hlResult += cleaned.slice(pos); break; }

      hlResult += cleaned.slice(pos, start);
      const inner = cleaned.slice(start + SEL_START.length, end);

      // inner 内の <ruby>BASE<rt>RT</rt></ruby> を
      // <ruby><mark>BASE</mark><rt>RT</rt></ruby> へ組み替える
      // （タグ境界に空白・改行が入る記法にも \s* で対応する）
      const rubyReplaced = inner.replace(
        /<ruby>\s*([^<]+?)\s*<rt>\s*([^<]*?)\s*<\/rt>\s*<\/ruby>/g,
        (_, base, rt) =>
          `<ruby><mark class="nn-sel">${base}</mark><rt>${rt}</rt></ruby>`
      );
      // ruby タグ以外のプレーンテキスト部分を <mark> で囲む
      const parts = rubyReplaced.split(/(<ruby>[\s\S]*?<\/ruby>)/g);
      hlResult += parts.map((p, i) => {
        if (i % 2 === 1) return p;   // ruby タグ本体はそのまま
        if (p === "") return "";
        return `<mark class="nn-sel">${p}</mark>`;
      }).join("");

      pos = end + SEL_END.length;
    }
    cleaned = hlResult;
  }

  // Step 10: ソース行と cleaned 行を対応させながら
  //          文単位の <span> を生成する
  //
  // ・ソース行を splitIntoSentences() で文に分割
  // ・cleaned 行も同様に文に分割（表示用テキスト）
  // ・data-line="ソース行番号" data-sent="行内文番号" を付与
  //
  // 【Frontmatter オフセット補正】
  // cleaned は Frontmatter 除去済みのため sourceLines との行番号がズレる。
  // source 先頭の Frontmatter 行数を数えて ループ開始行を補正する。
  //
  const sourceLines  = source.split("\n");
  const cleanedLines = cleaned.split("\n");

  // Frontmatter の行数を計算（--- で囲まれたブロックが先頭にある場合）
  let frontmatterLineCount = 0;
  {
    const fmMatch = source.match(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n?/);
    if (fmMatch) {
      // 末尾の \n を除いた行数を数える
      frontmatterLineCount = fmMatch[0].replace(/\n$/, "").split("\n").length;
    }
  }

  const lineSentences = new Map<number, string[]>(); // ソース行 → 文リスト（ソース原文）
  const parts: string[] = [];
  let prevBlank = true;
  let firstPara = true;
  let cleanedIdx = 0;

  // Frontmatter 行をスキップし、実際のコンテンツ行から処理開始
  for (let i = frontmatterLineCount; i < sourceLines.length; i++) {
    const srcLine     = sourceLines[i];
    const isBlank     = srcLine.trim() === "";
    const cleanedLine = cleanedLines[cleanedIdx] ?? "";

    if (!isBlank && prevBlank) {
      if (!firstPara) {
        parts.push(`<span class="nn-sep" aria-hidden="true"></span><br>`);
      }
      firstPara = false;
    }

    if (!isBlank) {
      // ─────────────────────────────────────────
      // 先頭全角スペース（字下げ）の検出
      // ─────────────────────────────────────────
      // 字下げ行では splitIntoSentences が先頭全角スペースを
      // 「文0番」として独立分割する。
      //
      // displayLine（表示用）は全角スペースを除去するため、
      // そのまま splitIntoSentences に渡すと文インデックスが
      // srcSents と 1 つズレる。
      //
      // 解決策：
      //   - hasIndent の判定は srcLine で行う
      //   - displayLine は cleanedLine から全角スペースを除去
      //   - srcSents も先頭の全角スペース文（" "）を除去して
      //     cleanedSents と文インデックスを一致させる
      //   - lineSentences には除去後の srcSents を格納
      //     （cursorChToSentIdx の ch 計算も全角スペース除去後の
      //       位置に合わせるため、srcLine も先頭1文字除去して渡す）
      // ─────────────────────────────────────────
      const hasIndent = srcLine.startsWith("\u3000");

      // カーソル対応用：字下げ行は先頭全角スペースを除去した行で文分割
      const srcLineForSplit = hasIndent ? srcLine.slice(1) : srcLine;
      const srcSents = splitIntoSentences(srcLineForSplit);

      // 表示用：cleanedLine から最初の全角スペースを除去
      let displayLine = cleanedLine;
      if (hasIndent) {
        const spaceIdx = cleanedLine.indexOf("\u3000");
        if (spaceIdx !== -1) {
          displayLine =
            cleanedLine.slice(0, spaceIdx) +
            cleanedLine.slice(spaceIdx + 1);
        }
      }

      // cleaned 行を文に分割（表示用）
      const cleanedSents = splitIntoSentences(displayLine);

      lineSentences.set(i, srcSents);

      // 各文を <span class="nn-sent"> として生成
      // <mark class="nn-sel"> が文境界をまたぐ場合、各 span 内で独立して開閉する
      let markOpen = false; // 直前の文で mark が閉じられずに終わっているか
      const sentHtml = cleanedSents.map((sent, j) => {
        // 直前の文から mark が開きっぱなしなら冒頭で再開する
        let inner = markOpen ? `<mark class="nn-sel">` + sent : sent;
        // この文内の mark 開閉数を数えて、文末に mark が開いたままか判定
        const opens  = (inner.match(/<mark class="nn-sel">/g) || []).length;
        const closes = (inner.match(/<\/mark>/g) || []).length;
        markOpen = opens > closes;
        // 文末で mark が開いたままなら閉じておく
        if (markOpen) inner += `</mark>`;
        return `<span class="nn-sent"
                       data-line="${i}"
                       data-sent="${j}">
                  ${inner}
                </span>`;
      }).join("");
      const lineClass = hasIndent ? "nn-line nn-line--indent" : "nn-line";
      parts.push(
        `<span class="${lineClass}"
               data-line="${i}">
            ${sentHtml}
         </span><br>`
      );


     cleanedIdx++;
    } else {
      // 空行はcleaned側でも空行としてスキップ
      while (cleanedIdx < cleanedLines.length &&
             cleanedLines[cleanedIdx]?.trim() === "") {
        cleanedIdx++;
      }
    }

    prevBlank = isBlank;
  }

  return { html: parts.join(""), lineSentences };
}

// ─────────────────────────────────────────
// 縦書きプレビュー View 本体
// ─────────────────────────────────────────
export class VerticalPreviewView extends ItemView {
  private bodyEl!:     HTMLElement;
  private scrollerEl!: HTMLElement;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer:   ReturnType<typeof setTimeout> | null = null;

  private lastFile: TFile | null = null;
  private lastText: string = "";
  private lastCursorLine = -1;
  private lastCursorCh   = -1;
  private lastSelection  = "";

  /** ソース行 → 文リスト（ソース原文、カーソル対応に使用） */
  private lineSentences = new Map<number, string[]>();

  private getRubyStyle: () => RubyStyle = () => "narou";
  private getFontSize:   () => number    = () => 16;
  private getWrapColumn: () => number    = () => 40;

  constructor(leaf: WorkspaceLeaf) { super(leaf); }

  setRubyStyleGetter(fn: () => RubyStyle): void { this.getRubyStyle = fn; }
  setFontSizeGetter(fn: () => number): void     { this.getFontSize   = fn; }
  setWrapColumnGetter(fn: () => number): void   { this.getWrapColumn = fn; }

  getViewType(): string    { return VERTICAL_VIEW_TYPE; }
  getDisplayText(): string { return "縦書きプレビュー"; }
  getIcon(): string        { return "square-kanban"; }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("nn-vertical-root");

    // ツールバー
    const toolbar = root.createEl("div", { cls: "nn-vertical-toolbar" });
    toolbar.createEl("span", { text: "縦書きプレビュー", cls: "nn-vertical-title" });

    // 縦書きコンテナ
    this.scrollerEl = root.createEl("div", { cls: "nn-vertical-scroller" });
    this.bodyEl     = this.scrollerEl.createEl("div", { cls: "nn-vertical-body" });

    await this.loadFromActiveEditor();

    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        if (this.updateTimer) window.clearTimeout(this.updateTimer);
        this.updateTimer = window.setTimeout(() => { void this.loadFromActiveEditor(); }, 500);
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView?.file) void this.loadFromActiveEditor();
      })
    );

    this.startCursorSync();
  }

  async onClose(): Promise<void> {
    if (this.updateTimer) window.clearTimeout(this.updateTimer);
    if (this.syncTimer)   window.clearTimeout(this.syncTimer);
  }

  // ─────────────────────────────────────────
  // 読み込み・レンダリング
  // ─────────────────────────────────────────
  async loadFromActiveEditor(): Promise<void> {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView?.file) return;
    const ext = mdView.file.extension;
    if (ext !== "txt" && ext !== "md") {
      this.renderEmpty("対象外のファイルです（.txt / .md のみ）。");
      return;
    }
    const text = mdView.editor.getValue();
    if (mdView.file === this.lastFile && text === this.lastText) return;
    this.lastFile = mdView.file;
    this.lastText = text;
    this.renderContent(text);
  }

  forceReload(): void { this.lastText = ""; void this.loadFromActiveEditor(); }

  // ─────────────────────────────────────────
  // 設定値（フォントサイズ・折り返し文字数）を
  // bodyEl の CSS 変数に反映する。
  // エディター・小説閲覧ビューと折り返し位置を揃えるため、
  // 縦書き（1列の文字数 = 横書きの max-width 相当）には
  // max-height: ${wrapColumn}em を用いる。
  // ─────────────────────────────────────────
  // 句点（。）など一部のグリフは、指定フォントの仕様上
  // 専有幅が 1em よりわずかに大きい（実測で句点1個あたり約 0.5em 超過）。
  // 1行に句点が複数含まれると超過が累積し、本来の文字数より早く
  // 折り返ってしまう。0.5em のマージンを加えることで、句点1個分の
  // 超過までは許容し、最低限「句点1個でズレる」事態を防ぐ。
  // ※ 句点3個以上が1行に集中する場合は、なお1文字分短くなることがある。
  // ※ 使用フォントを変更した場合はこの補正値の再調整が必要。
  private static readonly PUNCTUATION_MARGIN_EM = 0.5;

  private applyLayoutSettings(): void {
    if (!this.bodyEl) return;
    const fontSize   = this.getFontSize();
    const wrapColumn = this.getWrapColumn();
    const maxHeight  = wrapColumn + VerticalPreviewView.PUNCTUATION_MARGIN_EM;
    this.bodyEl.style.setProperty("--nn-vertical-font-size", `${fontSize}px`);
    this.bodyEl.style.setProperty("--nn-vertical-max-height", `${maxHeight}em`);
  }

  private renderContent(text: string): void {
    if (!this.bodyEl) return;

    this.applyLayoutSettings();

    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const sel = mdView?.editor.getSelection() ?? "";

    const { html, lineSentences } = toVerticalHtml(text, this.getRubyStyle(), sel);
    this.lineSentences = lineSentences;

    let textEl = this.bodyEl.querySelector<HTMLElement>(".nn-vertical-text");
    if (!textEl) {
      textEl = this.bodyEl.createEl("div", { cls: "nn-vertical-text" });
    }
    // DOMParser でパースしてノードを直接追加（innerHTML 不使用）
    const parsed1 = new DOMParser().parseFromString(html, "text/html");
    textEl.empty();
    for (const node of Array.from(parsed1.body.childNodes)) {
      textEl.appendChild(textEl.ownerDocument.adoptNode(node));
    }

    // DOM 確定後に右端→カーソル位置へ同期
    this.lastCursorLine = -1;
    this.lastCursorCh   = -1;
    window.requestAnimationFrame(() => {
      this.scrollerEl.scrollLeft = this.scrollerEl.scrollWidth;
      window.requestAnimationFrame(() => this.syncCursorToPreview(true));
    });
  }

  private renderEmpty(message: string): void {
    if (!this.bodyEl) return;
    this.applyLayoutSettings();
    this.bodyEl.empty();
    this.bodyEl.createEl("p", { text: message, cls: "nn-vertical-empty" });
    this.lineSentences = new Map();
  }

  // ─────────────────────────────────────────
  // カーソル・選択 連動ポーリング（100ms）
  // ─────────────────────────────────────────
  private startCursorSync(): void {
    const tick = () => {
      this.syncCursorToPreview(false);
      this.syncTimer = window.setTimeout(tick, 100);
    };
    this.syncTimer = window.setTimeout(tick, 100);
  }

  private syncCursorToPreview(force: boolean): void {
    if (!this.bodyEl || !this.scrollerEl) return;

    const mdView     = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cursor     = mdView ? mdView.editor.getCursor() : null;
    const cursorLine = cursor?.line ?? this.lastCursorLine;
    const cursorCh   = cursor?.ch   ?? this.lastCursorCh;
    const selection  = mdView ? (mdView.editor.getSelection() ?? "") : this.lastSelection;

    const cursorChanged    = force || cursorLine !== this.lastCursorLine || cursorCh !== this.lastCursorCh;
    const selectionChanged = selection !== this.lastSelection;

    if (!cursorChanged && !selectionChanged) return;

    // 選択ハイライト更新
    if (selectionChanged && this.lastText) {
      this.lastSelection = selection;
      const { html, lineSentences } = toVerticalHtml(
        this.lastText, this.getRubyStyle(), selection
      );
      this.lineSentences = lineSentences;
      const textEl = this.bodyEl.querySelector<HTMLElement>(".nn-vertical-text");
      // DOMParser でパースしてノードを直接追加（innerHTML 不使用）
      if (textEl) {
        const parsed2 = new DOMParser().parseFromString(html, "text/html");
        textEl.empty();
        for (const node of Array.from(parsed2.body.childNodes)) {
          textEl.appendChild(textEl.ownerDocument.adoptNode(node));
        }
      }
    }

    // カーソル文単位ハイライト + スクロール
    if (cursorChanged && cursorLine >= 0) {
      this.lastCursorLine = cursorLine;
      this.lastCursorCh   = cursorCh;

      // ── カーソル行の文インデックスを特定 ──────────
      //
      // カーソルが空行にある場合は前後の非空行を探す
      let targetLine = cursorLine;
      while (!this.lineSentences.has(targetLine) && targetLine > 0) {
        targetLine--;
      }
      if (!this.lineSentences.has(targetLine)) {
        // 前方に非空行がなければ後方を探す
        targetLine = cursorLine;
        while (!this.lineSentences.has(targetLine) && targetLine < 99999) {
          targetLine++;
        }
      }

      const sents = this.lineSentences.get(targetLine) ?? [];

      // カーソル文字位置（ch）から行内の文インデックスを決定
      // カーソルが targetLine にある場合は ch を使用、
      // 空行からフォールバックした場合は行末（最後の文）を使用
      //
      // 字下げ行（先頭全角スペースあり）は lineSentences に
      // 全角スペース除去後の srcSents を格納しているため、
      // エディタ上の ch から 1 引いてオフセットを補正する。
      let adjustedCh = cursorCh;
      if (targetLine === cursorLine) {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const targetSrcLine = mdView?.editor.getLine(targetLine) ?? "";
        if (targetSrcLine.startsWith("\u3000")) {
          adjustedCh = Math.max(0, cursorCh - 1);
        }
      }
      const sentIdx = (targetLine === cursorLine)
        ? cursorChToSentIdx(sents, adjustedCh)
        : sents.length - 1;

      // ── ハイライトを付け替え ──────────────────────
      this.bodyEl.querySelectorAll<HTMLElement>(".nn-cursor")
        .forEach(el => el.classList.remove("nn-cursor"));

      const targetEl = this.bodyEl.querySelector<HTMLElement>(
        `.nn-sent[data-line="${targetLine}"][data-sent="${sentIdx}"]`
      );
      if (!targetEl) return;
      targetEl.classList.add("nn-cursor");

      // ── スクロール位置計算 ───────────────────────
      //
      // getBoundingClientRect() でビューポート上の位置を取得し、
      // 現在の scrollLeft を加味してコンテナ内絶対X座標を求める。
      // 対象文の列をビューポート中央に合わせる。
      //
      const scrollerRect   = this.scrollerEl.getBoundingClientRect();
      const targetRect     = targetEl.getBoundingClientRect();
      const containerWidth = this.scrollerEl.clientWidth;
      const scrollWidth    = this.scrollerEl.scrollWidth;

      const absCenter =
        targetRect.left - scrollerRect.left + this.scrollerEl.scrollLeft
        + targetRect.width / 2;

      const desiredLeft = absCenter - containerWidth / 2;

      this.scrollerEl.scrollTo({
        left: Math.max(0, Math.min(desiredLeft, scrollWidth - containerWidth)),
        behavior: force ? "instant" : "smooth",
      });
    }
  }
}
