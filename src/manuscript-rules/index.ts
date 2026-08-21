// ─────────────────────────────────────────
// manuscript-rules — 公開API
//
// Novels Note JP / Novels Bookcrafter 双方から利用する想定のため、
// 外部から使う可能性のあるものはここでまとめて re-export する。
// ─────────────────────────────────────────

export type {
  ManuscriptRulesSchemaVersion,
  KeepRemoveAction,
  KeepRemoveEditAction,
  SimpleRule,
  EditableRule,
  MetadataRules,
  ImageRule,
  BlockRules,
  WikilinkRule,
  RubyMode,
  RubyRule,
  InlineRules,
  BlankLinesRule,
  TrailingWhitespaceRule,
  DocumentRules,
  ManuscriptRules,
  ManuscriptRulesDefinition,
  BlockElementKey,
  InlineElementKey,
  DocumentRuleKey,
} from "./types/rules";

export { cleanManuscript } from "./cleaner/manuscriptCleaner";
export { createDefaultManuscriptRules, createDefaultManuscriptRulesDefinition } from "./rules/ruleDefaults";
export {
  validateManuscriptRulesDefinition,
  type ValidationResult,
} from "./rules/ruleValidator";
export {
  parseManuscriptRulesDefinition,
  serializeManuscriptRulesDefinition,
  ManuscriptRulesParseError,
} from "./rules/ruleLoader";
export { convertRubyStyle, rubyPairToStyle } from "./utils/rubyConvert";
