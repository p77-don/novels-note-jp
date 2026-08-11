// ─────────────────────────────────────────
// Novels Note JP — 型定義・定数
// ─────────────────────────────────────────

import { StateEffect, StateField } from "@codemirror/state";
import { NovelsNoteSettings } from "./settings";

// ─────────────────────────────────────────
// 定数
// ─────────────────────────────────────────
export const SIDEBAR_VIEW_TYPE        = "novels-note-jp-sidebar";
export const VERTICAL_VIEW_TYPE       = "novels-note-jp-vertical";
export const NOVEL_READING_VIEW_TYPE  = "novel-reading-view";
export const WRITING_STATS_VIEW_TYPE  = "novels-note-jp-writing-stats";

// ─────────────────────────────────────────
// 執筆情報一覧
// ─────────────────────────────────────────
export interface WritingStatsEntry {
  filePath: string;     // Vault ルートからの相対パス
  fileName: string;     // 拡張子込みのファイル名
  folderPath: string;   // 親フォルダのパス（Vault 直下の場合は空文字）
  createdAt: number;    // 作成日時（epoch ms）
  modifiedAt: number;   // 最終更新日時（epoch ms）
  totalChars: number;      // 執筆文字数（raw）
  narrativeChars: number;  // 地の文の文字数
  dialogueChars: number;   // 会話文の文字数
  novelChars: number;      // 小説換算文字数（全角1・半角0.5）。推定読了時間の計算に使用。
}

// ─────────────────────────────────────────
// 用語インデックス
// ─────────────────────────────────────────
export interface TermEntry {
  name: string;
  aliases: string[];
  tag: string;
  filePath: string;
}

// ─────────────────────────────────────────
// カッコ解析結果
// ─────────────────────────────────────────
export interface BracketMatch {
  start: number;
  end: number;
  id: string;
}

// ─────────────────────────────────────────
// StateEffect：全 Extension の再描画トリガー
// ─────────────────────────────────────────
export const settingsEffect = StateEffect.define<NovelsNoteSettings>();

// ─────────────────────────────────────────
// StateEffect：エディタの novel モード切り替え
// ─────────────────────────────────────────
export const novelModeEffect = StateEffect.define<boolean>();

// ─────────────────────────────────────────
// StateField：エディタごとの novel モード状態
// default は false（通常の Obsidian 表示）
// novelModeEffect を dispatch することで切り替わる
// ─────────────────────────────────────────
export const novelModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(novelModeEffect)) return e.value;
    }
    return value;
  },
});

// ─────────────────────────────────────────
// D&D：サイドバーの用語行をドラッグする際に使う
// カスタム MIME タイプ。
// 値は JSON.stringify({ filePath, name }) を格納する。
// サイドバー内のフォルダ移動（既存機能）は dataTransfer を
// 参照しないため、このタイプの追加による影響はない。
// メインエディタ側の Wikilink 挿入機能は、この MIME タイプの
// 有無で「サイドバーからの用語ドラッグかどうか」を判定する。
// ─────────────────────────────────────────
export const TERM_DRAG_MIME_TYPE = "application/x-novels-note-term";
