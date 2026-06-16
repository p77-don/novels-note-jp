// ─────────────────────────────────────────
// Novels Note JP — 設定定義
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// タグ定義
// ─────────────────────────────────────────
export interface TagDefinition {
  tag: string;
  label: string;
  color: string;
  enabled: boolean;
}

// ─────────────────────────────────────────
// カッコ定義
// ─────────────────────────────────────────
export interface BracketDefinition {
  id: string;
  label: string;
  open: string;
  close: string;
  color: string;
  enabled: boolean;
}

// ─────────────────────────────────────────
// ルビ方式
// ─────────────────────────────────────────
export type RubyStyle =
  | "narou"   // 小説家になろう式：漢字《ルビ》または |漢字《ルビ》（半角縦棒）
  | "aozora"  // 青空文庫式：漢字《ルビ》または ｜漢字《ルビ》（全角縦棒）
  | "denden"  // でんでんマークダウン式：{漢字|ルビ}
  | "html";   // HTML ruby タグのみ

// ─────────────────────────────────────────
// 全角スペースの可視化スタイル
// ─────────────────────────────────────────
export type FullWidthSpaceStyle =
  | "dot"       // 中央に薄いドット「·」を重ねる（デフォルト）
  | "underline" // 下線で幅を示す
  | "box"       // 薄いボーダーで囲む
  | "none";     // 表示しない（機能オフ）

// ─────────────────────────────────────────
// プラグイン全体設定
// ─────────────────────────────────────────
export interface NovelsNoteSettings {
  wrapColumn: number;
  showRuler: boolean;
  rulerColor: string;
  rulerOpacity: number;
  rulerStyle: "solid" | "dashed";
  fontSize: number;
  lineHeight: number;
  highlightEnabled: boolean;
  tagDefinitions: TagDefinition[];
  bracketDefinitions: BracketDefinition[];

  // 全角スペース可視化
  showFullWidthSpace: boolean;
  fullWidthSpaceStyle: FullWidthSpaceStyle;
  fullWidthSpaceColor: string;

  // ルビ
  rubyStyle: RubyStyle;

  // 文字数カウント
  countMode: "raw" | "novel" | "manuscript";
  countFullWidthSpace: boolean;
  countEmptyLines: boolean;

  // 縦書きプレビュー
  verticalCursorHighlightColor: string;   // カーソル行の背景色
  verticalCursorHighlightEnabled: boolean; // カーソルハイライトのオン/オフ

  // 用語インデックス除外フォルダ
  excludeFolders: string[];  // 用語インデックス（サイドバー・ハイライト）から除外するフォルダパス
}

// ─────────────────────────────────────────
// デフォルト値
// ─────────────────────────────────────────
export const DEFAULT_TAG_DEFINITIONS: TagDefinition[] = [
  { tag: "character",    label: "キャラクター", color: "#e06c75", enabled: true },
  { tag: "location",     label: "場所",         color: "#61afef", enabled: true },
  { tag: "glossary",     label: "用語",         color: "#98c379", enabled: true },
  { tag: "organization", label: "組織",         color: "#e5c07b", enabled: true },
  { tag: "item",         label: "アイテム",     color: "#c678dd", enabled: true },
];

export const DEFAULT_BRACKET_DEFINITIONS: BracketDefinition[] = [
  { id: "kakko",        label: "鍵カッコ「」",     open: "「", close: "」", color: "#d4a843", enabled: true  },
  { id: "double-kakko", label: "二重鍵カッコ『』", open: "『", close: "』", color: "#d4843e", enabled: true  },
  { id: "maru",         label: "丸カッコ（）",     open: "（", close: "）", color: "#888888", enabled: false },
  { id: "kaku",         label: "隅付きカッコ【】", open: "【", close: "】", color: "#888888", enabled: false },
  { id: "angle",        label: "山カッコ〈〉",     open: "〈", close: "〉", color: "#888888", enabled: false },
  { id: "double-angle", label: "二重山カッコ《》", open: "《", close: "》", color: "#888888", enabled: false },
];

export const DEFAULT_SETTINGS: NovelsNoteSettings = {
  wrapColumn: 40,
  showRuler: true,
  rulerColor: "#888888",
  rulerOpacity: 0.4,
  rulerStyle: "solid",
  fontSize: 16,
  lineHeight: 2.0,
  highlightEnabled: true,
  tagDefinitions: DEFAULT_TAG_DEFINITIONS.map(v => ({ ...v })),
  bracketDefinitions: DEFAULT_BRACKET_DEFINITIONS.map(v => ({ ...v })),

  // 全角スペース可視化
  showFullWidthSpace: true,
  fullWidthSpaceStyle: "dot",
  fullWidthSpaceColor: "#888888",

  // ルビ
  rubyStyle: "narou",

  // 文字数カウント
  countMode: "raw",
  countFullWidthSpace: false,
  countEmptyLines: false,

  // 縦書きプレビュー
  verticalCursorHighlightColor: "#3a5a8a",
  verticalCursorHighlightEnabled: true,

  // 用語インデックス除外フォルダ
  excludeFolders: [],
};
