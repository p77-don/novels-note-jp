// ─────────────────────────────────────────
// manuscript-rules — デフォルトのルール定義
//
// UIから「新規作成」した際や、定義ファイル未登録時にExportで使う
// 組み込みのデフォルト定義として、素直な初期値を提供する。
// ─────────────────────────────────────────

import type { ManuscriptRules, ManuscriptRulesDefinition } from "../types/rules";

export function createDefaultManuscriptRules(): ManuscriptRules {
  return {
    metadata: {
      frontmatter: { action: "remove" },
    },
    block: {
      comment: { action: "remove" },
      callout: { action: "remove" },
      heading: { action: "edit" },
      blockquote: { action: "remove" },
      list: { action: "remove" },
      codeBlock: { action: "remove" },
      horizontalRule: { action: "keep" },
      html: { action: "remove" },
    },
    inline: {
      wikilink: { action: "edit", editMode: "displayText" },
      tag: { action: "remove" },
      emphasis: { action: "edit" },
      markdownLink: { action: "edit" },
      image: { action: "keep" },
      ruby: { mode: "none" },
      inlineCode: { action: "remove" },
      html: { action: "remove" },
    },
    document: {
      blankLines: { action: "normalize", maxConsecutive: 1 },
      trailingWhitespace: { action: "normalize" },
    },
  };
}

export function createDefaultManuscriptRulesDefinition(name?: string): ManuscriptRulesDefinition {
  const now = new Date().toISOString();
  return {
    version: 1,
    name,
    createdAt: now,
    updatedAt: now,
    rules: createDefaultManuscriptRules(),
  };
}
