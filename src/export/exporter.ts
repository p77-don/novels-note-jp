// ─────────────────────────────────────────
// Novels Note JP — 原稿 Export パイプライン
//
// 本文ファイルは一切変更しない（Read Only Export）。
//
// 【2026-08 リファクタリング】
// かつては本ファイル内で16段階の正規表現置換を直接行っていたが、
// Novels Bookcrafter との処理共有を見据えて
// src/manuscript-rules/（Parser → Rules → Cleaner）へ処理を委譲する形に
// 変更した。
//
// 【2026-08 追記】
// 過渡期には「従来のExport詳細設定（ExportOptionsベース）」と
// 「登録済み原稿処理定義（manuscript-rules.jsonベース）」の2系統が
// 併存していたが、どちらの処理が使われているかユーザーから見て
// 不透明で混乱を招くため、旧ExportOptions系のパイプラインは廃止した。
// 現在は Export 処理は必ず ManuscriptRulesDefinition
// （登録済み定義ファイル、または未登録時は組み込みのデフォルト定義）
// を経由する一本化された経路のみを持つ。実際の変換処理は
// src/export/exportModal.ts から直接 cleanManuscript() を呼び出している。
// ─────────────────────────────────────────

import { convertRubyStyle, rubyPairToStyle } from "../manuscript-rules/utils/rubyConvert";

// 他プラグインコードや将来の拡張から
// import { convertRubyStyle } from "./exporter" と書けるよう re-export しておく。
export { convertRubyStyle, rubyPairToStyle };

// ─────────────────────────────────────────
// 出力形式（ファイル拡張子）
//
// これは原稿クリーニングのルールとは無関係な、出力ファイルの
// 種類の選択にすぎないため、manuscript-rules 側には持たせず
// ここに残す。
// ─────────────────────────────────────────
export type ExportFormat = "txt" | "md";

// ─────────────────────────────────────────
// ファイル名生成
// ─────────────────────────────────────────
export function makeExportFilename(
  originalName: string,
  format: ExportFormat
): string {
  const dot = originalName.lastIndexOf(".");
  const base = dot !== -1 ? originalName.substring(0, dot) : originalName;
  return `${base}_export.${format}`;
}
