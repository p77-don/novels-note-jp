// ─────────────────────────────────────────
// Novels Note JP — 設定定義
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// カテゴリ定義（キャラクター・場所など、用語の分類）
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
// 用語入力パレットの起動範囲
// ─────────────────────────────────────────
export type GlossaryPaletteScope =
  | "novelOnly"        // 原稿ノート（mode: novel）のみ
  | "novelAndGlossary" // 原稿ノート ＋ 用語ノート（デフォルト）
  | "all";              // すべてのノート

// ─────────────────────────────────────────
// 原稿クリーニング定義ファイル（manuscript-rules.json）の登録情報
//
// 【2026-08 設計変更】Novels Bookcrafter の開発計画を凍結したことに
// 伴い、定義ファイルは「Vault内の任意の場所」ではなく、本プラグイン
// 専用フォルダ（.obsidian/plugins/novels-note-jp/rules/）に固定して
// 保存する方式へ変更した。保存先フォルダが固定されたため、
// ユーザーが指定するのはファイル名のみとなる。
// ─────────────────────────────────────────
export interface ManuscriptRulesFileRef {
  /** プラグイン専用フォルダ（rules/）内でのファイル名（例: manuscript-rules.json） */
  fileName: string;
  /** UI表示用の任意ラベル（未設定時はファイル名を表示に使う） */
  label?: string;
}

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

  // 用語ハイライトのホバープレビュー（エディタ上で用語ノートを確認する機能）
  termHoverPreviewEnabled: boolean;

  // 全角スペース可視化
  showFullWidthSpace: boolean;
  fullWidthSpaceStyle: FullWidthSpaceStyle;
  fullWidthSpaceColor: string;

  // ルビ
  rubyStyle: RubyStyle;

  // 文字数カウント
  // 【2026-08 一本化】カウント対象の絞り込み（#tag・空行の除外）は、
  // Exportと同じ manuscript-rules エンジンで処理されるようになったため、
  // 個別トグル（旧 countHashtags / countEmptyLines）は廃止した。
  // どの原稿クリーニング定義を使うかは defaultManuscriptRulesPath に従う。
  countMode: "raw" | "novel" | "page";
  countFullWidthSpace: boolean;
  // ルビ文字（読み仮名）を文字数に含めるか。
  // false（デフォルト）: 親文字のみカウント（一般的な原稿の文字数の数え方）
  // true: 親文字に加えてルビの読み仮名部分もカウントする
  countRubyText: boolean;
  // ページ換算（旧「原稿用紙換算」）の1ページあたりの設定
  // 【2026-08 統合】1行あたりの文字数は、エディタの「折り返し文字数」
  // （wrapColumn）と意味が重複するため、専用フィールドを廃止して
  // wrapColumn を兼用する。将来、縦書きプレビューを本のページ単位で
  // 表示する機能を追加する際にも、この2値（wrapColumn・pageLinesPerPage）
  // をそのままページの寸法として使う想定。
  pageLinesPerPage: number; // 1ページあたりの行数（デフォルト20＝wrapColumn=20との組み合わせで旧400字詰め相当）

  // 縦書きプレビュー
  verticalCursorHighlightColor: string;   // カーソル行の背景色
  verticalCursorHighlightEnabled: boolean; // カーソルハイライトのオン/オフ

  // 用語インデックス除外フォルダ
  excludeFolders: string[];  // 用語インデックス（サイドバー・ハイライト）から除外するフォルダパス

  // 執筆情報一覧 除外フォルダ
  statsExcludeFolders: string[]; // 執筆情報一覧（原稿ノートの検索）から除外するフォルダパス

  // 執筆情報一覧 推定読了時間
  readingSpeedCharsPerMinute: number; // 読了速度の目安（字/分）。小説換算文字数（novel）を基準に計算する。

  // 用語入力パレット
  glossaryPaletteEnabled: boolean;         // 機能全体のオン/オフ
  glossaryPaletteScope: GlossaryPaletteScope; // 起動範囲
  glossaryPaletteTrigger: string;          // 起動トリガー文字（デフォルト "/"）

  // 原稿クリーニング定義（manuscript-rules.json）
  // プラグイン専用フォルダ（.obsidian/plugins/novels-note-jp/rules/）に保存する
  manuscriptRulesFiles: ManuscriptRulesFileRef[]; // 登録済みの定義ファイル一覧
  defaultManuscriptRulesFileName?: string;        // Export・文字数カウントで既定として使う定義ファイル名（未設定＝組み込みの初期設定を使う）
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

  // 用語ハイライトのホバープレビュー
  termHoverPreviewEnabled: true,

  // 全角スペース可視化
  showFullWidthSpace: true,
  fullWidthSpaceStyle: "dot",
  fullWidthSpaceColor: "#888888",

  // ルビ
  rubyStyle: "narou",

  // 文字数カウント
  countMode: "raw",
  countFullWidthSpace: false,
  countRubyText: false,
  pageLinesPerPage: 20,

  // 縦書きプレビュー
  verticalCursorHighlightColor: "#3a5a8a",
  verticalCursorHighlightEnabled: true,

  // 用語インデックス除外フォルダ
  excludeFolders: [],

  // 執筆情報一覧 除外フォルダ
  statsExcludeFolders: [],

  // 執筆情報一覧 推定読了時間
  readingSpeedCharsPerMinute: 400,

  // 用語入力パレット
  glossaryPaletteEnabled: false,
  glossaryPaletteScope: "novelAndGlossary",
  glossaryPaletteTrigger: "/",

  // 原稿クリーニング定義（manuscript-rules.json）
  manuscriptRulesFiles: [],
  defaultManuscriptRulesFileName: undefined,
};

// ─────────────────────────────────────────
// 用語入力パレット：トリガー文字として選択不可の記号
// Markdown・Obsidianで一般的に使用される記号との衝突を避ける
// ─────────────────────────────────────────
export const GLOSSARY_PALETTE_FORBIDDEN_TRIGGERS = [
  "#", "*", ">", "[", "]", "(", ")", "`",
];
