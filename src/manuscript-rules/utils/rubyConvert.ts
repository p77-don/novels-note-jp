// ─────────────────────────────────────────
// manuscript-rules — ルビ変換（共通ユーティリティ）
//
// 元々 src/export/exporter.ts にあったロジックをここへ移設し、
// manuscript-rules の Cleaner から利用できるようにした。
// exporter.ts 側は後方互換のため、この関数を re-export する。
//
// 【設計方針】
// 方式ごとに1つの正規表現で全パターンを網羅し、
// String.replace() コールバックでその場で変換する（1パス）。
// ルビ記法の検出自体は core/rubyPatterns.ts の findRubyMatches() に
// 委譲している（エディタ内プレビュー・縦書きプレビュー・小説閲覧ビューと
// 検出基準・CJK文字範囲を統一するため）。
// ─────────────────────────────────────────

import { RubyStyle } from "../../settings";
import { findRubyMatches } from "../../core/rubyPatterns";
import type { RubyMode } from "../types/rules";

/** ルビペアを指定の方式に文字列化する */
export function rubyPairToStyle(base: string, ruby: string, target: RubyMode): string {
  switch (target) {
    case "none":    return base + "《" + ruby + "》"; // 呼ばれないはず
    case "remove":  return base;
    case "narou":   return "|" + base + "《" + ruby + "》";
    case "aozora":  return "｜" + base + "《" + ruby + "》";
    case "denden":  return "{" + base + "|" + ruby + "}";
    case "html":    return "<ruby>" + base + "<rt>" + ruby + "</rt></ruby>";
  }
}

/**
 * テキスト内のルビ記法を変換する。
 * sourceStyle の記法を検出し、target の方式に変換して返す。
 */
export function convertRubyStyle(text: string, sourceStyle: RubyStyle, target: RubyMode): string {
  if (target === "none") return text;

  const matches = findRubyMatches(text, sourceStyle);
  if (matches.length === 0) return text;

  let result = "";
  let cursor = 0;
  for (const m of matches) {
    result += text.slice(cursor, m.from);
    result += rubyPairToStyle(m.base, m.ruby, target);
    cursor = m.to;
  }
  result += text.slice(cursor);
  return result;
}
