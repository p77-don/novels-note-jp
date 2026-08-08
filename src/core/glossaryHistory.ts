// ─────────────────────────────────────────
// Novels Note JP — 用語入力パレット：使用履歴
//
// 「最近使った」欄の表示順を決めるための履歴データを、
// Vault 内ではなくプラグイン設定フォルダ配下（manifest.dir）に
// 保存する。Vault のファイルツリーを汚さないための設計判断。
//
// 記録単位は filePath（用語ファイル単位）。
// 同じファイルの別表記（name/aliases違い）を入力しても
// 履歴上は1件として最終使用日時が更新されるだけになる。
//
// 使用回数は保存しない（仕様書どおり、表示順の決定にのみ使う）。
// ─────────────────────────────────────────

import { App, normalizePath } from "obsidian";

const HISTORY_FILE_NAME = "glossary-history.json";

// 履歴が際限なく肥大化しないよう、保持件数の上限を設ける。
// 上限を超えた場合は最終使用日時が古いものから削除する。
const MAX_HISTORY_ENTRIES = 50;

/** filePath → 最終使用日時（UNIX Timestamp, 秒） */
export type GlossaryHistory = Record<string, number>;

function historyFilePath(pluginDir: string): string {
  return normalizePath(`${pluginDir}/${HISTORY_FILE_NAME}`);
}

/**
 * 履歴を読み込む。ファイルが存在しない・壊れている場合は
 * 空の履歴として扱う（読み込み失敗をユーザーに通知するほどの
 * 重要データではないため、静かにフォールバックする）。
 */
export async function loadGlossaryHistory(
  app: App,
  pluginDir: string
): Promise<GlossaryHistory> {
  const path = historyFilePath(pluginDir);

  try {
    const exists = await app.vault.adapter.exists(path);
    if (!exists) return {};

    const raw = await app.vault.adapter.read(path);
    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    const result: GlossaryHistory = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    // 読み込み失敗（壊れたJSON等）は履歴なし扱いにして続行する
    return {};
  }
}

/**
 * 履歴を保存する。
 */
async function saveGlossaryHistory(
  app: App,
  pluginDir: string,
  history: GlossaryHistory
): Promise<void> {
  const path = historyFilePath(pluginDir);
  await app.vault.adapter.write(path, JSON.stringify(history));
}

/**
 * 用語ファイルの使用を記録する（Enter／入力ボタンで確定した時に呼ぶ）。
 * 上限件数を超えた場合は最終使用日時が古いものから削除する。
 *
 * 戻り値は更新後の履歴（呼び出し元でメモリ上のキャッシュを
 * 更新する場合に使える）。
 */
export async function recordGlossaryUsage(
  app: App,
  pluginDir: string,
  filePath: string,
  history: GlossaryHistory
): Promise<GlossaryHistory> {
  const updated: GlossaryHistory = { ...history, [filePath]: Math.floor(Date.now() / 1000) };

  const entries = Object.entries(updated).sort((a, b) => b[1] - a[1]);
  const trimmed: GlossaryHistory = {};
  for (const [key, value] of entries.slice(0, MAX_HISTORY_ENTRIES)) {
    trimmed[key] = value;
  }

  await saveGlossaryHistory(app, pluginDir, trimmed);
  return trimmed;
}

/**
 * 履歴をすべて削除する（設定画面の「クリア」ボタンから呼ぶ）。
 */
export async function clearGlossaryHistory(
  app: App,
  pluginDir: string
): Promise<void> {
  await saveGlossaryHistory(app, pluginDir, {});
}

/**
 * 履歴を「最近使った」表示用の filePath 配列（新しい順）に変換する。
 * 存在しないファイル（削除・移動済み）は呼び出し元で
 * TermEntry と突き合わせてフィルタする想定のため、ここでは
 * 単純に日時順のソートのみ行う。
 */
export function sortHistoryByRecency(history: GlossaryHistory): string[] {
  return Object.entries(history)
    .sort((a, b) => b[1] - a[1])
    .map(([filePath]) => filePath);
}
