// ─────────────────────────────────────────
// manuscript-rules — 定義ファイルの読み書き（パース・シリアライズ）
//
// 意図的に Obsidian の Vault API に依存しない（純粋な文字列⇄オブジェクト変換のみ）。
// 実際にVault内のファイルを読み書きする処理は、プラグイン側
// （設定UIなど）が本モジュールをラップして実装する。
// こうすることで、Novels Bookcrafter 側でも同じロジックをそのまま再利用できる。
// ─────────────────────────────────────────

import type { ManuscriptRulesDefinition } from "../types/rules";
import { validateManuscriptRulesDefinition } from "./ruleValidator";

export class ManuscriptRulesParseError extends Error {
  constructor(public readonly errors: string[]) {
    super(`manuscript-rules.json の内容が不正です:\n${errors.map(e => `  - ${e}`).join("\n")}`);
    this.name = "ManuscriptRulesParseError";
  }
}

/**
 * JSON文字列を ManuscriptRulesDefinition としてパース・検証する。
 * JSON構文自体が不正な場合、または スキーマ違反の場合は例外を投げる。
 */
export function parseManuscriptRulesDefinition(jsonText: string): ManuscriptRulesDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new ManuscriptRulesParseError([`JSONとして読み込めません（構文エラー）: ${String(e)}`]);
  }

  const result = validateManuscriptRulesDefinition(raw);
  if (!result.ok || !result.value) {
    throw new ManuscriptRulesParseError(result.errors);
  }
  return result.value;
}

/**
 * ManuscriptRulesDefinition を保存用のJSON文字列に変換する。
 * 人間が直接編集する可能性を考慮し、2スペースインデントで整形する。
 */
export function serializeManuscriptRulesDefinition(def: ManuscriptRulesDefinition): string {
  return JSON.stringify(def, null, 2) + "\n";
}
