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

// ── ハイライト（==強調対象==） ─────────────────
export const HIGHLIGHT_RE = /==([\s\S]+?)==/g;

// ── 取り消し線（~~取り消し対象~~） ─────────────
// コードフェンス（~~~）は codeCleaner.ts で本パターンより先に
// 保護／削除されるため、処理順を守る限り衝突しない。
export const STRIKETHROUGH_RE = /~~([\s\S]+?)~~/g;

// ── 数式（$$...$$ ブロックのみ対応） ───────────
// 単一の $...$ 記法は「$5 と $10」のような通貨表記との誤検出リスクが
// 高く、小説原稿では数式より通貨表記の方が出現頻度が高いと判断し、
// 意図的に対象外としている（ブロック形式の $$...$$ のみ対応）。
export const MATH_BLOCK_RE = /\$\$[\s\S]*?\$\$/g;

// ── 埋め込み（![[ノート名]] / ![[ノート名|表示名]]） ──
// Wikilink（[[...]]）と記法上ネストする関係にあるため、
// cleaner側では埋め込みをWikilinkより先に処理し、"keep"の場合は
// プレースホルダーで保護してからWikilink処理に進む
// （lookbehind不使用の方針のため、"!"の有無を正規表現内で
//  判定するのではなく、処理順序で衝突を避ける）。
export const EMBED_PIPE_RE = /!\[\[([^\]|]+)\|([^\]]+)\]\]/g;
export const EMBED_PLAIN_RE = /!\[\[([^\]]+)\]\]/g;

// ── 脚注（参照形式: [^1] とその定義 [^1]: 本文） ──
// 定義: 行頭（インデント0〜3文字まで許容。CommonMark系の慣例に合わせる）
// + "[^label]:" + 同一行内の本文。複数行にわたる継続行には対応しない
// （小説原稿での使用頻度を考慮した簡易実装）。
export const FOOTNOTE_DEF_RE = /^[ \t]{0,3}\[\^([^\]]+)\]:[ \t]?.*$\n?/gm;
// 参照マーカー本体。定義行の除去/保護が済んだ後に処理するため、
// 定義行との誤マッチを心配せず単純な形でマッチしてよい。
export const FOOTNOTE_REF_RE = /\[\^([^\]]+)\]/g;

// ── 脚注（インライン形式: ^[本文]） ────────────
export const FOOTNOTE_INLINE_RE = /\^\[([^\]]+)\]/g;
