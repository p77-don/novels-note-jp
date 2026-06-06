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
