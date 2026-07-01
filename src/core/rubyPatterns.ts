// ─────────────────────────────────────────
// Novels Note JP — ルビ記法 共通検出ロジック
//
// エディタ内インラインプレビュー（editor/rubyWidget.ts）・
// Export のルビ変換（export/exporter.ts）・
// 縦書きプレビュー / 小説閲覧ビューの HTML 生成
// （views/verticalPreview.ts / views/novelReadingView.ts）の
// 4箇所で「ルビ記法をどう検出するか」が個別に実装されており、
// 特に CJK 文字範囲（拡張漢字 \u{20000}-\u{3FFFF} を含むか否か）に
// 差異があった。
// ここに検出ロジックを一本化し、挙動のズレを防ぐ。
// ─────────────────────────────────────────

import { RubyStyle } from "../settings";

// ─────────────────────────────────────────
// CJK 文字範囲
//
// CJK統合漢字 + 互換漢字 + 拡張A + 拡張B-G（人名・稀用漢字対応）。
// \u{20000}-\u{3FFFF} は BMP 外（サロゲートペア）のため、
// この定数を使う正規表現には必ず "u" フラグを付けること。
// ─────────────────────────────────────────
export const CJK_PATTERN =
  "\u3005\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\\u{20000}-\\u{3FFFF}";

// ─────────────────────────────────────────
// ルビ構文の検出結果
// ─────────────────────────────────────────
export interface RubyMatch {
  from: number;     // 構文全体の開始（縦棒を含む）
  to: number;       // 構文全体の終了
  baseFrom: number; // 親文字の開始
  baseTo: number;   // 親文字の終了
  base: string;
  ruby: string;
}

/**
 * テキスト内のルビ記法をすべて検出してリストで返す。
 * rubyStyle の設定に応じてパターンを切り替える。
 *
 * narou / aozora は半角縦棒（|）・全角縦棒（｜）付きの記法（任意文字列）と、
 * 縦棒なしの CJK 漢字直後《ルビ》記法の両方を検出する。
 */
export function findRubyMatches(text: string, style: RubyStyle): RubyMatch[] {
  const matches: RubyMatch[] = [];

  switch (style) {
    case "narou":
    case "aozora": {
      // パターン1: [|｜]base《ruby》  ← 縦棒あり（任意文字列）
      // パターン2: CJK+《ruby》       ← 縦棒なし（漢字のみ）
      const re = new RegExp(
        "[|｜]([^\u300A\n]+)\u300A([^\u300B\n]*)\u300B" +
        "|([" + CJK_PATTERN + "]+)\u300A([^\u300B\n]*)\u300B",
        "gu"
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const hasBar = m[1] !== undefined;
        const base = hasBar ? m[1] : m[3];
        const ruby = hasBar ? m[2] : m[4];
        const from = m.index;
        const to = from + m[0].length;
        // 親文字の開始位置（縦棒があれば +1）
        const baseFrom = hasBar ? from + 1 : from;
        const baseTo = baseFrom + base.length;
        matches.push({ from, to, baseFrom, baseTo, base, ruby });
      }
      break;
    }

    case "denden": {
      // {base|ruby}
      const re = /\{([^|\n]+)\|([^}\n]+)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const base = m[1];
        const ruby = m[2];
        const from = m.index;
        const to = from + m[0].length;
        const baseFrom = from + 1; // "{" の次
        const baseTo = baseFrom + base.length;
        matches.push({ from, to, baseFrom, baseTo, base, ruby });
      }
      break;
    }

    case "html": {
      // <ruby>base<rt>ruby</rt></ruby>
      // タグ名の完全一致のみを許容する（<ruby class="...">等の
      // 属性付きタグは意図的にマッチさせない。属性はこの正規表現の
      // 対象外になり、後段の HTML エスケープ処理で無害化される）。
      const re = /<ruby>\s*([^<]+?)\s*<rt>\s*([^<]*?)\s*<\/rt>\s*<\/ruby>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const base = m[1];
        const ruby = m[2];
        const from = m.index;
        const to = from + m[0].length;
        // "<ruby>" の直後から base 本体までの空白量を考慮する
        const afterOpenTag = m[0].indexOf(base, "<ruby>".length);
        const baseFrom = from + (afterOpenTag !== -1 ? afterOpenTag : 6);
        const baseTo = baseFrom + base.length;
        matches.push({ from, to, baseFrom, baseTo, base, ruby });
      }
      break;
    }
  }

  return matches;
}

// ─────────────────────────────────────────
// HTML エスケープ
// ─────────────────────────────────────────
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * ルビ記法をエスケープ済みの <ruby><rt> HTML に変換しつつ、
 * ルビ記法以外の地の文もすべて HTML エスケープする。
 *
 * 【セキュリティ】
 * ルビの「親文字」「ルビ文字」は、記法上ほぼ任意の文字列
 * （"<" "оnerror=" のような HTML 特殊文字を含む文字列）にマッチし得る。
 * そのため、先に findRubyMatches() でルビ記法の範囲だけを検出し、
 * 親文字・ルビ文字を個別に escapeHtml() してから <ruby> タグを
 * 組み立てる。これにより、本文中に
 *   |<img src=x onerror=alert(1)>《ふりがな》
 * のような記法を書いても、生成される HTML は
 *   &lt;ruby&gt;... ではなく
 *   <ruby>&lt;img src=x onerror=alert(1)&gt;<rt>ふりがな</rt></ruby>
 * のように親文字部分がエスケープされ、DOM 上でタグとして
 * 解釈されることはない。
 *
 * 旧実装（<ruby>...</ruby> ブロックごとエスケープ対象外にする方式）は、
 * ブロック内部に任意の未エスケープ HTML が混入する XSS 脆弱性があった。
 */
export function convertRubyAndEscape(text: string, style: RubyStyle): string {
  const matches = findRubyMatches(text, style);
  if (matches.length === 0) return escapeHtml(text);

  let result = "";
  let cursor = 0;
  for (const m of matches) {
    result += escapeHtml(text.slice(cursor, m.from));
    result += `<ruby>${escapeHtml(m.base)}<rt>${escapeHtml(m.ruby)}</rt></ruby>`;
    cursor = m.to;
  }
  result += escapeHtml(text.slice(cursor));
  return result;
}
