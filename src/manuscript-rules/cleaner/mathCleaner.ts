// ─────────────────────────────────────────
// manuscript-rules — 数式（$$...$$ ブロック）の処理
//
// codeCleaner.ts のコードブロックと同様の理由で、"keep"（そのまま維持）
// の場合は他の要素処理（見出し・強調・リスト等）より先に保護し、
// 数式内の "_" "#" "-" などがMarkdown記法として誤って書き換えられない
// ようにする。保護の復元はパイプラインの最後に行う。
//
// 単一の $...$ 記法（インライン数式）は、通貨表記（例:「$5 と $10」）
// との誤検出リスクが高く、小説原稿での出現頻度・実害を踏まえて
// 意図的に対象外としている（parser/patterns.ts のコメント参照）。
// ─────────────────────────────────────────

import type { SimpleRule } from "../types/rules";
import { MATH_BLOCK_RE } from "../parser/patterns";
import { protectMatches, ProtectionSession } from "./protect";

/**
 * block.math ルールを適用しつつ、必要であれば以後の処理からの保護を行う。
 */
export function applyMathRule(text: string, rule?: SimpleRule): ProtectionSession {
  if (!rule || rule.action === "keep") {
    return protectMatches(text, MATH_BLOCK_RE, "math-block");
  }

  return {
    text: text.replace(MATH_BLOCK_RE, ""),
    restore: (t) => t,
  };
}
