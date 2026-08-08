// ─────────────────────────────────────────
// Novels Note JP — 縦書きプレビュー View
// ─────────────────────────────────────────

import { ItemView, WorkspaceLeaf, MarkdownView, TFile, Platform, Editor } from "obsidian";
import { VERTICAL_VIEW_TYPE } from "../types";
import { RubyStyle } from "../settings";
import { convertRubyAndEscape } from "../core/rubyPatterns";
import { stripHashtags } from "../core/hashtags";
import { CursorSyncStore, CursorSyncSnapshot } from "../editor/cursorSyncStore";

// ─────────────────────────────────────────
// ルビ変換 + HTML エスケープ
//
// 【セキュリティ】
// 旧実装は convertRuby() でルビ記法から <ruby>...</ruby> を素朴な
// 文字列置換で生成した後、escapeHtmlExceptRuby() で
// <ruby>...</ruby> ブロック全体をまるごとエスケープ対象外にしていた。
// しかしルビ記法の「親文字」「ルビ文字」には "<" ">" などの
// HTML特殊文字を含む任意の文字列がマッチし得るため、本文に
//   |<img src=x onerror=alert(1)>《ふりがな》
// のような記法を書くと、エスケープされないまま実DOMに挿入され、
// スクリプトが実行される脆弱性があった（XSS）。
//
// convertRubyAndEscape()（core/rubyPatterns.ts）は、先にルビ記法の
// 範囲だけを検出し、親文字・ルビ文字を個別に HTML エスケープしてから
// <ruby> タグを組み立てる。ルビ記法以外の地の文もすべてエスケープ
// されるため、上記のような攻撃はタグとして解釈されなくなる。
// 検出ロジック自体もエディタ内プレビュー・Export と共有している。
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// 縦中横（ruby タグ外のみ）
//
// 対象は2種類：
//   1. 半角英数字・記号の連続（例: "12", "2024", "URL" など）
//      → 2文字以下は tcy（1文字分に収めて縦組みのまま表示）
//      → 3文字以上は latin（横倒しにして読みやすくする）
//   2. 感嘆符・疑問符の連続（半角 !? と全角 ！？ の両方に対応）
//      例: "!", "?", "!?", "?!", "!!", "??", "！？" など
//      → こちらは常に tcy（1文字分に収めて縦組みのまま表示）。
//        半角の "!" "?" は何もしないと横倒しの向きで表示され
//        読みにくくなるため、単独でも tcy 対象に含める。
//        3文字以上の連続（例: "!!!"）はまれで、収めると潰れて
//        読みにくくなるため対象外とし、素通りさせる。
// ─────────────────────────────────────────
function applyTcy(text: string): string {
  const parts = text.split(/(<ruby>[\s\S]*?<\/ruby>|<rt>[\s\S]*?<\/rt>)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;

    return part
      .replace(
        // 半角スペース／タブ区切りで連続する英数字トークンを
        // 「ひとかたまり」として捉える。前後に別の単語が続く場合
        // （＝英文・フレーズの一部）は、個々の単語が2文字以下でも
        // 縦中横にしない。他に単語が続かない「単独の短いトークン」
        // （文中に埋め込まれた略語・数字など、例：「AIが」「1980年」）
        // だけを縦中横の対象とする。
        // 例）"Novels Note JP" → ひとかたまりとして扱われ、
        //     "JP" だけが縦中横になることはない。
        /([A-Za-z0-9._:/+-]+(?:[ \t]+[A-Za-z0-9._:/+-]+)*)/g,
        (m) => {
          const words = m.split(/[ \t]+/);
          if (words.length === 1 && m.length <= 2) {
            return `<span class="tcy">${m}</span>`;
          }
          return `<span class="latin">${m}</span>`;
        }
      )
      .replace(
        /([!?！？]{1,2})/g,
        (m) => `<span class="tcy">${m}</span>`
      );
  }).join("");
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
// 表示用HTML断片 → 見た目の文字数（コードポイント数）
//
// ・<rt>...</rt>（ルビの読み）は表示上「地の文の流れ」には
//   含まれないため、丸ごと除外する
// ・残りのタグ（<ruby> <span class="tcy"> など）は除去し、
//   実際に画面に表示される文字だけを数える
// ・サロゲートペア（CJK拡張B〜G等）を正しく1文字として
//   数えるため [...str].length を使う
// ─────────────────────────────────────────
function plainVisibleLength(html: string): number {
  // <rt> は font-size 調整のため style 属性が付くことがある
  // （core/rubyPatterns.ts の computeRtFontSizeEm() 参照）ため、
  // 属性の有無を問わずマッチさせる
  const noRt = html.replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/g, "");
  const stripped = noRt.replace(/<[^>]+>/g, "");
  return [...stripped].length;
}

// ─────────────────────────────────────────
// 文字列内の「コードポイントオフセット」を
// Range.setStart/setEnd が要求する「UTF-16オフセット」に変換する
//
// （サロゲートペアは1コードポイント=UTF-16では2単位のため、
//   単純な文字インデックスでは Range の位置がズレる）
// ─────────────────────────────────────────
function codepointOffsetToUtf16(str: string, cpOffset: number): number {
  let cpCount = 0;
  let utf16 = 0;
  for (const ch of str) {
    if (cpCount === cpOffset) return utf16;
    cpCount++;
    utf16 += ch.length;
  }
  return utf16;
}

// ─────────────────────────────────────────
// DOM上で「見た目のコードポイントオフセット」に対応する
// テキストノード + UTF-16オフセットを探す
//
// ・lineEl（.nn-line）配下のテキストノードを走査
// ・<rt>（ルビの読み）配下のテキストノードはスキップする
//   （plainVisibleLength() の除外基準と一致させるため）
// ─────────────────────────────────────────
function locateOffsetInLine(
  lineEl: HTMLElement,
  targetCp: number
): { node: Text; offset: number } | null {
  const doc = lineEl.ownerDocument;
  const walker = doc.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      let p: HTMLElement | null = node.parentElement;
      while (p && p !== lineEl) {
        if (p.tagName === "RT") return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let cpCount = 0;
  let node: Node | null;
  let lastText: Text | null = null;

  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    lastText = textNode;
    const text = textNode.textContent ?? "";
    const len = [...text].length;
    if (cpCount + len >= targetCp) {
      const localCp = targetCp - cpCount;
      return { node: textNode, offset: codepointOffsetToUtf16(text, localCp) };
    }
    cpCount += len;
  }

  // targetCp が行末を超えている場合は最後のテキストノード末尾を返す
  if (lastText) {
    return { node: lastText, offset: (lastText.textContent ?? "").length };
  }
  return null;
}

// ─────────────────────────────────────────
// 指定した文（見た目のコードポイント範囲 [startCp, endCp)）を
// DOM Range として構築する
// ─────────────────────────────────────────
function buildSentenceRange(
  lineEl: HTMLElement,
  startCp: number,
  endCp: number
): Range | null {
  const startPos = locateOffsetInLine(lineEl, startCp);
  const endPos = locateOffsetInLine(lineEl, endCp);
  if (!startPos || !endPos) return null;

  const range = lineEl.ownerDocument.createRange();
  try {
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
  } catch {
    return null;
  }
  return range;
}

// ─────────────────────────────────────────
// 縦書き本文 DOM の差分更新
//
// 【背景・重要】
// 以前は「変わった行だけを個別に差し替える」行単位の差分更新を
// 行っていたが、それでもちらつきは解消しなかった。実測（Chromium
// のレイアウト計測）の結果、原因はDOM操作の粒度ではなく、
// CSS のレイアウトコストそのものにあることが判明した：
//
//   .nn-vertical-body は writing-mode: vertical-rl の
//   単一の連続フローであり、この中の1行のテキスト量が変わると、
//   ブラウザはその行以降の折り返し（列の区切り）位置を
//   すべて再計算する。実測では、300行（約1万文字）の文書で
//   1行だけ1文字追記しても、DOM操作をその1行の <span> だけに
//   絞っても、強制レイアウトに 10〜20ms かかっていた
//   （かつ文書が長いほど比例して悪化する）。これは 60fps の
//   1フレーム予算（約16.7ms）を圧迫・超過する量であり、
//   「入力のたびに画面がちらつく」の正体はこの再レイアウトの
//   重さそのものだった。DOM差分の粒度をいくら細かくしても、
//   ブラウザ側のレイアウト計算自体は文書全体に対して走るため
//   解消しなかった。
//
//   対策として、本文を「段落単位（＋長い段落は一定行数ごと）」で
//   .nn-chunk という独立した writing-mode: vertical-rl の
//   レイアウトコンテキスト（display: inline-block）に分割した。
//   同じ実測方法で検証したところ、チャンク分割後は編集コストが
//   4〜13ms程度まで下がり、かつ文書全体のサイズに比例しなくなる
//   （チャンク1つぶんのサイズにしか依存しなくなる）ことを確認済み。
//
// 【DOM構造】
// トップレベルの子要素列は次の1種類のブロックが並ぶ：
//   ・<span class="nn-chunk" data-chunk="開始行番号">
//       <span class="nn-line" data-line="N">...</span><br>
//       ...（最大 CHUNK_MAX_LINES 行、または段落／空行の連続の
//            切れ目まで）
//     </span>
//
// 空行はソース1行につき1行分の「中身が空の .nn-line」として
// そのまま出力する（エディタで見えるのと同じ行数・行送りを
// プレビュー側でも保つため。以前は空行を読み飛ばして段落の
// 切れ目に固定幅の区切りスペーサーを1個だけ挿む実装だったが、
// これだと空行が何行連続していても区切り1個分にしか見えず、
// 「空行が圧縮される」問題の原因になっていた）。
//
// data-chunk（チャンク先頭行番号）の出現順を安定したキーとして
// 新旧のブロック列を比較し、構造（チャンクの並び）が変わって
// いなければ、中身が実際に変わったチャンクの <span> 要素だけを
// 丸ごと差し替える。1チャンクの内部で何行変わっていても、
// 置き換えの単位は常にチャンク1個分（最大 CHUNK_MAX_LINES 行）に
// 制限されるため、レイアウトコストが文書全体のサイズに依存しない。
//
// パフォーマンス最適化のため、非空行の連続（段落）と空行の連続の
// 境目でも必ずチャンクを区切る（通常のタイピングは常にどちらか
// 一方の内部で完結するため）。
//
// 段落の増減・チャンク数が変わるような構造変化（Enterで新しい
// 段落ができた場合など）はキー列が一致しなくなるため、安全のため
// 丸ごと作り直す（この場合のみ、従来通りの全体再レイアウトが
// 発生する。通常のタイピングよりずっと低頻度）。
// ─────────────────────────────────────────
interface DomBlock {
  kind: "chunk";
  key: string;
  /** "chunk" は span 1個 */
  nodes: Element[];
}

function extractBlocks(nodes: ChildNode[]): DomBlock[] | null {
  const blocks: DomBlock[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (!node.instanceOf(Element) || node.tagName !== "SPAN") return null;

    if (node.classList.contains("nn-chunk")) {
      blocks.push({ kind: "chunk", key: `C${node.getAttribute("data-chunk") ?? ""}`, nodes: [node] });
      i += 1;
    } else {
      // 想定外の構造。診断を諦め、呼び出し元に丸ごと作り直させる
      return null;
    }
  }
  return blocks;
}

function patchVerticalBody(textEl: HTMLElement, html: string): void {
  const parsedDoc = new DOMParser().parseFromString(html, "text/html");
  const newNodes  = Array.from(parsedDoc.body.childNodes);
  const newBlocks = extractBlocks(newNodes);
  const oldBlocks = extractBlocks(Array.from(textEl.childNodes));

  const sameStructure =
    oldBlocks !== null &&
    newBlocks !== null &&
    oldBlocks.length === newBlocks.length &&
    oldBlocks.every((b, i) => b.key === newBlocks[i].key);

  if (!sameStructure || !oldBlocks || !newBlocks) {
    // 段落構成（チャンク数）が変わった、または診断不能。
    // 安全側に倒して丸ごと作り直す。
    textEl.empty();
    for (const node of newNodes) {
      textEl.appendChild(textEl.ownerDocument.adoptNode(node));
    }
    return;
  }

  // 構造は同じなので、中身が実際に変わったチャンクだけを丸ごと
  // 差し替える。
  for (let i = 0; i < oldBlocks.length; i++) {
    const oldB = oldBlocks[i];
    const newB = newBlocks[i];
    const oldEl = oldB.nodes[0];
    const newEl = newB.nodes[0];
    if (oldEl.innerHTML !== newEl.innerHTML || oldEl.className !== newEl.className) {
      const adopted = textEl.ownerDocument.adoptNode(newEl);
      textEl.replaceChild(adopted, oldEl);
    }
  }
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
  /**
   * ソース行番号 → その行の各文の「見た目の文字数（コードポイント数）」
   * 表示DOM上で文の開始・終了オフセットを求め、Range を構築するために使う。
   * （HTML上に文単位の <span> は存在しないため、レンダリング後の
   *   DOM を TreeWalker で辿って対応するテキスト位置を探す）
   */
  lineSentPlainLengths: Map<number, number[]>;
}

// ─────────────────────────────────────────
// テキスト → 縦書き HTML 変換
//
// 【HTML 構造】
//
//   <span class="nn-line" data-line="N">文章がそのまま地の文として続く</span>
//   <br>  ← 行の後に改行（= 縦書きの行送り）
//   <span class="nn-line" data-line="N+1">次の行の文章</span>
//   <br>
//   <span class="nn-line" data-line="N+2"></span><br>  ← 空行（中身なし、行送りだけ発生）
//
// 【文単位の <span> を廃止した理由】
// 以前は行内の各文を <span class="nn-sent">…</span> で個別に
// 囲んでいたが、縦書きの折り返し（禁則処理・約物の詰め処理）は
// ブラウザが「連続したテキストの流れ」に対して最適化しているため、
// 文ごとに <span> 境界を挟むと、1行に句点が複数あるケースなどで
// 折り返し位置がズレる問題があった。
//
// 現在は行の中身をタグ挟みのプレーンテキストとして出力し、
// カーソル位置・スクロール位置の特定には HTML 側の <span> ではなく
// レンダリング後の DOM を Range で直接指し示す方式
// （buildSentenceRange() / CSS Custom Highlight API）を用いる。
// そのための文境界情報が lineSentPlainLengths。
//
// ・data-line でソース行を保持
// ・カーソル行 + カーソル文字位置 → 文インデックス → 見た目の
//   コードポイント範囲 → buildSentenceRange() で Range を構築
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
  // ─────────────────────────────────────────
  // Step 0.5: コードブロックの行を「空行プレースホルダー」に変換する
  //
  // 横書きプレビュー（novelReadingView.ts）はコードブロックを完全に
  // 非表示にしている。縦書きプレビューでも同じ本文を表示するため
  // 内容は表示しないが、単純に丸ごと空文字列に置換すると改行ごと
  // 消えてしまい、それ以降のソース行番号とプレビュー側の行番号が
  // ズレる（エディタとのカーソル同期が壊れる）。
  //
  // そのため、コードブロックの各行（フェンス行・内容行とも）を
  // 1行→1プレースホルダー1行の対応を保ったまま、後続の Markdown
  // 変換（見出し・強調・ルビ・縦中横など）の対象にならない
  // 不透明なプレースホルダートークンに置き換え、Step 10 の直前で
  // 空文字列に変換する（＝内容は消えるが行数は保たれる）。
  //
  // プレースホルダーには ASCII の英数字を一切使わない
  // （Step 8 の縦中横変換 /[A-Za-z0-9._:/+-]+/ が誤ってマッチするのを
  //   防ぐため、行数のカウントは全角数字でエンコードする）。
  // ─────────────────────────────────────────
  let codeLineCount = 0;
  const toFullWidthDigits = (n: number): string =>
    String(n).replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 0xFEE0));

  // プレースホルダーの前後マーカーには制御文字（\x00）ではなく
  // Unicode 私用領域（Private Use Area）の文字を使う。
  // 通常のテキストには出現せず、かつ正規表現リテラル中の
  // 制御文字警告（no-control-regex 等）も回避できる。
  const CODE_PLACEHOLDER_MARK = "\uE000";
  const protectCodeBlock = (whole: string): string =>
    whole
      .split("\n")
      .map(() => `${CODE_PLACEHOLDER_MARK}${toFullWidthDigits(codeLineCount++)}${CODE_PLACEHOLDER_MARK}`)
      .join("\n");

  cleaned = cleaned.replace(/^```[\s\S]*?^```[ \t]*$/gm, protectCodeBlock);
  cleaned = cleaned.replace(/^~~~[\s\S]*?^~~~[ \t]*$/gm, protectCodeBlock);

  // Step 1〜5: Markdown・Obsidian 記号除去
  // （novelReadingView.ts の cleanSource() と同じ内容にすることで、
  //   横書きプレビューと縦書きプレビューで表示される「本文」を一致させる）
  //
  // 【複数行にまたがるマッチを空文字列に置換する処理の注意点】
  // 以下のような正規表現：
  //   ・%%コメント%%（Obsidianの仕様上、複数行にまたがりうる）
  //   ・Callout ブロック（> [!note] ... の複数行）
  //   ・画像記法（通常1行だが、alt文字列やURLが万一複数行にまたがる場合）
  // は、マッチした範囲全体（内部の改行を含む）を "" に置換すると、
  // 改行ごと消えてソース行数とプレビュー側の行数がズレる
  // （＝エディタとのカーソル位置がズレる）原因になる。
  // マッチ内の改行の数だけ "\n" を残す置換関数を使うことで、
  // 内容は消しつつ行数だけは保つ。
  // ─────────────────────────────────────────
  const stripKeepingLines = (whole: string): string =>
    "\n".repeat((whole.match(/\n/g) ?? []).length);

  // Frontmatter は文書の先頭（行0）から始まる場合のみ除去
  // （消える行数は frontmatterLineCount で別途補正しているため、
  //   ここは行数保持の対象外でよい）
  cleaned = cleaned.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*\n?/, "");
  cleaned = cleaned.replace(/%%[\s\S]*?%%/g, stripKeepingLines);
  cleaned = cleaned.replace(/^(>[ \t]*\[![\w-]+\][^\n]*\n(?:>[ \t]*[^\n]*\n?)*)/gm, stripKeepingLines);
  cleaned = cleaned.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  cleaned = cleaned.replace(/\[\[([^\]]+)\]\]/g, "$1");
  // タグ削除（判定ロジックは core/hashtags.ts に共通化。
  // 横書きプレビュー・Export・文字数カウントと基準を統一する）
  cleaned = stripHashtags(cleaned);
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ");
  cleaned = cleaned.replace(/^[ \t]+$/gm, "");
  cleaned = cleaned.replace(/^#{1,6}[ \t]+/gm, "");
  cleaned = cleaned.replace(/^>[ \t]?/gm, "");
  cleaned = cleaned.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  cleaned = cleaned.replace(/^[ \t]*\d+\.[ \t]+/gm, "");
  cleaned = cleaned.replace(/(\*{1,3}|_{1,3})([\s\S]*?)\1/g, "$2");
  // 区切り線 --- は小説の文章区切りとして「―――」に変換（縦書きで自然に見える）
  // ※横書きプレビューでは単純に除去しているが、縦書きでは視覚的な
  //   場面転換の区切りとして機能するため、あえて残している。
  cleaned = cleaned.replace(/^(-{3,})[ \t]*$/gm, (_: string, dashes: string) => "―".repeat(dashes.length));
  cleaned = cleaned.replace(/^[*_]{3,}[ \t]*$/gm, "");
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, stripKeepingLines);
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // HTML タグ除去（ruby・rt は除外。ルビ記法として後段で処理するため）
  //
  // 【注意：改行をまたがせない】
  // 横書きプレビュー（novelReadingView.ts）と同じ正規表現を
  // [^>]+（改行にもマッチする）のまま使うと、対応する ">" のない
  // "<" が文章中にあった場合（例："これは< 不等号のテスト"）、
  // ずっと後の行にある無関係な ">" までを「1つのタグ」とみなして
  // 貪欲マッチし、その間の複数行が改行ごと丸ごと消えてしまう。
  // 横書きプレビューは行番号を保持する必要がないため問題にならないが、
  // 縦書きプレビューはソース行との1:1対応が前提のため、これが
  // エディタとのカーソル位置ズレの原因になっていた。
  // [^>\n] にして改行をまたいだマッチを禁止することで防ぐ
  // （その副作用として、複数行にまたがる本物のHTMLタグは検出されず
  //   そのまま文字として残るが、行がまるごと消えるよりはるかに安全）。
  cleaned = cleaned.replace(/<(?!\/?(ruby|rt)\b)[^>\n]+>/gi, "");

  // Step 6〜7: ルビ変換 + HTML エスケープ（安全な1関数にまとめて処理する）
  cleaned = convertRubyAndEscape(cleaned, rubyStyle);

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

  // ─────────────────────────────────────────
  // Step 9.5: コードブロックのプレースホルダーを除去する
  //
  // 横書きプレビュー（novelReadingView.ts）はコードブロックを
  // 完全に非表示にしており、縦書きプレビューでも同じ「本文」を
  // 表示するために内容は表示しない。
  //
  // ただし Step 0.5 のプレースホルダー方式（1行→1プレースホルダー1行）
  // 自体は維持し、プレースホルダーを「空文字列」に置き換えるだけに
  // とどめている。これにより、内容は表示されないままソース行数との
  // 対応（エディタとのカーソル同期・行番号の一致）だけは保たれる。
  // ─────────────────────────────────────────
  if (codeLineCount > 0) {
    cleaned = cleaned.replace(/\uE000[０-９]+\uE000/g, "");
  }

  // Step 10: ソース行と cleaned 行を対応させながら
  //          行ごとのプレーンテキストを出力する
  //          （文の境界情報自体は lineSentences / lineSentPlainLengths
  //            として別途保持し、DOM には文単位の <span> を作らない）
  //
  // ・ソース行を splitIntoSentences() で文に分割（カーソル対応用）
  // ・cleaned 行も同様に文に分割し、各文の見た目の文字数を記録
  // ・data-line="ソース行番号" を付与
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

  // ─────────────────────────────────────────
  // 縦書きレイアウトの再計算コストを文書サイズに依存させないため、
  // 段落単位（＋長い段落は一定行数ごと）で本文を「チャンク」に
  // 分割する。詳細は patchVerticalBody() のコメントを参照。
  // ─────────────────────────────────────────
  const CHUNK_MAX_LINES = 20;

  const lineSentences = new Map<number, string[]>();         // ソース行 → 文リスト（ソース原文）
  const lineSentPlainLengths = new Map<number, number[]>();  // ソース行 → 各文の見た目の文字数
  const parts: string[] = [];
  let prevBlank = true;

  let chunkParts: string[] = [];
  let chunkStartLine = -1;
  let chunkLineCount = 0;

  const flushChunk = (): void => {
    if (chunkParts.length === 0) return;
    parts.push(`<span class="nn-chunk" data-chunk="${chunkStartLine}">${chunkParts.join("")}</span>`);
    chunkParts = [];
    chunkStartLine = -1;
    chunkLineCount = 0;
  };

  // Frontmatter 行をスキップし、実際のコンテンツ行から処理開始
  for (let i = frontmatterLineCount; i < sourceLines.length; i++) {
    const srcLine     = sourceLines[i];
    const isBlank     = srcLine.trim() === "";
    // ─────────────────────────────────────────
    // cleaned は source と「行数が完全に1:1対応する」よう
    // Step 0.5／stripKeepingLines で保証済みのため、
    // cleanedLines は sourceLines と同じインデックス
    // （Frontmatter 分だけオフセット）で直接引ける。
    //
    // 以前はここに「cleaned 側の空行をスキップして再同期する」
    // 独自カウンタ（cleanedIdx）があったが、これは cleaned が
    // source と厳密に1:1対応していなかった旧実装（コードブロックを
    // 改行ごと丸ごと削除していた頃）の名残だった。今は逆に、
    // 正しく1:1対応している空行（コードブロック跡地など）まで
    // 読み飛ばしてしまい、以降の内容が本来より手前の行にずれて
    // 表示される原因になっていたため廃止した。
    // ─────────────────────────────────────────
    const cleanedLine = cleanedLines[i - frontmatterLineCount] ?? "";

    if (isBlank !== prevBlank) {
      // 非空行の連続（段落）と空行の連続の境目では必ずチャンクも
      // 区切る。これにより通常のタイピング（1段落内・空行の追加や
      // 削除を伴わない編集）は常にチャンク単位の差分パッチで済む。
      flushChunk();
    }

    if (isBlank) {
      // ─────────────────────────────────────────
      // 空行：ソース1行につき「中身が空の .nn-line」を1つ出力する。
      // エディタで見えるのと同じ行数・行送りをプレビュー側でも
      // そのまま保つ（以前は空行を読み飛ばし、段落の切れ目に
      // 固定幅スペーサーを1個だけ挿んでいたため、空行が何行
      // 連続していても圧縮されて見えていた）。
      // ─────────────────────────────────────────
      if (chunkStartLine === -1) chunkStartLine = i;
      chunkParts.push(`<span class="nn-line" data-line="${i}"></span><br>`);
      chunkLineCount++;

      if (chunkLineCount >= CHUNK_MAX_LINES) {
        flushChunk();
      }
    } else {
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
      lineSentPlainLengths.set(i, cleanedSents.map(plainVisibleLength));

      // ─────────────────────────────────────────
      // 行全体をプレーンテキストとして出力する（文単位の <span> は作らない）
      //
      // Step 9 の <mark class="nn-sel"> は cleaned（複数行を含む文字列）
      // に対して挿入されるため、選択範囲が複数行にまたがる場合は
      // この行の displayLine 内で <mark> が閉じずに終わっている
      // （＝次の行にまたがる）ことがある。
      // 開いたままの <mark> はこの行の末尾で一旦閉じ、開始状態は
      // 次行の処理に引き継がない（元実装と同じ挙動：selection の
      // ハイライトは行単位で独立させる）。
      // ─────────────────────────────────────────
      let inner = displayLine;
      const opens  = (inner.match(/<mark class="nn-sel">/g) || []).length;
      const closes = (inner.match(/<\/mark>/g) || []).length;
      if (opens > closes) inner += `</mark>`;

      const lineClass = hasIndent ? "nn-line nn-line--indent" : "nn-line";
      if (chunkStartLine === -1) chunkStartLine = i;
      chunkParts.push(
        `<span class="${lineClass}" data-line="${i}">${inner}</span><br>`
      );
      chunkLineCount++;

      // 1段落が非常に長い場合に備え、一定行数ごとにも強制的に
      // チャンクを区切る（レイアウトコストの上限を保証するため）。
      if (chunkLineCount >= CHUNK_MAX_LINES) {
        flushChunk();
      }
    }

    prevBlank = isBlank;
  }
  flushChunk();

  return { html: parts.join(""), lineSentences, lineSentPlainLengths };
}

// ─────────────────────────────────────────
// 縦書きプレビュー View 本体
// ─────────────────────────────────────────
export class VerticalPreviewView extends ItemView {
  private bodyEl!:     HTMLElement;
  private scrollerEl!: HTMLElement;

  private lastFile: TFile | null = null;
  private lastText: string = "";
  private lastCursorLine = -1;
  private lastCursorCh   = -1;
  private lastSelection  = "";

  /** ソース行 → 文リスト（ソース原文、カーソル対応に使用） */
  private lineSentences = new Map<number, string[]>();
  /** ソース行 → 各文の見た目の文字数（DOM上でRangeを構築するために使用） */
  private lineSentPlainLengths = new Map<number, number[]>();

  /**
   * カーソル文ハイライト用の Highlight オブジェクト（CSS Custom Highlight API）。
   * 1つのインスタンスを使い回し、範囲だけを毎回差し替える。
   * 未対応環境（極めて稀）では null のままとなり、ハイライトのみ
   * スキップされる（スクロール追従自体は Range API のみで動作する）。
   */
  private cursorHighlight: Highlight | null = null;

  /**
   * カーソル位置・選択範囲の「確定した」変化を受け取るストア。
   * IME変換中かどうかの判定を含め、エディタ側（editor/extensions.ts の
   * buildCursorSyncExtension）が責任を持つ。縦書きプレビュー側は
   * これを購読するだけで、自前でポーリング・IME判定をする必要がない。
   * main.ts から setCursorSyncStore() で渡される。
   */
  private cursorSyncStore: CursorSyncStore | null = null;
  private unsubscribeCursorSync: (() => void) | null = null;

  // フォールバック用：workspace.getActiveViewOfType(MarkdownView) は
  // 「今アクティブなリーフ」に依存するため、このビュー自身が
  // メインエリアのタブとしてアクティブになった瞬間（モバイルでの
  // 独立タブオープン時など）は編集中のノートを見つけられなくなる。
  // main.ts 側で追跡している「直近アクティブだった原稿ノート」を
  // 注入してもらい、フォールバックとして使う。
  private getLastActiveMarkdown: () => { editor: Editor; file: TFile | null } | null =
    () => null;

  private getRubyStyle: () => RubyStyle = () => "narou";
  private getFontSize:   () => number    = () => 16;
  private getWrapColumn: () => number    = () => 40;

  constructor(leaf: WorkspaceLeaf) { super(leaf); }

  setRubyStyleGetter(fn: () => RubyStyle): void { this.getRubyStyle = fn; }
  setFontSizeGetter(fn: () => number): void     { this.getFontSize   = fn; }
  setWrapColumnGetter(fn: () => number): void   { this.getWrapColumn = fn; }
  setCursorSyncStore(store: CursorSyncStore): void { this.cursorSyncStore = store; }
  setLastActiveMarkdownProvider(
    fn: () => { editor: Editor; file: TFile | null } | null
  ): void {
    this.getLastActiveMarkdown = fn;
  }

  getViewType(): string    { return VERTICAL_VIEW_TYPE; }
  getDisplayText(): string { return "縦書きプレビュー"; }
  getIcon(): string        { return "square-kanban"; }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("nn-vertical-root");
    if (Platform.isMobile) {
      root.addClass("nn-vertical-root-mobile");
    }

    // ツールバー（タイトル表示）
    // モバイルでは Obsidian 自体のタブヘッダーに既に
    // 「縦書きプレビュー」というタイトルが表示されており、
    // ここで重ねて表示すると縦書き本文の表示領域を圧迫し、
    // 下部が画面外・ツールバーの裏に隠れる原因になる。
    // そのためモバイルではこのタイトル行自体を省略する。
    if (!Platform.isMobile) {
      const toolbar = root.createDiv({ cls: "nn-vertical-toolbar" });
      toolbar.createSpan({ text: "縦書きプレビュー", cls: "nn-vertical-title" });
    }

    // 縦書きコンテナ
    this.scrollerEl = root.createDiv({ cls: "nn-vertical-scroller" });
    this.bodyEl     = this.scrollerEl.createDiv({ cls: "nn-vertical-body" });

    await this.loadFromActiveEditor();

    // ─────────────────────────────────────────
    // 【本文の再描画は editor-change ではなく CursorSyncStore 経由に統一】
    //
    // 以前はここに editor-change イベントを購読し、1200msデバウンスで
    // loadFromActiveEditor() を呼んで本文DOMを再構築する処理があった。
    // これはカーソル位置の追従（CursorSyncStore、150msデバウンス）とは
    // 完全に独立したタイマーであり、「本文再描画が完了するまでの間、
    // 新しいカーソル位置を古い文区切り情報に当てはめてしまう」
    // 世代不一致（入力文字数ぶんハイライトがズレて、再描画完了時に
    // 正しい位置へ飛ぶ不具合）の原因になっていた。
    //
    // CursorSyncStore のスナップショットに本文そのもの（text）を
    // 含めるよう拡張したことで、本文の変化とカーソル位置は常に
    // 同じスナップショットとして一体で届く。そのため本文再描画も
    // applySnapshot() 側（text !== this.lastText の判定）に統一し、
    // このファイル独自の再描画タイマーは廃止した。
    // ─────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView?.file) void this.loadFromActiveEditor();
      })
    );

    // カーソル位置・選択範囲の変化を CursorSyncStore から購読する。
    // 外部ポーリングは行わない（IME変換状態の判定はエディタ側の
    // buildCursorSyncExtension が担う）。
    //
    // モバイルでは縦書きプレビューを独立タブとして開いており、
    // エディタと同時に表示されることがないため、
    // リアルタイムのカーソル追従は購読しない（意味を持たないため）。
    if (!Platform.isMobile && this.cursorSyncStore) {
      this.unsubscribeCursorSync = this.cursorSyncStore.subscribe(
        snapshot => this.onCursorSync(snapshot)
      );
      // 購読開始時点で既に確定済みのスナップショットがあれば反映する
      this.onCursorSync(this.cursorSyncStore.get());
    }
  }

  async onClose(): Promise<void> {
    this.unsubscribeCursorSync?.();
    this.unsubscribeCursorSync = null;
    if (typeof CSS !== "undefined" && CSS.highlights) {
      CSS.highlights.delete("nn-cursor");
    }
    this.cursorHighlight = null;
  }

  // ─────────────────────────────────────────
  // 読み込み・レンダリング
  // ─────────────────────────────────────────
  async loadFromActiveEditor(): Promise<void> {
    // 通常はこちらで見つかる（デスクトップ、または
    // まだエディタがアクティブなケース）
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    let file = mdView?.file ?? null;
    let editorValue: string | null = mdView ? mdView.editor.getValue() : null;
    let selection: string = mdView ? (mdView.editor.getSelection() ?? "") : "";

    // 見つからない場合（モバイルで縦書きプレビュー自身が
    // アクティブなタブになっているケースなど）は、
    // 直近アクティブだった原稿ノートにフォールバックする。
    if (!file) {
      const fallback = this.getLastActiveMarkdown();
      if (fallback?.file) {
        file = fallback.file;
        editorValue = fallback.editor.getValue();
        selection = fallback.editor.getSelection() ?? "";
      }
    }

    if (!file) return;
    const ext = file.extension;
    if (ext !== "txt" && ext !== "md") {
      this.renderEmpty("対象外のファイルです（.txt / .md のみ）。");
      return;
    }
    const text = editorValue ?? "";
    if (file === this.lastFile && text === this.lastText) return;
    this.lastFile = file;
    this.lastText = text;
    this.lastSelection = selection;
    this.renderBody(text, this.lastSelection);
    // ファイル切り替え・初回読み込み時のみ、基準となるスクロール
    // 位置を右端（縦書きの開始位置）にリセットしてから、
    // forceSyncNow() でカーソル位置へ同期する。
    // （通常の入力・選択変更のたびにここへリセットすると、
    //   キー入力のたびにスクロールが右端へ飛ぶことになるため、
    //   ファイル読み込み時に限定している。）
    if (this.scrollerEl) {
      this.scrollerEl.scrollLeft = this.scrollerEl.scrollWidth;
    }
    // ファイル切り替え・初回読み込みでは、直前のカーソル位置は
    // 別ファイルのものなので無効化し、forceSyncNow() で
    // 現在のファイルのカーソル位置から改めて同期する。
    this.lastCursorLine = -1;
    this.lastCursorCh   = -1;
    this.forceSyncNow();
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

  // ─────────────────────────────────────────
  // 本文DOMの再構築のみを行う（カーソル同期・スクロールは行わない）
  //
  // 【設計変更の経緯】
  // 以前はこの処理の末尾で textEl.empty() により本文DOM全体を
  // 一度破棄してから丸ごと再構築していた。しかしこれは
  // ・CSS Custom Highlight API の Range が一瞬存在しないノードを
  //   指すことになる（ハイライトの瞬間消失）
  // ・文書全体（縦書きでは数千〜数万文字ぶんの列になり得る）を
  //   ブラウザに再レイアウト・再ペイントさせる（画面全体のちらつき）
  // という2つの問題を引き起こしていた。後者の方が実際の
  // ちらつきの主因であり、Range・Highlight の再構築タイミングを
  // 同期化しただけでは解決しなかった。
  //
  // 実際のDOM書き換えは patchVerticalBody() に委譲し、変わった
  // チャンクだけを個別に差し替える方式にした（詳細は同関数のコメント参照）。
  // Range の構築自体はレイアウト計算を必要としないため、DOM更新の
  // 直後・同一タスク内で同期的に行って問題ない
  // （Range.getBoundingClientRect() を使うスクロール位置計算のみ
  //   レイアウトを要するが、これは呼び出すと同期的にレイアウトが
  //   確定するため rAF を挟む必要はない）。
  //
  // そのため、このメソッドはDOM再構築だけに専念させ、
  // 呼び出し元（applySnapshot / loadFromActiveEditor）が
  // 同期的に syncCursorHighlight() を呼んでハイライト・スクロールを
  // 即座に再構築する形にしている。
  // ─────────────────────────────────────────
  private renderBody(text: string, selection: string): void {
    if (!this.bodyEl) return;

    this.applyLayoutSettings();

    const { html, lineSentences, lineSentPlainLengths } = toVerticalHtml(text, this.getRubyStyle(), selection);
    this.lineSentences = lineSentences;
    this.lineSentPlainLengths = lineSentPlainLengths;

    let textEl = this.bodyEl.querySelector<HTMLElement>(".nn-vertical-text");
    if (!textEl) {
      textEl = this.bodyEl.createDiv({ cls: "nn-vertical-text" });
    }
    // 変わったチャンクだけを差し替える（詳細は patchVerticalBody() 参照）
    patchVerticalBody(textEl, html);
  }

  private renderEmpty(message: string): void {
    if (!this.bodyEl) return;
    this.applyLayoutSettings();
    this.bodyEl.empty();
    this.lineSentences = new Map();
    this.lineSentPlainLengths = new Map();
    // bodyEl.empty() で本文DOMが破棄されるため、既存の Range を
    // 参照したままの Highlight も後始末する（次回同期時に作り直される）。
    if (this.cursorHighlight) {
      this.cursorHighlight.clear();
      this.cursorHighlight = null;
    }
    this.bodyEl.createEl("p", { text: message, cls: "nn-vertical-empty" });
  }

  // ─────────────────────────────────────────
  // カーソル・選択 連動
  //
  // 【アーキテクチャ】
  // 以前は縦書きプレビュー側が Obsidian の MarkdownView.editor を
  // 100msごとに外部からポーリングしてカーソル位置・選択範囲を
  // 取得していた。しかしこの方式では、日本語入力（IME）が変換中
  // かどうかを外部から判別する手段がなく、変換中の文字数変化の
  // たびに「カーソル位置が変わった」と誤検知し、ハイライトが
  // 頻繁に動いてしまっていた。
  //
  // IME の変換状態（compositionstart/compositionend）はエディタの
  // DOM に対して発火するイベントであり、これを正確に検知できるのは
  // CodeMirror 6 の Extension（editor/extensions.ts の
  // buildCursorSyncExtension）側だけである。
  //
  // そこで、カーソル位置・選択範囲の「確定した」変化の検知は
  // すべてエディタ拡張側に一元化した。縦書きプレビュー側は
  // CursorSyncStore（editor/cursorSyncStore.ts）を購読するだけの
  // 受け手になり、ポーリングも IME 判定も行わない。
  // ─────────────────────────────────────────

  /**
   * CursorSyncStore からの通知を受け取るハンドラ。
   * IME変換中は呼ばれない（エディタ拡張側で書き込み自体を
   * 止めているため）。
   */
  private onCursorSync(snapshot: CursorSyncSnapshot): void {
    // 縦書きプレビューが表示しているファイルと異なるエディタからの
    // 通知は無視する（複数ペイン使用時に無関係な更新をしないため）。
    if (snapshot.file !== this.lastFile) return;
    this.applySnapshot(snapshot);
  }

  /**
   * ファイル読み込み直後など、ストアの通知を待たずに即座に現在位置へ
   * 同期したい場合に呼ぶ。ストアに現在ファイルのスナップショットが
   * あればそれを使い、なければ MarkdownView から直接1回だけ読み取る
   * （購読方式に切り替える前の挙動と同じフォールバック）。
   * スクロールは即座（instant）に行う。
   */
  private forceSyncNow(): void {
    const stored = this.cursorSyncStore?.get();
    if (stored && stored.file === this.lastFile) {
      this.lastSelection  = stored.selection;
      this.lastCursorLine = stored.line;
      this.lastCursorCh   = stored.ch;
      this.syncCursorHighlight(stored.line, stored.ch, stored.selection, true);
      return;
    }
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView?.file !== this.lastFile) return;
    const cursor = mdView.editor.getCursor();
    const selection = mdView.editor.getSelection() ?? "";
    this.lastSelection  = selection;
    this.lastCursorLine = cursor.line;
    this.lastCursorCh   = cursor.ch;
    this.syncCursorHighlight(cursor.line, cursor.ch, selection, true);
  }

  /**
   * カーソル位置・選択範囲・本文のスナップショットを実際に反映する。
   *
   * 【設計変更の経緯】
   * 以前はここで snapshot.docLength と this.lastText.length を比較し、
   * 一致しなければ「本文再描画がまだ追いついていない」とみなして
   * 即座に return していた（本文再描画は editor-change の
   * 1200msデバウンスという別タイマーで行われていたため）。
   * この間、新しいカーソル位置の通知はすべて無視され、ハイライトは
   * 古い位置に固定されたまま、本文再描画が完了した瞬間に正しい位置へ
   * ワープする（＝入力文字数ぶんズレてから戻る）という不具合があった。
   *
   * CursorSyncStore のスナップショットが本文そのもの（text）を
   * 運ぶようになったことで、この鮮度チェックは不要になった。
   * snapshot.text が this.lastText と異なれば、それはこの
   * スナップショットの時点での最新本文なのでそのまま再描画すればよい。
   * 本文再描画とカーソル同期が常に同じスナップショットに基づいて
   * 一体で行われるため、世代がズレる余地自体がなくなる。
   */
  private applySnapshot(snapshot: CursorSyncSnapshot): void {
    if (!this.bodyEl || !this.scrollerEl) return;

    const { line: cursorLine, ch: cursorCh, selection, text } = snapshot;
    if (cursorLine < 0) return;

    const textChanged      = text !== this.lastText;
    const selectionChanged = selection !== this.lastSelection;

    // 本文または選択範囲（ハイライト用マーク）が変わった場合は
    // DOM を再構築してからカーソル同期する。
    // renderBody() は DOM 再構築のみを行い、直後に
    // syncCursorHighlight() を同期呼び出しすることで、
    // Range・Highlight が「存在しないノードを指す」フレームを
    // 発生させない（ちらつき対策）。
    if (textChanged || selectionChanged) {
      this.lastText      = text;
      this.lastSelection = selection;
      this.renderBody(text, selection);
      // syncCursorHighlight() が Range を作れず早期returnした場合、
      // 直前のハイライト・スクロール位置がそのまま残る
      // （差分パッチにより無関係な行のスクロール位置は元々
      //   変化しないため、フォールバックとしての強制リセットは
      //   不要になった）。
      this.lastCursorLine = cursorLine;
      this.lastCursorCh   = cursorCh;
      this.syncCursorHighlight(cursorLine, cursorCh, selection, true);
      return;
    }

    const cursorChanged = cursorLine !== this.lastCursorLine || cursorCh !== this.lastCursorCh;
    if (!cursorChanged) return;

    this.lastCursorLine = cursorLine;
    this.lastCursorCh   = cursorCh;
    this.syncCursorHighlight(cursorLine, cursorCh, selection, false);
  }

  // ─────────────────────────────────────────
  // カーソル文の Range を構築し、ハイライトの付け替え・
  // スクロール追従を同期的に行う。
  //
  // 呼び出し元（applySnapshot / forceSyncNow）は、本文DOMが
  // 既に確定した状態でこれを呼ぶ。Range の構築・CSS Highlight の
  // 登録はレイアウトを必要としないため即座に行える。
  // Range.getBoundingClientRect() はレイアウトを要求するが、
  // 呼び出すとブラウザがその場で同期的にレイアウトを確定させるため、
  // requestAnimationFrame を挟まなくても正しい値が返る
  // （Obsidian は Chromium 上で動作するためこれに依存できる）。
  //
  // 【注記】エディタ側のちらつき調査の過程で、切り分けのため
  // 一時的にハイライト付け替え処理を撤去したことがあったが、
  // 撤去してもエディタ側のちらつきには変化がなかった
  // （＝原因は縦書きプレビューのハイライトではなかった）ため、
  // ハイライト表示は復元してある。オプション設定
  // （verticalCursorHighlightEnabled）の対象であり必須の機能。
  // ─────────────────────────────────────────
  private syncCursorHighlight(
    cursorLine: number,
    cursorCh: number,
    selection: string,
    instant: boolean
  ): void {
    if (!this.bodyEl || !this.scrollerEl) return;
    if (cursorLine < 0) return;

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
    // targetSrcLine はキャッシュ済みの this.lastText から取得する
    // （エディタへ問い合わせずに済むため、ストア購読方式との
    //   親和性が高い）。
    let adjustedCh = cursorCh;
    if (targetLine === cursorLine) {
      const targetSrcLine = this.lastText.split("\n")[targetLine] ?? "";
      if (targetSrcLine.startsWith("\u3000")) {
        adjustedCh = Math.max(0, cursorCh - 1);
      }
    }
    const sentIdx = (targetLine === cursorLine)
      ? cursorChToSentIdx(sents, adjustedCh)
      : sents.length - 1;

    // ── 対象文の Range を構築 ────────────────────
    //
    // DOM 上には文単位の <span> が存在しないため、
    // lineSentPlainLengths（各文の見た目の文字数）から
    // 対象文の開始・終了オフセットを求め、
    // buildSentenceRange() で行要素（.nn-line）配下の
    // 該当テキスト位置を直接指す Range を作る。
    //
    const lineEl = this.bodyEl.querySelector<HTMLElement>(
      `.nn-line[data-line="${targetLine}"]`
    );
    if (!lineEl) return;

    const plainLens = this.lineSentPlainLengths.get(targetLine) ?? [];
    let startCp = 0;
    for (let j = 0; j < sentIdx; j++) startCp += plainLens[j] ?? 0;
    const endCp = startCp + (plainLens[sentIdx] ?? 0);

    const range = buildSentenceRange(lineEl, startCp, endCp);
    if (!range) return;

    // ── ハイライトを付け替え（CSS Custom Highlight API） ──
    //
    // DOM に触れず、Range を登録し直すだけでハイライト位置を更新する。
    // 未対応環境（Chromium 105 未満など）では CSS.highlights が
    // 存在しないため、ハイライト表示のみ静かにスキップする
    // （スクロール追従自体は Range.getBoundingClientRect() のみで
    //   完結するため、そちらは未対応環境でも動作する）。
    //
    // 【選択中はカーソル文ハイライトを表示しない】
    // ::highlight() で描画される背景は「ハイライトオーバーレイ」
    // という、通常のDOM要素の背景色（<mark class="nn-sel"> の
    // background-color）よりも上のレイヤーに描画される。
    // そのため、選択範囲とカーソル文が重なる（＝カーソルは
    // 選択範囲の先頭か末尾にあることが多いため、ほぼ常に重なる）と
    // カーソルハイライトが選択ハイライトを覆い隠してしまい、
    // 「選択したのにハイライトが見えない」状態になっていた。
    // 選択中はカーソル文ハイライトを一旦消し、選択ハイライトの
    // 視認性を優先する。
    //
    const hasSelection = selection.length > 0;
    if (typeof CSS !== "undefined" && CSS.highlights) {
      if (hasSelection) {
        if (this.cursorHighlight) this.cursorHighlight.clear();
      } else if (!this.cursorHighlight) {
        this.cursorHighlight = new Highlight(range);
        CSS.highlights.set("nn-cursor", this.cursorHighlight);
      } else {
        this.cursorHighlight.clear();
        this.cursorHighlight.add(range);
      }
    }

    // ── スクロール位置計算 ───────────────────────
    //
    // Range.getBoundingClientRect() でビューポート上の位置を取得し、
    // 現在の scrollLeft を加味してコンテナ内絶対X座標を求める。
    // 対象文の列をビューポート中央に合わせる。
    //
    const scrollerRect   = this.scrollerEl.getBoundingClientRect();
    const targetRect     = range.getBoundingClientRect();
    const containerWidth = this.scrollerEl.clientWidth;
    const scrollWidth    = this.scrollerEl.scrollWidth;

    const absCenter =
      targetRect.left - scrollerRect.left + this.scrollerEl.scrollLeft
      + targetRect.width / 2;

    const desiredLeft = absCenter - containerWidth / 2;

    this.scrollerEl.scrollTo({
      left: Math.max(0, Math.min(desiredLeft, scrollWidth - containerWidth)),
      behavior: instant ? "instant" : "smooth",
    });
  }
}
