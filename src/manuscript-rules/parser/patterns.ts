// ─────────────────────────────────────────
// manuscript-rules — Parser（要素認識）
//
// このファイルの責務は「これは Heading」「これは Wikilink」といった
// 要素の認識（検出）のみ。除去するか・変換するかの判断は Cleaner が行う。
//
// 【iOS互換性についての注意】
// 既存の core/hashtags.ts と同じ理由により、lookbehind（(?<=...)）は
// 使用しない（iOS 16.4未満は非対応）。境界判定が必要な箇所は、
// キャプチャグループ or offsetベースの判定で代替する。
// ─────────────────────────────────────────

// ── Frontmatter ──────────────────────────────
// 行頭の --- のみにマッチさせ、値に --- を含む YAML キーの誤検出を防ぐ
export const FRONTMATTER_RE = /^---[ \t]*\n[\s\S]*?\n---[ \t]*\n?/;

// ── Obsidian コメント ─────────────────────────
export const COMMENT_RE = /%%[\s\S]*?%%/g;

// ── Callout ───────────────────────────────────
// > [!type] ... で始まり、以後の連続する > 行を1つのCalloutブロックとみなす
export const CALLOUT_BLOCK_RE = /^(>[ \t]*\[![\w-]+\][^\n]*\n(?:>[ \t]*[^\n]*\n?)*)/gm;
// Callout本文の各行から先頭マーカーを取り除くための行単位マッチ
// （1行目: "> [!type] タイトル" / 2行目以降: "> 本文"）
export const CALLOUT_LINE_RE = /^>[ \t]?(\[![\w-]+\][ \t]*)?(.*)$/gm;

// ── Blockquote（Calloutではない通常の引用） ────
// 連続する "> " 行のかたまりを1ブロックとして扱う。
// 先頭が Callout ヘッダー（"> [!type]"）で始まるブロックは対象外とする
// （Calloutが keep された場合に、後続のBlockquote処理が誤って
//   同じ ">" 行を処理してしまうのを防ぐため。lookaheadはiOSでも問題なく使用可）。
export const BLOCKQUOTE_BLOCK_RE = /^(?!>[ \t]*\[![\w-]+\])(>[ \t]?[^\n]*\n?)+/gm;
export const BLOCKQUOTE_LINE_RE = /^>[ \t]?(.*)$/gm;

// ── Wikilink ──────────────────────────────────
export const WIKILINK_PIPE_RE = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
export const WIKILINK_PLAIN_RE = /\[\[([^\]]+)\]\]/g;

// ── Heading ───────────────────────────────────
export const HEADING_RE = /^(#{1,6})([ \t]+)(.*)$/gm;

// ── List ──────────────────────────────────────
export const LIST_UNORDERED_LINE_RE = /^([ \t]*)([-*+])([ \t]+)(.*)$/gm;
export const LIST_ORDERED_LINE_RE = /^([ \t]*)(\d+\.)([ \t]+)(.*)$/gm;

// ── Emphasis（強調） ──────────────────────────
export const EMPHASIS_RE = /(\*{1,3}|_{1,3})([\s\S]*?)\1/g;

// ── Horizontal Rule ───────────────────────────
export const HORIZONTAL_RULE_RE = /^[ \t]*[-*_]{3,}[ \t]*$/gm;

// ── Code Block（フェンス） ────────────────────
export const CODE_FENCE_BACKTICK_RE = /^```[\s\S]*?^```[ \t]*$/gm;
export const CODE_FENCE_TILDE_RE = /^~~~[\s\S]*?^~~~[ \t]*$/gm;
// フェンス内の中身のみ（editでフェンスだけ外す用）
export const CODE_FENCE_BACKTICK_CAPTURE_RE = /^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;
export const CODE_FENCE_TILDE_CAPTURE_RE = /^~~~[^\n]*\n([\s\S]*?)^~~~[ \t]*$/gm;

// ── Inline Code ───────────────────────────────
export const INLINE_CODE_RE = /`([^`]+)`/g;

// ── Image（Markdown記法） ─────────────────────
// 行全体が画像記法のみの行か、本文中に混在しているかは区別せず、
// 出現位置にかかわらず一律で検出する（2026-08: block/inlineの区別を廃止）。
export const IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/g;

// ── Markdown Link ─────────────────────────────
// 画像記法 ![...](...) の [...](...) 部分を誤って通常リンクとしてマッチしないよう、
// 直前の "!" を同一マッチ内に取り込んで判定する（lookbehind不使用）。
export const MARKDOWN_LINK_OR_IMAGE_RE = /(!)?\[([^\]]+)\]\(([^)]+)\)/g;

// ── HTML タグ（ruby/rt を除く） ────────────────
// 行全体がHTMLタグのみで構成されている場合 → blockHTML
export const BLOCK_HTML_LINE_RE = /^[ \t]*<(?!\/?(ruby|rt)\b)[^>]+>[ \t]*$/gim;
export const HTML_TAG_RE = /<(?!\/?(ruby|rt)\b)[^>]+>/gi;
