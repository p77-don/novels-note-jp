// ─────────────────────────────────────────
// manuscript-rules — 定義ファイルのランタイムバリデーション
//
// manuscript-rules.schema.json（設計フェーズで作成したJSON Schema）と
// 同じ制約を、追加ライブラリなしでTypeScriptとして再現する。
// ユーザーがJSONを直接編集した場合や、旧バージョンのファイルを
// 読み込んだ場合に、壊れた定義でクリーニング処理が暴走しないよう検証する。
// ─────────────────────────────────────────

import type { ManuscriptRulesDefinition } from "../types/rules";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** ok === true のときのみ設定される */
  value?: ManuscriptRulesDefinition;
}

const KEEP_REMOVE = ["keep", "remove"];
const KEEP_REMOVE_EDIT = ["keep", "remove", "edit"];
const RUBY_MODES = ["none", "remove", "narou", "aozora", "denden", "html"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pushUnknownKeys(obj: Record<string, unknown>, allowed: string[], path: string, errors: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.push(`${path}: 未知のプロパティ "${key}" は許可されていません`);
    }
  }
}

function validateSimpleRule(v: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(v)) { errors.push(`${path}: オブジェクトである必要があります`); return; }
  pushUnknownKeys(v, ["action"], path, errors);
  if (typeof v.action !== "string" || !KEEP_REMOVE.includes(v.action)) {
    errors.push(`${path}.action: "keep" または "remove" である必要があります`);
  }
}

function validateEditableRule(v: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(v)) { errors.push(`${path}: オブジェクトである必要があります`); return; }
  pushUnknownKeys(v, ["action"], path, errors);
  if (typeof v.action !== "string" || !KEEP_REMOVE_EDIT.includes(v.action)) {
    errors.push(`${path}.action: "keep" / "remove" / "edit" のいずれかである必要があります`);
  }
}

function validateWikilinkRule(v: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(v)) { errors.push(`${path}: オブジェクトである必要があります`); return; }
  pushUnknownKeys(v, ["action", "editMode"], path, errors);
  if (typeof v.action !== "string" || !KEEP_REMOVE_EDIT.includes(v.action)) {
    errors.push(`${path}.action: "keep" / "remove" / "edit" のいずれかである必要があります`);
    return;
  }
  if (v.editMode !== undefined && v.editMode !== "fileName" && v.editMode !== "displayText") {
    errors.push(`${path}.editMode: "fileName" または "displayText" である必要があります`);
  }
}

function validateRubyRule(v: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(v)) { errors.push(`${path}: オブジェクトである必要があります`); return; }
  pushUnknownKeys(v, ["mode"], path, errors);
  if (typeof v.mode !== "string" || !RUBY_MODES.includes(v.mode)) {
    errors.push(`${path}.mode: ${RUBY_MODES.join(" / ")} のいずれかである必要があります`);
  }
}

function validateBlankLinesRule(v: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(v)) { errors.push(`${path}: オブジェクトである必要があります`); return; }
  pushUnknownKeys(v, ["action", "maxConsecutive"], path, errors);
  if (v.action !== "keep" && v.action !== "normalize") {
    errors.push(`${path}.action: "keep" または "normalize" である必要があります`);
    return;
  }
  if (v.action === "normalize" && v.maxConsecutive !== undefined) {
    if (typeof v.maxConsecutive !== "number" || !Number.isInteger(v.maxConsecutive) || v.maxConsecutive < 0) {
      errors.push(`${path}.maxConsecutive: 0以上の整数である必要があります`);
    }
  }
}

function validateTrailingWhitespaceRule(v: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(v)) { errors.push(`${path}: オブジェクトである必要があります`); return; }
  pushUnknownKeys(v, ["action"], path, errors);
  if (v.action !== "keep" && v.action !== "normalize") {
    errors.push(`${path}.action: "keep" または "normalize" である必要があります`);
  }
}

const BLOCK_SIMPLE_KEYS = ["comment", "horizontalRule", "html"] as const;
const BLOCK_EDITABLE_KEYS = ["callout", "heading", "blockquote", "list", "codeBlock"] as const;
const INLINE_SIMPLE_KEYS = ["tag", "image", "html"] as const;
const INLINE_EDITABLE_KEYS = ["emphasis", "markdownLink", "inlineCode"] as const;

function validateRules(v: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(v)) { errors.push(`${path}: オブジェクトである必要があります`); return; }
  pushUnknownKeys(v, ["metadata", "block", "inline", "document"], path, errors);

  if (v.metadata !== undefined) {
    const p = `${path}.metadata`;
    if (!isPlainObject(v.metadata)) {
      errors.push(`${p}: オブジェクトである必要があります`);
    } else {
      pushUnknownKeys(v.metadata, ["frontmatter"], p, errors);
      if (v.metadata.frontmatter !== undefined) validateSimpleRule(v.metadata.frontmatter, `${p}.frontmatter`, errors);
    }
  }

  if (v.block !== undefined) {
    const p = `${path}.block`;
    if (!isPlainObject(v.block)) {
      errors.push(`${p}: オブジェクトである必要があります`);
    } else {
      pushUnknownKeys(v.block, [...BLOCK_SIMPLE_KEYS, ...BLOCK_EDITABLE_KEYS], p, errors);
      for (const key of BLOCK_SIMPLE_KEYS) {
        if (v.block[key] !== undefined) validateSimpleRule(v.block[key], `${p}.${key}`, errors);
      }
      for (const key of BLOCK_EDITABLE_KEYS) {
        if (v.block[key] !== undefined) validateEditableRule(v.block[key], `${p}.${key}`, errors);
      }
    }
  }

  if (v.inline !== undefined) {
    const p = `${path}.inline`;
    if (!isPlainObject(v.inline)) {
      errors.push(`${p}: オブジェクトである必要があります`);
    } else {
      pushUnknownKeys(v.inline, [...INLINE_SIMPLE_KEYS, ...INLINE_EDITABLE_KEYS, "wikilink", "ruby"], p, errors);
      for (const key of INLINE_SIMPLE_KEYS) {
        if (v.inline[key] !== undefined) validateSimpleRule(v.inline[key], `${p}.${key}`, errors);
      }
      for (const key of INLINE_EDITABLE_KEYS) {
        if (v.inline[key] !== undefined) validateEditableRule(v.inline[key], `${p}.${key}`, errors);
      }
      if (v.inline.wikilink !== undefined) validateWikilinkRule(v.inline.wikilink, `${p}.wikilink`, errors);
      if (v.inline.ruby !== undefined) validateRubyRule(v.inline.ruby, `${p}.ruby`, errors);
    }
  }

  if (v.document !== undefined) {
    const p = `${path}.document`;
    if (!isPlainObject(v.document)) {
      errors.push(`${p}: オブジェクトである必要があります`);
    } else {
      pushUnknownKeys(v.document, ["blankLines", "trailingWhitespace"], p, errors);
      if (v.document.blankLines !== undefined) validateBlankLinesRule(v.document.blankLines, `${p}.blankLines`, errors);
      if (v.document.trailingWhitespace !== undefined) {
        validateTrailingWhitespaceRule(v.document.trailingWhitespace, `${p}.trailingWhitespace`, errors);
      }
    }
  }
}

/**
 * unknown な値（JSON.parse の結果など）を ManuscriptRulesDefinition として検証する。
 * 不正な場合は ok: false とエラーメッセージ一覧を返す（例外は投げない）。
 */
export function validateManuscriptRulesDefinition(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ["ルート: オブジェクトである必要があります"] };
  }

  pushUnknownKeys(input, ["version", "name", "createdAt", "updatedAt", "rules"], "$", errors);

  if (input.version !== 1) {
    errors.push(`$.version: 1 である必要があります（受け取った値: ${JSON.stringify(input.version)}）`);
  }
  if (input.name !== undefined && typeof input.name !== "string") {
    errors.push("$.name: 文字列である必要があります");
  }
  if (typeof input.createdAt !== "string") {
    errors.push("$.createdAt: 文字列（ISO 8601形式の日時）である必要があります");
  }
  if (typeof input.updatedAt !== "string") {
    errors.push("$.updatedAt: 文字列（ISO 8601形式の日時）である必要があります");
  }
  if (input.rules === undefined) {
    errors.push("$.rules: 必須です");
  } else {
    validateRules(input.rules, "$.rules", errors);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], value: input as unknown as ManuscriptRulesDefinition };
}
