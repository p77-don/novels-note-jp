// ─────────────────────────────────────────
// manuscript-rules — Cleaner（要素処理）
//
// Rules に従って、Parserが認識した各要素を KEEP / REMOVE / TRANSFORM(edit) する。
// 各関数は「ルール未指定 → keep相当（何もしない）」を徹底し、
// 副作用のない純粋関数として実装する。
// ─────────────────────────────────────────

import { protectMatches } from "./protect";
import { stripHashtags } from "../../core/hashtags";
import { RubyStyle } from "../../settings";
import { convertRubyStyle } from "../utils/rubyConvert";
import type {
  SimpleRule,
  EditableRule,
  WikilinkRule,
  RubyRule,
} from "../types/rules";
import {
  FRONTMATTER_RE,
  COMMENT_RE,
  CALLOUT_BLOCK_RE,
  CALLOUT_LINE_RE,
  BLOCKQUOTE_BLOCK_RE,
  BLOCKQUOTE_LINE_RE,
  WIKILINK_PIPE_RE,
  WIKILINK_PLAIN_RE,
  HEADING_RE,
  LIST_UNORDERED_LINE_RE,
  LIST_ORDERED_LINE_RE,
  EMPHASIS_RE,
  HORIZONTAL_RULE_RE,
  IMAGE_RE,
  MARKDOWN_LINK_OR_IMAGE_RE,
  BLOCK_HTML_LINE_RE,
  HTML_TAG_RE,
} from "../parser/patterns";

// ─────────────────────────────────────────
// metadata.frontmatter
// ─────────────────────────────────────────
export function applyFrontmatterRule(text: string, rule?: SimpleRule): string {
  if (!rule || rule.action === "keep") return text;
  return text.replace(FRONTMATTER_RE, "");
}

// ─────────────────────────────────────────
// block.comment
// ─────────────────────────────────────────
export function applyCommentRule(text: string, rule?: SimpleRule): string {
  if (!rule || rule.action === "keep") return text;
  return text.replace(COMMENT_RE, "");
}

// ─────────────────────────────────────────
// block.callout
//
// action が "keep"（未指定時のデフォルトも含む）の場合、Calloutブロック
// 全体（複数行にわたる "> [!type] ..." とその後の "> " 行）を
// プレースホルダーで保護し、以後の Blockquote 等の処理が誤って
// 同じ ">" 行を処理してしまわないようにする。保護の復元は
// パイプラインの最後（他の要素処理がすべて終わった後）に行う。
// ─────────────────────────────────────────
export interface CalloutRuleResult {
  text: string;
  restore: (text: string) => string;
}

export function applyCalloutRule(text: string, rule?: EditableRule): CalloutRuleResult {
  if (!rule || rule.action === "keep") {
    return protectMatches(text, CALLOUT_BLOCK_RE, "callout");
  }

  if (rule.action === "remove") {
    return { text: text.replace(CALLOUT_BLOCK_RE, ""), restore: (t) => t };
  }

  // edit: "> [!type] タイトル" と各行頭の "> " を外し、中身のテキストだけ残す
  // （マーカーが除去されるため、以後の処理から保護する必要はない）
  const edited = text.replace(CALLOUT_BLOCK_RE, (block) => {
    const stripped = block.replace(
      CALLOUT_LINE_RE,
      (_m, header: string | undefined, rest: string) => {
        if (header) {
          // 1行目: "[!type] タイトル" のうち [!type] 部分だけ落とす
          return header.replace(/^\[![\w-]+\][ \t]*/, "") + rest;
        }
        return rest;
      }
    );
    return stripped.replace(/[ \t]+$/gm, "");
  });
  return { text: edited, restore: (t) => t };
}

// ─────────────────────────────────────────
// block.heading
// ─────────────────────────────────────────
export function applyHeadingRule(text: string, rule?: EditableRule): string {
  if (!rule || rule.action === "keep") return text;

  if (rule.action === "remove") {
    return text.replace(HEADING_RE, "");
  }

  // edit: "#" 記号を外しテキストのみ残す
  return text.replace(HEADING_RE, (_m, _marks: string, _sp: string, content: string) => content);
}

// ─────────────────────────────────────────
// block.blockquote
// ─────────────────────────────────────────
export function applyBlockquoteRule(text: string, rule?: EditableRule): string {
  if (!rule || rule.action === "keep") return text;

  if (rule.action === "remove") {
    return text.replace(BLOCKQUOTE_BLOCK_RE, "");
  }

  // edit: 各行頭の "> " を外し、中身のテキストだけ残す
  return text.replace(BLOCKQUOTE_BLOCK_RE, (block) =>
    block.replace(BLOCKQUOTE_LINE_RE, (_m, rest: string) => rest)
  );
}

// ─────────────────────────────────────────
// block.list
// ─────────────────────────────────────────
export function applyListRule(text: string, rule?: EditableRule): string {
  if (!rule || rule.action === "keep") return text;

  if (rule.action === "remove") {
    return text
      .replace(LIST_UNORDERED_LINE_RE, "")
      .replace(LIST_ORDERED_LINE_RE, "");
  }

  // edit: マーカー（"- " "1. " 等）を含む行頭の記法を外し、中身のテキストだけ残す
  // （旧 exporter.ts Step8 と同様、インデント量も含めて除去する）
  return text
    .replace(
      LIST_UNORDERED_LINE_RE,
      (_m, _indent: string, _marker: string, _sp: string, content: string) => content
    )
    .replace(
      LIST_ORDERED_LINE_RE,
      (_m, _indent: string, _marker: string, _sp: string, content: string) => content
    );
}

// ─────────────────────────────────────────
// inline.emphasis
// ─────────────────────────────────────────
export function applyEmphasisRule(text: string, rule?: EditableRule): string {
  if (!rule || rule.action === "keep") return text;

  if (rule.action === "remove") {
    return text.replace(EMPHASIS_RE, "");
  }

  // edit: 強調記号だけ外し、中身のテキストを残す
  return text.replace(EMPHASIS_RE, (_m, _mark: string, content: string) => content);
}

// ─────────────────────────────────────────
// block.horizontalRule
// ─────────────────────────────────────────
export function applyHorizontalRuleRule(text: string, rule?: SimpleRule): string {
  if (!rule || rule.action === "keep") return text;
  return text.replace(HORIZONTAL_RULE_RE, "");
}

// ─────────────────────────────────────────
// inline.image（Markdown画像記法）
//
// 行全体が画像のみの行か、本文中に混在しているかは区別せず、
// 出現位置にかかわらず一律で処理する（2026-08: block/inlineの区別を廃止）。
// ─────────────────────────────────────────
export function applyImageRule(text: string, rule?: SimpleRule): string {
  if (!rule || rule.action === "keep") return text;
  return text.replace(IMAGE_RE, "");
}

// ─────────────────────────────────────────
// inline.markdownLink
//
// 画像記法 ![alt](url) の [alt](url) 部分を誤って通常リンクとして
// 変換しないよう、直前の "!" の有無を同一マッチ内で判定する
// （lookbehind不使用。iOS 16.4未満対応のため）。
// ─────────────────────────────────────────
export function applyMarkdownLinkRule(text: string, rule?: EditableRule): string {
  if (!rule) return text;

  return text.replace(
    MARKDOWN_LINK_OR_IMAGE_RE,
    (whole: string, bang: string | undefined, display: string, _url: string) => {
      if (bang) return whole; // 画像記法はここでは扱わない
      if (rule.action === "keep") return whole;
      if (rule.action === "remove") return "";
      return display; // edit: URLを外し表示テキストだけ残す
    }
  );
}

// ─────────────────────────────────────────
// inline.wikilink
// ─────────────────────────────────────────
export function applyWikilinkRule(text: string, rule?: WikilinkRule): string {
  if (!rule || rule.action === "keep") return text;

  if (rule.action === "remove") {
    return text.replace(WIKILINK_PIPE_RE, "").replace(WIKILINK_PLAIN_RE, "");
  }

  // edit
  const editMode = rule.editMode ?? "displayText";
  if (editMode === "fileName") {
    // エイリアスを無視し、常にリンク先ファイル名を残す
    return text
      .replace(WIKILINK_PIPE_RE, (_m, fileName: string) => fileName)
      .replace(WIKILINK_PLAIN_RE, (_m, fileName: string) => fileName);
  }

  // displayText: エイリアスがあればそれを、なければファイル名を残す
  return text
    .replace(WIKILINK_PIPE_RE, (_m, _fileName: string, alias: string) => alias)
    .replace(WIKILINK_PLAIN_RE, (_m, fileName: string) => fileName);
}

// ─────────────────────────────────────────
// inline.tag
//
// タグ判定ロジックそのものは core/hashtags.ts の stripHashtags() に
// 委譲する（Export・小説閲覧ビュー・文字数カウントと判定基準を統一するため）。
// remove時のみ、タグ除去にともなう連続スペース・空白行の後始末も行う
// （元の exporter.ts Step5 と同じ後処理）。
// ─────────────────────────────────────────
export function applyTagRule(text: string, rule?: SimpleRule): string {
  if (!rule || rule.action === "keep") return text;

  text = stripHashtags(text);
  text = text.replace(/[ \t\u3000]{2,}/g, " ");
  text = text.replace(/^[ \t\u3000]+$/gm, "");
  return text;
}

// ─────────────────────────────────────────
// block.html / inline.html（ruby / rt タグは対象外）
//
// 行全体がHTMLタグのみで構成されている場合を block、
// それ以外（本文中に混在）を inline として扱う。
// ─────────────────────────────────────────
export function applyBlockHtmlRule(text: string, rule?: SimpleRule): string {
  if (!rule || rule.action === "keep") return text;
  return text.replace(BLOCK_HTML_LINE_RE, "");
}

export function applyInlineHtmlRule(text: string, rule?: SimpleRule): string {
  if (!rule || rule.action === "keep") return text;
  return text.replace(HTML_TAG_RE, "");
}

// ─────────────────────────────────────────
// inline.ruby
//
// mode: "none" はKEEP相当（変換しない）。それ以外は
// utils/rubyConvert.ts の convertRubyStyle() に委譲する。
// ─────────────────────────────────────────
export function applyRubyRule(text: string, rule: RubyRule | undefined, sourceRubyStyle: RubyStyle): string {
  if (!rule || rule.mode === "none") return text;
  return convertRubyStyle(text, sourceRubyStyle, rule.mode);
}
