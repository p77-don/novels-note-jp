// ─────────────────────────────────────────
// Novels Note JP — 動的CSS生成時の値検証
//
// main.ts の applyEditorStyles() は、設定値（色・タグ名・カッコID）を
// 文字列連結でCSSルールへ埋め込んでいる。これらの値は通常、
// 設定タブのカラーピッカーやテキスト入力を経由するが、
//   - 同期経由で他端末から不正な値を含む設定が入ってくる
//   - data.json を手編集する
//   - タグ名入力欄に `}`、`;`、空白などの記号を含む文字列を入れる
// といったケースでは、そのままCSS文字列へ混入し、
//   1) 生成CSS全体の構文が壊れて動的スタイルが丸ごと無効になる
//   2) 意図しないセレクタ・プロパティを注入される
// おそれがある。ここでは「不正な値は既定値へフォールバックする」
// 方針で、CSSへ渡す直前に検証する。
// ─────────────────────────────────────────

/** #rgb / #rrggbb / #rrggbbaa 形式のHEXカラーとして正しいか */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * HEXカラー文字列を検証する。不正な場合は fallback を返す。
 * fallback 自体も不正な場合の呼び出し側の責務は問わない
 * （DEFAULT_SETTINGS の値を渡す前提のため、通常は問題にならない）。
 */
export function sanitizeCssColor(value: string | undefined | null, fallback: string): string {
  if (typeof value === "string" && HEX_COLOR_RE.test(value.trim())) {
    return value.trim();
  }
  return fallback;
}

/**
 * CSSのクラス名・セレクタの一部として安全な識別子か検証する。
 * 英数字・ハイフン・アンダースコアのみを許可する
 * （タグ名やカッコIDなど、`.novel-hl-${tag}` のようにクラス名へ
 * 直接連結される値に使う）。
 */
const SAFE_CSS_IDENTIFIER_RE = /^[A-Za-z0-9_-]+$/;

export function isSafeCssIdentifier(value: string): boolean {
  return typeof value === "string" && SAFE_CSS_IDENTIFIER_RE.test(value);
}
