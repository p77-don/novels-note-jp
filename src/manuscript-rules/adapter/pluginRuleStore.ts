// ─────────────────────────────────────────
// manuscript-rules — プラグイン専用フォルダへの定義ファイル保存
//
// 【2026-08 設計変更】
// Novels Bookcrafter の開発計画を凍結したことに伴い、原稿クリーニング
// 定義ファイルを「Vault内の任意の場所」ではなく、本プラグイン専用の
// 設定フォルダ（.obsidian/plugins/novels-note-jp/rules/）に保存する
// 方式へ変更した。
//
//   - Vault の TFile ベースの API（Vault.create/modify/delete等）ではなく、
//     Vaultの索引に含まれない場所も読み書きできる DataAdapter
//     （app.vault.adapter）を使う（既存の glossaryHistory.ts と同じ手法）。
//   - 保存先フォルダを固定したため、ユーザーが指定できるのは
//     ファイル名のみ（フォルダ階層は指定できない）。
//   - Novels Bookcrafter との共有を前提にしていた「Vault内の任意の
//     場所」という設計は、この変更により終了した。
//
// このファイルも ruleEditorModal.ts と同様、唯一 Obsidian の
// DataAdapter に依存する「薄い glue」。
// ─────────────────────────────────────────

import { App, normalizePath } from "obsidian";
import type { ManuscriptRulesDefinition } from "../types/rules";
import {
  parseManuscriptRulesDefinition,
  serializeManuscriptRulesDefinition,
  ManuscriptRulesParseError,
} from "../rules/ruleLoader";
import { createDefaultManuscriptRulesDefinition } from "../rules/ruleDefaults";

export class ManuscriptRulesFileError extends Error {}

const RULES_SUBDIR = "rules";

/**
 * ユーザーが入力したファイル名を検証・正規化する。
 * フォルダ階層の指定（"/" や ".." を含むもの）は許可しない
 * （保存先フォルダを固定するという設計方針のため）。
 * 拡張子 ".json" が付いていない場合は自動的に補う。
 */
export function normalizeRuleFileName(rawFileName: string): string {
  const trimmed = rawFileName.trim();
  if (!trimmed) {
    throw new ManuscriptRulesFileError("ファイル名を入力してください。");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new ManuscriptRulesFileError("ファイル名にフォルダの区切り（/ ）は使用できません。");
  }
  const withExt = trimmed.endsWith(".json") ? trimmed : `${trimmed}.json`;
  // normalizePath はここでは主に不正文字の除去・全角スラッシュ対策として使う
  const normalized = normalizePath(withExt);
  if (normalized.includes("/") || normalized === "." || normalized === "") {
    throw new ManuscriptRulesFileError("ファイル名が不正です。");
  }
  return normalized;
}

function rulesDirPath(pluginDir: string): string {
  return normalizePath(`${pluginDir}/${RULES_SUBDIR}`);
}

function ruleFilePath(pluginDir: string, fileName: string): string {
  return normalizePath(`${rulesDirPath(pluginDir)}/${normalizeRuleFileName(fileName)}`);
}

async function ensureRulesDir(app: App, pluginDir: string): Promise<void> {
  const dir = rulesDirPath(pluginDir);
  const exists = await app.vault.adapter.exists(dir);
  if (!exists) {
    await app.vault.adapter.mkdir(dir);
  }
}

/** 指定ファイル名の定義ファイルを読み込み、検証済みの ManuscriptRulesDefinition を返す。 */
export async function readRuleFile(
  app: App,
  pluginDir: string,
  fileName: string
): Promise<ManuscriptRulesDefinition> {
  const path = ruleFilePath(pluginDir, fileName);
  const exists = await app.vault.adapter.exists(path);
  if (!exists) {
    throw new ManuscriptRulesFileError(`定義ファイルが見つかりません：${fileName}`);
  }
  const text = await app.vault.adapter.read(path);
  try {
    return parseManuscriptRulesDefinition(text);
  } catch (e) {
    if (e instanceof ManuscriptRulesParseError) {
      throw new ManuscriptRulesFileError(`${fileName}\n${e.message}`);
    }
    throw e;
  }
}

/** 定義ファイルを保存する（新規作成 or 上書き）。 */
export async function writeRuleFile(
  app: App,
  pluginDir: string,
  fileName: string,
  def: ManuscriptRulesDefinition
): Promise<void> {
  await ensureRulesDir(app, pluginDir);
  const path = ruleFilePath(pluginDir, fileName);
  await app.vault.adapter.write(path, serializeManuscriptRulesDefinition(def));
}

/** 新規の定義ファイルを、デフォルト内容で作成する。 */
export async function createRuleFile(
  app: App,
  pluginDir: string,
  fileName: string,
  name?: string
): Promise<ManuscriptRulesDefinition> {
  const path = ruleFilePath(pluginDir, fileName);
  await ensureRulesDir(app, pluginDir);
  const exists = await app.vault.adapter.exists(path);
  if (exists) {
    throw new ManuscriptRulesFileError(`${fileName} は既に存在します。`);
  }
  const def = createDefaultManuscriptRulesDefinition(name);
  await app.vault.adapter.write(path, serializeManuscriptRulesDefinition(def));
  return def;
}

/** 既存の定義ファイルを別名で複製する（作成日時は複製時点で更新する）。 */
export async function duplicateRuleFile(
  app: App,
  pluginDir: string,
  sourceFileName: string,
  destFileName: string,
  newName?: string
): Promise<ManuscriptRulesDefinition> {
  const source = await readRuleFile(app, pluginDir, sourceFileName);
  const destPath = ruleFilePath(pluginDir, destFileName);
  const exists = await app.vault.adapter.exists(destPath);
  if (exists) {
    throw new ManuscriptRulesFileError(`${destFileName} は既に存在します。`);
  }
  const now = new Date().toISOString();
  const duplicated: ManuscriptRulesDefinition = {
    ...source,
    name: newName ?? (source.name ? `${source.name}のコピー` : undefined),
    createdAt: now,
    updatedAt: now,
  };
  await app.vault.adapter.write(destPath, serializeManuscriptRulesDefinition(duplicated));
  return duplicated;
}

/** 定義ファイルのファイル名を変更する（同一フォルダ内でのリネーム）。 */
export async function renameRuleFile(
  app: App,
  pluginDir: string,
  oldFileName: string,
  newFileName: string
): Promise<void> {
  const oldPath = ruleFilePath(pluginDir, oldFileName);
  const newPath = ruleFilePath(pluginDir, newFileName);
  const oldExists = await app.vault.adapter.exists(oldPath);
  if (!oldExists) {
    throw new ManuscriptRulesFileError(`定義ファイルが見つかりません：${oldFileName}`);
  }
  const newExists = await app.vault.adapter.exists(newPath);
  if (newExists) {
    throw new ManuscriptRulesFileError(`${newFileName} は既に存在します。`);
  }
  await app.vault.adapter.rename(oldPath, newPath);
}

/**
 * 定義ファイルを完全に削除する。
 * プラグイン専用フォルダ（Vaultの索引外）にあるファイルのため、
 * Vaultの「.trash」フォルダへの移動ではなく直接削除する。
 */
export async function deleteRuleFile(app: App, pluginDir: string, fileName: string): Promise<void> {
  const path = ruleFilePath(pluginDir, fileName);
  const exists = await app.vault.adapter.exists(path);
  if (!exists) return; // 既に存在しない場合は何もしない
  await app.vault.adapter.remove(path);
}

/** 定義ファイルの内容を更新する（ルール変更時。updatedAtを更新する）。 */
export async function updateRuleFile(
  app: App,
  pluginDir: string,
  fileName: string,
  updatedDef: ManuscriptRulesDefinition
): Promise<void> {
  const withTimestamp: ManuscriptRulesDefinition = {
    ...updatedDef,
    updatedAt: new Date().toISOString(),
  };
  await writeRuleFile(app, pluginDir, fileName, withTimestamp);
}
