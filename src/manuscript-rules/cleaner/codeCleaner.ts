// ─────────────────────────────────────────
// manuscript-rules — コードブロック / インラインコードの処理
//
// codeBlock・inlineCode は、他の要素処理（見出し・強調・Wikilink等）より
// 先にパイプラインへ組み込み、"keep"（そのまま維持）や "edit"
// （フェンス/バッククォートだけ外す）の場合でも、中身のコードが
// 後続処理でMarkdownとして誤って書き換えられないようプレースホルダーで
// 保護する。保護の復元はパイプラインの最後（blankLines/trailingWhitespace
// 正規化の後）に行い、コード内の空行・末尾空白がユーザーの意図しない形で
// 変更されないようにする。
//
// "remove" の場合は元々保護の必要がない（内容ごと削除するため）。
// ─────────────────────────────────────────

import type { EditableRule } from "../types/rules";
import {
  CODE_FENCE_BACKTICK_RE,
  CODE_FENCE_TILDE_RE,
  CODE_FENCE_BACKTICK_CAPTURE_RE,
  CODE_FENCE_TILDE_CAPTURE_RE,
  INLINE_CODE_RE,
} from "../parser/patterns";
import { protectMatches, ProtectionSession } from "./protect";

export interface CodeProtectionResult {
  text: string;
  restore: (text: string) => string;
}

/**
 * block.codeBlock ルールを適用しつつ、必要であれば以後の処理からの保護を行う。
 */
export function applyCodeBlockRule(text: string, rule?: EditableRule): CodeProtectionResult {
  if (!rule || rule.action === "keep") {
    const backtick = protectMatches(text, CODE_FENCE_BACKTICK_RE, "codeblock-bt");
    const tilde = protectMatches(backtick.text, CODE_FENCE_TILDE_RE, "codeblock-tl");
    return {
      text: tilde.text,
      restore: (t) => backtick.restore(tilde.restore(t)),
    };
  }

  if (rule.action === "remove") {
    return {
      text: text.replace(CODE_FENCE_BACKTICK_RE, "").replace(CODE_FENCE_TILDE_RE, ""),
      restore: (t) => t,
    };
  }

  // edit: フェンス記号だけ外し、中身のコードをプレースホルダーで保護する
  const backtick = protectMatches(
    text,
    CODE_FENCE_BACKTICK_CAPTURE_RE,
    "codeblock-bt",
    (_m, inner: string) => inner.replace(/\n$/, "")
  );
  const tilde = protectMatches(
    backtick.text,
    CODE_FENCE_TILDE_CAPTURE_RE,
    "codeblock-tl",
    (_m, inner: string) => inner.replace(/\n$/, "")
  );
  return {
    text: tilde.text,
    restore: (t) => backtick.restore(tilde.restore(t)),
  };
}

/**
 * inline.inlineCode ルールを適用しつつ、必要であれば以後の処理からの保護を行う。
 */
export function applyInlineCodeRule(text: string, rule?: EditableRule): CodeProtectionResult {
  if (!rule || rule.action === "keep") {
    const session: ProtectionSession = protectMatches(text, INLINE_CODE_RE, "inlinecode");
    return session;
  }

  if (rule.action === "remove") {
    return { text: text.replace(INLINE_CODE_RE, ""), restore: (t) => t };
  }

  // edit: バッククォートだけ外し、中身のテキストをプレースホルダーで保護する
  const session = protectMatches(text, INLINE_CODE_RE, "inlinecode", (_m, inner: string) => inner);
  return session;
}
