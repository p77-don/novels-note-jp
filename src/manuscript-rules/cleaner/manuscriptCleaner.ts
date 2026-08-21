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
  applyHorizontalRuleRule,
  applyImageRule,
  applyMarkdownLinkRule,
  applyWikilinkRule,
  applyTagRule,
  applyBlockHtmlRule,
  applyInlineHtmlRule,
  applyRubyRule,
} from "./elementCleaner";
import { applyCodeBlockRule, applyInlineCodeRule } from "./codeCleaner";
import { applyBlankLinesRule, applyTrailingWhitespaceRule } from "./normalizer";

export function cleanManuscript(
  source: string,
  rules: ManuscriptRules,
  sourceRubyStyle: RubyStyle
): string {
  let text = source;

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

  // 3-4. コードブロック / インラインコード（codeBlockが保護される場合のみ、ここで先に処理する）
  let codeBlockResult = { text, restore: (t: string) => t };
  let inlineCodeResult = { text, restore: (t: string) => t };
  if (!codeBlockIsLateRemove) {
    codeBlockResult = applyCodeBlockRule(text, codeBlockRule);
    text = codeBlockResult.text;
    inlineCodeResult = applyInlineCodeRule(text, inlineCodeRule);
    text = inlineCodeResult.text;
  }

  // 5. Callout（keepの場合はブロック全体を保護し、以後の処理から隠す）
  const calloutResult = applyCalloutRule(text, rules.block?.callout);
  text = calloutResult.text;

  // 6. Wikilink
  text = applyWikilinkRule(text, rules.inline?.wikilink);

  // 7. タグ
  text = applyTagRule(text, rules.inline?.tag);

  // 8. 見出し
  text = applyHeadingRule(text, rules.block?.heading);

  // 9. Blockquote
  text = applyBlockquoteRule(text, rules.block?.blockquote);

  // 10. リスト
  text = applyListRule(text, rules.block?.list);

  // 11. 強調
  text = applyEmphasisRule(text, rules.inline?.emphasis);

  // 12. 水平線
  text = applyHorizontalRuleRule(text, rules.block?.horizontalRule);

  // 13. コードブロック / インラインコード（codeBlockがここまで「生のフェンス記号」を
  //     残している場合、ここ＝旧exporter.tsのStep11相当の位置でまずフェンスを削除し、
  //     その直後にインラインコードを処理することで、フェンス境界をまたぐ誤マッチを防ぐ）
  if (codeBlockIsLateRemove) {
    codeBlockResult = applyCodeBlockRule(text, codeBlockRule);
    text = codeBlockResult.text;
    inlineCodeResult = applyInlineCodeRule(text, inlineCodeRule);
    text = inlineCodeResult.text;
  }

  // 14. 画像
  text = applyImageRule(text, rules.inline?.image);

  // 15. Markdownリンク
  text = applyMarkdownLinkRule(text, rules.inline?.markdownLink);

  // 16-17. HTMLタグ（行全体がタグのみ＝block／本文中に混在＝inline。ruby/rtは対象外）
  text = applyBlockHtmlRule(text, rules.block?.html);
  text = applyInlineHtmlRule(text, rules.inline?.html);

  // 18. ルビ
  text = applyRubyRule(text, rules.inline?.ruby, sourceRubyStyle);

  // 19. 連続空行の圧縮
  text = applyBlankLinesRule(text, rules.document?.blankLines);

  // 20. 末尾の余分な空白行を除去
  text = applyTrailingWhitespaceRule(text, rules.document?.trailingWhitespace);

  // 21-23. 保護しておいたコードブロック / インラインコード / Calloutを復元
  //        （blankLines正規化の影響を受けないよう、最後に復元する。
  //        remove / edit の場合はここでは何もしない no-op）
  text = inlineCodeResult.restore(text);
  text = codeBlockResult.restore(text);
  text = calloutResult.restore(text);

  return text;
}
