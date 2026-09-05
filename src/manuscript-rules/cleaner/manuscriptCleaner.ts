// ─────────────────────────────────────────
// manuscript-rules — Cleaner 全体処理の入口
//
// 原稿本文へ ManuscriptRules を順番に適用し、クリーニング済みテキストを返す。
// 元の原稿ファイルは一切変更しない（呼び出し側で読み込んだ文字列を処理するのみ）。
//
// 処理順序は旧 exporter.ts の16ステップと基本的に対応させているが、
// codeBlock / inlineCode の保護だけはパイプラインの早い段階に移動している
// （詳細は cleaner/codeCleaner.ts のコメントを参照）。
// ─────────────────────────────────────────

import { RubyStyle } from "../../settings";
import type { ManuscriptRules } from "../types/rules";
import {
  applyFrontmatterRule,
  applyCommentRule,
  applyCalloutRule,
  applyHeadingRule,
  applyBlockquoteRule,
  applyListRule,
  applyEmphasisRule,
  applyStrikethroughRule,
  applyHighlightRule,
  applyHorizontalRuleRule,
  applyImageRule,
  applyMarkdownLinkRule,
  applyWikilinkRule,
  applyEmbedRule,
  applyTagRule,
  applyBlockHtmlRule,
  applyInlineHtmlRule,
  applyRubyRule,
  applyFootnoteReferenceRule,
  applyFootnoteInlineRule,
} from "./elementCleaner";
import { applyCodeBlockRule, applyInlineCodeRule } from "./codeCleaner";
import { applyMathRule } from "./mathCleaner";
import { applyBlankLinesRule, applyTrailingWhitespaceRule } from "./normalizer";

export function cleanManuscript(
  source: string,
  rules: ManuscriptRules,
  sourceRubyStyle: RubyStyle
): string {
  // ─────────────────────────────────────────
  // 【CR-004 対応】改行コードの正規化
  //
  // 以後のクリーニング処理の正規表現（^ / $ / [\s\S] などを多用）は
  // すべて改行が "\n" であることを前提に書かれている。呼び出し元
  // （novelReadingView.ts・exportModal.ts）は Vault#read() で
  // ファイルを直接読み込んでおり、Windows で編集された、あるいは
  // 他ツール経由で持ち込まれた原稿が CRLF ("\r\n") や 古い Mac
  // 形式の CR ("\r") を含んでいる可能性がある。
  // CRLF/CR が残ったまま処理すると、行頭・行末アンカー（^ $）が
  // 想定通りに一致せず、見出し・リスト・引用などの検出が
  // 一部の行だけ失敗し、余分な "\r" が地の文に残ってしまう。
  // パイプラインの最初に一度だけ LF へ正規化することで、
  // 以後のすべてのルールが安全に動作するようにする。
  // ─────────────────────────────────────────
  let text = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const codeBlockRule = rules.block?.codeBlock;
  const inlineCodeRule = rules.inline?.inlineCode;
  // action === "remove" のときだけ、旧 exporter.ts と全く同じ位置
  // （見出し・引用・リスト・強調・水平線処理の"後"）で削除する。
  // keep / edit のときは、以後の処理から中身を守るため先に保護する
  // （詳細は codeCleaner.ts のコメントを参照）。
  //
  // inlineCode は codeBlock と同じタイミングで処理する。
  // codeBlock がまだ「生のフェンス記号（```）」を残したまま後段に
  // 進む場合（= codeBlockIsLateRemove）、その手前で inlineCode の
  // バッククォート正規表現を先に走らせると、フェンスの境界をまたいで
  // 誤マッチしてしまう（例: ``` ... ``` 全体を1つのインラインコードの
  // ように誤認識し、バッククォートが2個だけ残る形で壊れる）。
  // そのため、codeBlock が保護される場合のみ inlineCode も早期に処理し、
  // codeBlock が後段で削除される場合は inlineCode もその直後まで待つ。
  const codeBlockIsLateRemove = codeBlockRule?.action === "remove";

  // 1. Frontmatter
  text = applyFrontmatterRule(text, rules.metadata?.frontmatter);

  // 2. Obsidianコメント
  text = applyCommentRule(text, rules.block?.comment);

  // 3. 数式（$$...$$。keepの場合は他の処理から中身を保護する）
  const mathResult = applyMathRule(text, rules.block?.math);
  text = mathResult.text;

  // 4-5. コードブロック / インラインコード（codeBlockが保護される場合のみ、ここで先に処理する）
  let codeBlockResult = { text, restore: (t: string) => t };
  let inlineCodeResult = { text, restore: (t: string) => t };
  if (!codeBlockIsLateRemove) {
    codeBlockResult = applyCodeBlockRule(text, codeBlockRule);
    text = codeBlockResult.text;
    inlineCodeResult = applyInlineCodeRule(text, inlineCodeRule);
    text = inlineCodeResult.text;
  }

  // 6. 埋め込み（![[ノート名]]。keepの場合、後続のWikilink処理から
  //    内部の "[[...]]" 部分を保護する）
  const embedResult = applyEmbedRule(text, rules.inline?.embed);
  text = embedResult.text;

  // 7. Callout（keepの場合はブロック全体を保護し、以後の処理から隠す）
  const calloutResult = applyCalloutRule(text, rules.block?.callout);
  text = calloutResult.text;

  // 8. Wikilink
  text = applyWikilinkRule(text, rules.inline?.wikilink);

  // 9. 脚注（参照形式の定義・マーカー、インライン形式）
  //    参照マーカー用正規表現が定義行と誤って二重マッチしないよう、
  //    applyFootnoteReferenceRule内で定義→マーカーの順に処理している。
  text = applyFootnoteReferenceRule(text, rules.inline?.footnoteReference);
  text = applyFootnoteInlineRule(text, rules.inline?.footnoteInline);

  // 10. タグ
  text = applyTagRule(text, rules.inline?.tag);

  // 11. 見出し
  text = applyHeadingRule(text, rules.block?.heading);

  // 12. Blockquote
  text = applyBlockquoteRule(text, rules.block?.blockquote);

  // 13. リスト
  text = applyListRule(text, rules.block?.list);

  // 14. 強調
  text = applyEmphasisRule(text, rules.inline?.emphasis);

  // 15. 取り消し線
  text = applyStrikethroughRule(text, rules.inline?.strikethrough);

  // 16. ハイライト
  text = applyHighlightRule(text, rules.inline?.highlight);

  // 17. 水平線
  text = applyHorizontalRuleRule(text, rules.block?.horizontalRule);

  // 18. コードブロック / インラインコード（codeBlockがここまで「生のフェンス記号」を
  //     残している場合、ここ＝旧exporter.tsのStep11相当の位置でまずフェンスを削除し、
  //     その直後にインラインコードを処理することで、フェンス境界をまたぐ誤マッチを防ぐ）
  if (codeBlockIsLateRemove) {
    codeBlockResult = applyCodeBlockRule(text, codeBlockRule);
    text = codeBlockResult.text;
    inlineCodeResult = applyInlineCodeRule(text, inlineCodeRule);
    text = inlineCodeResult.text;
  }

  // 19. 画像
  text = applyImageRule(text, rules.inline?.image);

  // 20. Markdownリンク
  text = applyMarkdownLinkRule(text, rules.inline?.markdownLink);

  // 21-22. HTMLタグ（行全体がタグのみ＝block／本文中に混在＝inline。ruby/rtは対象外）
  text = applyBlockHtmlRule(text, rules.block?.html);
  text = applyInlineHtmlRule(text, rules.inline?.html);

  // 23. ルビ
  text = applyRubyRule(text, rules.inline?.ruby, sourceRubyStyle);

  // 24. 連続空行の圧縮
  text = applyBlankLinesRule(text, rules.document?.blankLines);

  // 25. 末尾の余分な空白行を除去
  text = applyTrailingWhitespaceRule(text, rules.document?.trailingWhitespace);

  // 26-30. 保護しておいた数式 / コードブロック / インラインコード / 埋め込み / Calloutを復元
  //        （blankLines正規化の影響を受けないよう、最後に復元する。
  //        remove / edit の場合はここでは何もしない no-op）
  text = inlineCodeResult.restore(text);
  text = codeBlockResult.restore(text);
  text = embedResult.restore(text);
  text = calloutResult.restore(text);
  text = mathResult.restore(text);

  return text;
}
