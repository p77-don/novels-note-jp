// ─────────────────────────────────────────
// Novels Note JP — 縦書きプレビュー View
// ─────────────────────────────────────────

import { ItemView, WorkspaceLeaf, MarkdownView, TFile } from "obsidian";
import { VERTICAL_VIEW_TYPE } from "./types";
import { RubyStyle } from "./settings";

// ─────────────────────────────────────────
// ルビ変換
// ─────────────────────────────────────────
export function convertRuby(text: string, style: RubyStyle): string {
  switch (style) {
    case "narou":
      text = text.replace(/\|([^《\n]+)《([^》\n]*)》/g, "<ruby>$1<rt>$2</rt></ruby>");
      text = text.replace(/([\u3005\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]+)《([^》\n]*)》/g, "<ruby>$1<rt>$2</rt></ruby>");
      return text;
    case "aozora":
      text = text.replace(/｜([^《\n]+)《([^》\n]*)》/g, "<ruby>$1<rt>$2</rt></ruby>");
      text = text.replace(/([\u3005\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]+)《([^》\n]*)》/g, "<ruby>$1<rt>$2</rt></ruby>");
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
// 例）「　むかしむかし、あるところに」
//  →  ["　", "むかしむかし、あるところに"]
//
// ─────────────────────────────────────────
function splitIntoSentences(line: string): string[] {
  if (line.length === 0) return [];

  const sentences: string[] = [];
  let buf = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    buf += ch;

    // 文の終端となる文字
    const isEnd =
      ch === "。" || ch === "！" || ch === "？" ||
      ch === "!" || ch === "?" ||
      ch === "」" || ch === "』" || ch === "）" || ch === ")";

    // 先頭全角スペース：字下げ部分を独立した文として切り出す
    const isLeadingSpace = buf === "\u3000";

    if (isEnd || isLeadingSpace) {
      sentences.push(buf);
      buf = "";
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
interface SentenceInfo {
  line: number;  // ソース行番号
  sent: number;  // 行内文インデックス
  text: string;  // 文のテキスト（ソース原文）
}

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

  // Step 1〜5: Markdown・Obsidian 記号除去
  let cleaned = source;
  cleaned = cleaned.replace(/^---[\s\S]*?^---[ \t]*\n?/m, "");
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
  cleaned = cleaned.replace(/^[-*_]{3,}[ \t]*$/gm, "");
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

  // Step 9: 選択テキストのハイライト
  if (selectedText.length > 0) {
    const escaped = selectedText
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (escaped.length > 0) {
      const selParts = cleaned.split(/(<ruby>[\s\S]*?<\/ruby>)/g);
      cleaned = selParts.map((part, i) => {
        if (i % 2 === 1) return part;
        return part.split(escaped).join(`<mark class="nn-sel">${escaped}</mark>`);
      }).join("");
    }
  }

  // Step 10: ソース行と cleaned 行を対応させながら
  //          文単位の <span> を生成する
  //
  // ・ソース行を splitIntoSentences() で文に分割
  // ・cleaned 行も同様に文に分割（表示用テキスト）
  // ・data-line="ソース行番号" data-sent="行内文番号" を付与
  //
  const sourceLines  = source.split("\n");
  const cleanedLines = cleaned.split("\n");

  const lineSentences = new Map<number, string[]>(); // ソース行 → 文リスト（ソース原文）
  const parts: string[] = [];
  let prevBlank = true;
  let firstPara = true;
  let cleanedIdx = 0;

  for (let i = 0; i < sourceLines.length; i++) {
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
      // ソース行を文に分割（カーソル対応テーブル用）
      const srcSents     = splitIntoSentences(srcLine);
      // cleaned 行を文に分割（表示用）
      const cleanedSents = splitIntoSentences(cleanedLine);

      lineSentences.set(i, srcSents);

      // 各文を <span class="nn-sent"> として生成
      const sentHtml = cleanedSents.map((sent, j) => {
        return `<span class="nn-sent"
                       data-line="${i}"
                       data-sent="${j}">
                  ${sent}
                </span>`;
      }).join("");
      parts.push(
        `<span class="nn-line"
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

  constructor(leaf: WorkspaceLeaf) { super(leaf); }

  setRubyStyleGetter(fn: () => RubyStyle): void { this.getRubyStyle = fn; }

  getViewType(): string    { return VERTICAL_VIEW_TYPE; }
  getDisplayText(): string { return "縦書きプレビュー"; }
  getIcon(): string        { return "book"; }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("nn-vertical-root");

    // ツールバー
    const toolbar = root.createEl("div", { cls: "nn-vertical-toolbar" });
    toolbar.createEl("span", { text: "縦書きプレビュー", cls: "nn-vertical-title" });
    const reloadBtn = toolbar.createEl("button", { cls: "nn-btn", title: "再読み込み" });
    reloadBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14">
      <path fill="currentColor" d="M13.6 2.4A7 7 0 1 0 15 8h-2a5 5 0 1 1-1.1-3.1L10 7h5V2l-1.4.4z"/>
    </svg>`;
    reloadBtn.addEventListener("click", () => {
      this.lastText = "";
      this.loadFromActiveEditor();
    });

    // 縦書きコンテナ
    this.scrollerEl = root.createEl("div", { cls: "nn-vertical-scroller" });
    this.bodyEl     = this.scrollerEl.createEl("div", { cls: "nn-vertical-body" });

    await this.loadFromActiveEditor();

    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        if (this.updateTimer) clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => this.loadFromActiveEditor(), 500);
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView?.file) this.loadFromActiveEditor();
      })
    );

    this.startCursorSync();
  }

  async onClose(): Promise<void> {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    if (this.syncTimer)   clearTimeout(this.syncTimer);
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

  forceReload(): void { this.lastText = ""; this.loadFromActiveEditor(); }

  private renderContent(text: string): void {
    if (!this.bodyEl) return;

    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const sel = mdView?.editor.getSelection() ?? "";

    const { html, lineSentences } = toVerticalHtml(text, this.getRubyStyle(), sel);
    this.lineSentences = lineSentences;

    let textEl = this.bodyEl.querySelector<HTMLElement>(".nn-vertical-text");
    if (!textEl) {
      textEl = this.bodyEl.createEl("div", { cls: "nn-vertical-text" });
    }
    textEl.innerHTML = html;

    // DOM 確定後に右端→カーソル位置へ同期
    this.lastCursorLine = -1;
    this.lastCursorCh   = -1;
    requestAnimationFrame(() => {
      this.scrollerEl.scrollLeft = this.scrollerEl.scrollWidth;
      requestAnimationFrame(() => this.syncCursorToPreview(true));
    });
  }

  private renderEmpty(message: string): void {
    if (!this.bodyEl) return;
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
      this.syncTimer = setTimeout(tick, 100);
    };
    this.syncTimer = setTimeout(tick, 100);
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
      if (textEl) textEl.innerHTML = html;
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
      const sentIdx = (targetLine === cursorLine)
        ? cursorChToSentIdx(sents, cursorCh)
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
