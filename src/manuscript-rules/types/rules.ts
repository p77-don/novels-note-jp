// ─────────────────────────────────────────
// manuscript-rules — 原稿クリーニング定義ファイルの型
//
// Novels Note JP / Novels Bookcrafter の両方がこのファイルを共有する。
// 変更時は両プラグインの src/manuscript-rules/ フォルダを同期すること。
//
// 対応する JSON Schema: manuscript-rules.schema.json（設計フェーズで作成）
// ─────────────────────────────────────────

/**
 * manuscript-rules.json のスキーマバージョン。
 * 定義ファイル自身の「世代」ではなく、JSON構造・型そのもののバージョンを表す。
 */
export type ManuscriptRulesSchemaVersion = 1;

// ─────────────────────────────────────────
// 汎用アクション
// ─────────────────────────────────────────

/** keep: そのまま維持 / remove: 要素そのものを完全に削除する */
export type KeepRemoveAction = "keep" | "remove";

/**
 * keep: そのまま維持
 * remove: 要素ごと完全に削除する
 * edit: 記法を除去し中身のテキストのみ残すなど、要素ごとに定義された変換を適用する
 */
export type KeepRemoveEditAction = "keep" | "remove" | "edit";

// ─────────────────────────────────────────
// 共通ルール形状
// ─────────────────────────────────────────

/** edit（変換）を持たない要素向けの最小ルール。 */
export interface SimpleRule {
  action: KeepRemoveAction;
}

/**
 * edit（変換）を持つが、変換方式が1種類しか定義されていない要素向けのルール。
 * 例: callout, blockquote, list, codeBlock, emphasis, markdownLink, inlineCode
 */
export interface EditableRule {
  action: KeepRemoveEditAction;
}

// ─────────────────────────────────────────
// metadata
// ─────────────────────────────────────────

export interface MetadataRules {
  frontmatter?: SimpleRule;
}

// ─────────────────────────────────────────
// block
// ─────────────────────────────────────────

/**
 * inline.image は、edit（変換）仕様が未確定のため、
 * 現時点では SimpleRule（keep / remove のみ）に限定している。
 * 画像対応が固まり次第、専用の ImageRule に拡張する。
 *
 * （2026-08: 「行全体が画像のみの行（block）」と「本文中に混在する
 *  画像（inline）」を区別していたが、処理内容が同じ（keep / remove）
 *  である以上、区別する意味が薄く、原稿クリーニング定義の編集画面で
 *  離れた場所に表示されて分かりにくいという指摘もあったため、
 *  inline側の1つに統合した。）
 */
export type ImageRule = SimpleRule;

export interface BlockRules {
  comment?: SimpleRule;
  callout?: EditableRule;
  /**
   * heading（見出し）。
   * keep: そのまま維持 / remove: 見出し行ごと完全削除 /
   * edit: "#" 記号を外しテキストのみ残す。
   *
   * （2026-08: 「見出しレベルを変更する」オプションは、レベルの異なる
   *  見出しが混在する原稿では意図せず全て同一レベルへ統一されてしまい、
   *  実用上の限界があったため廃止した。）
   */
  heading?: EditableRule;
  blockquote?: EditableRule;
  list?: EditableRule;
  codeBlock?: EditableRule;
  horizontalRule?: SimpleRule;
  html?: SimpleRule;
}

// ─────────────────────────────────────────
// inline
// ─────────────────────────────────────────

/**
 * wikilink専用ルール。
 *
 * editMode:
 *   - fileName:    エイリアスを無視し、常にリンク先ファイル名を残す
 *                  例: [[人物A|A]] → 人物A
 *   - displayText: エイリアスがあればそれを、なければファイル名を残す（デフォルト）
 *                  例: [[人物A|A]] → A 、 [[人物A]] → 人物A
 *
 * 小説の本文としてリンクの「パス」を残す意味はないため、
 * パスをそのまま残す選択肢は設けていない。
 */
export type WikilinkRule =
  | { action: "keep" }
  | { action: "remove" }
  | { action: "edit"; editMode?: "fileName" | "displayText" };

/**
 * ルビ専用ルール。既存 Novels Note JP Exporter の仕様に準拠し、
 * action/edit ではなく mode 単体で処理内容を決定する。
 *
 * none:   ルビ記法をそのまま維持（KEEP相当）
 * remove: ルビを除去し親文字のみ残す
 * narou / aozora / denden / html: 各出力形式に応じたルビ記法へ変換
 */
export type RubyMode = "none" | "remove" | "narou" | "aozora" | "denden" | "html";

export interface RubyRule {
  mode: RubyMode;
}

export interface InlineRules {
  wikilink?: WikilinkRule;
  tag?: SimpleRule;
  emphasis?: EditableRule;
  markdownLink?: EditableRule;
  image?: ImageRule;
  ruby?: RubyRule;
  inlineCode?: EditableRule;
  html?: SimpleRule;
}

// ─────────────────────────────────────────
// document（文書全体の整形。個別要素の除去・変換とは別カテゴリ）
// ─────────────────────────────────────────

export type BlankLinesRule =
  | { action: "keep" }
  | { action: "normalize"; maxConsecutive?: number };

export interface TrailingWhitespaceRule {
  action: "keep" | "normalize";
}

export interface DocumentRules {
  blankLines?: BlankLinesRule;
  trailingWhitespace?: TrailingWhitespaceRule;
}

// ─────────────────────────────────────────
// ルート
// ─────────────────────────────────────────

export interface ManuscriptRules {
  metadata?: MetadataRules;
  block?: BlockRules;
  inline?: InlineRules;
  document?: DocumentRules;
}

/**
 * manuscript-rules.json のルート型。
 * Novels Note JP / Novels Bookcrafter の両方がこの型を共有する。
 */
export interface ManuscriptRulesDefinition {
  version: ManuscriptRulesSchemaVersion;
  /** UI上に表示する任意のラベル。ファイル名とは独立して持つ。 */
  name?: string;
  /** 定義ファイルが最初に作成された日時（ISO 8601）。以後編集しても変更しない。 */
  createdAt: string;
  /** ルール内容がUI等によって最後に更新された日時（ISO 8601）。 */
  updatedAt: string;
  rules: ManuscriptRules;
}

export type BlockElementKey = keyof BlockRules;
export type InlineElementKey = keyof InlineRules;
export type DocumentRuleKey = keyof DocumentRules;
