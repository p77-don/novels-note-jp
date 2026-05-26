// ─────────────────────────────────────────
// Novels Note JP — 型定義・定数
// ─────────────────────────────────────────

import { StateEffect } from "@codemirror/state";
import { NovelsNoteSettings } from "./settings";

// ─────────────────────────────────────────
// 定数
// ─────────────────────────────────────────
export const SIDEBAR_VIEW_TYPE   = "novels-note-jp-sidebar";
export const VERTICAL_VIEW_TYPE  = "novels-note-jp-vertical";

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
