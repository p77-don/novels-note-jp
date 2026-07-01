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
// StateEffect：カッコハイライト／用語ハイライトの
// デバウンスされた再構築トリガー
//
// カッコ・用語ハイライトは文書全体をスキャンするため、
// docChanged のたびに即座に再構築すると、長文・多用語の
// Vault でタイプ入力がもたつく原因になる。
// 各 ViewPlugin は docChanged を検知しても即座には再構築せず、
// 一定時間（数百ms）入力が止まってからこの effect を
// dispatch し、それをトリガーに再構築する（main.ts の
// scheduleRebuild と同じデバウンスの考え方）。
// ─────────────────────────────────────────
export const bracketRebuildEffect = StateEffect.define<null>();
export const termRebuildEffect = StateEffect.define<null>();

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
