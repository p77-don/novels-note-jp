// ─────────────────────────────────────────
// Novels Note JP — 用語ハイライトの一致判定
//
// 本文中から、用語インデックスに登録された用語名・エイリアスに
// 一致する範囲を検出する。
//
// もともとは editor/extensions.ts の buildTermExtension() 内に
// インライン実装されていたが、editor/rubyWidget.ts（ルビ表示）側でも
// 「ルビの親文字が用語ハイライト対象かどうか」を判定するために
// 同じロジックが必要になったため、共有モジュールとして切り出した。
// 実装がずれると、用語ハイライトの表示（本文側）とルビ親文字の
// ハイライト判定（ルビ側）で一致基準が食い違う不具合の原因になるため、
// 必ずこの関数を両方から利用すること。
// ─────────────────────────────────────────

import { NovelsNoteSettings } from "../settings";
import { TermEntry } from "../types";

export interface TermMatch {
  start: number;
  end: number;
  cssClass: string;
  filePath: string;
}

/**
 * 本文（docText）から、有効なタグに属する用語名・エイリアスの
 * 一致範囲を検出する。
 *
 * - 長い語を優先してマッチさせ、既にマッチ済みの範囲は再利用しない
 *   （例：「山田太郎」と「太郎」が両方登録されている場合、
 *   「山田太郎」を優先して一致させる）。
 * - タグが無効化されている用語は対象外にする。
 */
export function findTermMatches(
  docText: string,
  terms: TermEntry[],
  settings: NovelsNoteSettings
): TermMatch[] {
  if (terms.length === 0) return [];

  const enabledTags = new Set(
    settings.tagDefinitions.filter(td => td.enabled).map(td => td.tag)
  );

  const searchList: { word: string; cssClass: string; filePath: string }[] = [];
  for (const term of terms) {
    if (!enabledTags.has(term.tag)) continue;
    searchList.push({ word: term.name, cssClass: `novel-hl-${term.tag}`, filePath: term.filePath });
    for (const alias of term.aliases) {
      if (alias.trim().length > 0) {
        searchList.push({ word: alias.trim(), cssClass: `novel-hl-${term.tag}`, filePath: term.filePath });
      }
    }
  }
  if (searchList.length === 0) return [];

  searchList.sort((a, b) => b.word.length - a.word.length);

  const docLength = docText.length;
  const covered = new Uint8Array(docLength);
  const matches: TermMatch[] = [];

  for (const { word, cssClass, filePath } of searchList) {
    if (word.length === 0) continue;
    let pos = 0;
    while (pos <= docLength - word.length) {
      const idx = docText.indexOf(word, pos);
      if (idx === -1) break;
      let skip = false;
      for (let i = idx; i < idx + word.length; i++) {
        if (covered[i]) { skip = true; break; }
      }
      if (!skip) {
        matches.push({ start: idx, end: idx + word.length, cssClass, filePath });
        for (let i = idx; i < idx + word.length; i++) covered[i] = 1;
      }
      pos = idx + word.length;
    }
  }

  matches.sort((a, b) => a.start - b.start);
  return matches;
}
