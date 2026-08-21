// ─────────────────────────────────────────
// manuscript-rules — 文書全体の整形（document）
// ─────────────────────────────────────────

import type { BlankLinesRule, TrailingWhitespaceRule } from "../types/rules";

/**
 * 連続する空行を maxConsecutive 行までに圧縮する。
 *
 * N個の連続する空行は (N+1) 個の連続する改行文字として現れる
 * （例: 空行1個 = "\n\n\n" ではなく "\n\n" ← 前の行末の改行＋空行自身の改行）。
 * したがって maxConsecutive 個までを許容するには、
 * (maxConsecutive + 2) 個以上連続する改行を (maxConsecutive + 1) 個に圧縮する。
 */
export function applyBlankLinesRule(text: string, rule?: BlankLinesRule): string {
  if (!rule || rule.action === "keep") return text;

  const maxConsecutive = rule.maxConsecutive ?? 1;
  const threshold = maxConsecutive + 2;
  const replacement = "\n".repeat(maxConsecutive + 1);
  const re = new RegExp(`\\n{${threshold},}`, "g");
  return text.replace(re, replacement);
}

/**
 * 文書末尾の余分な空白・空行を除去し、末尾を改行1つに揃える。
 */
export function applyTrailingWhitespaceRule(text: string, rule?: TrailingWhitespaceRule): string {
  if (!rule || rule.action === "keep") return text;
  return text.replace(/[\s\n]+$/, "") + "\n";
}
