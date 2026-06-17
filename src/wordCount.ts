// ─────────────────────────────────────────
// Novels Note JP — 文字数カウント
// ─────────────────────────────────────────

import { NovelsNoteSettings } from "./settings";

// ─────────────────────────────────────────
// カウント結果
// ─────────────────────────────────────────
export interface CountResult {
  raw: number;        // 純粋な文字数
  novel: number;      // 小説換算（全角1・半角0.5）
  manuscript: number; // 原稿用紙換算（400字詰め・小数1桁）
}

// ─────────────────────────────────────────
// 本文クリーニング
//
// 以下を除去し、原稿本文のみを残す。
//
// 1. Frontmatter（---〜---）
// 2. Obsidian コメント（%%〜%%）
// 3. Wikilink：[[表示名]] → 表示名、[[path|alias]] → alias
// 4. Markdown 見出し記号（行頭の # 群）
// 5. Markdown 強調記号（** __ * _ ）
// 6. Markdown コードブロック・インラインコード（```〜``` `〜`）
// 7. Markdown 引用記号（行頭の >）
// 8. Markdown リスト記号（行頭の - * + と数字リスト）
// 9. HTML タグ（<tag>）
// 10. aozora ルビ：[|｜]親《ルビ》→ 親（半角バー・全角バーの両方に対応、々を含む語にも対応）
// 11. denden ルビ：{親|ルビ} → 親
// 12. HTML ruby タグ：<ruby>親<rt>ルビ</rt></ruby> → 親
// ─────────────────────────────────────────
export function cleanNovelText(raw: string): string {
  let text = raw;

  // 1. Frontmatter（ファイル先頭の ---〜--- ブロック）
  text = text.replace(/^---[\s\S]*?^---\s*\n?/m, "");

  // 2. Obsidian コメント %%〜%%（複数行対応）
  text = text.replace(/%%[\s\S]*?%%/g, "");

  // 3. HTML ruby タグ（<rt>ルビ</rt> を先に除去、<ruby>/<\/ruby> も除去）
  text = text.replace(/<rt[^>]*>[\s\S]*?<\/rt>/gi, "");
  text = text.replace(/<\/?ruby[^>]*>/gi, "");

  // 4. その他 HTML タグ
  text = text.replace(/<[^>]+>/g, "");

  // 5. Markdown コードブロック（```〜```、~~~〜~~~）中身ごと除去
  text = text.replace(/^```[\s\S]*?^```\s*$/gm, "");
  text = text.replace(/^~~~[\s\S]*?^~~~\s*$/gm, "");

  // 6. インラインコード（`〜`）
  text = text.replace(/`[^`]*`/g, "");

  // 7. Wikilink：[[path|alias]] → alias、[[name]] → name
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // 8. Markdown 見出し記号（行頭の # 群 + 空白）
  text = text.replace(/^#{1,6}\s+/gm, "");

  // 9. Markdown 引用（行頭の > ）
  text = text.replace(/^>\s?/gm, "");

  // 10. Markdown リスト記号（行頭の - * + 、または 数字. ）
  text = text.replace(/^[ \t]*[-*+]\s+/gm, "");
  text = text.replace(/^[ \t]*\d+\.\s+/gm, "");

  // 11. Markdown 強調（*** ** __ * _ の組み合わせ）
  //     記号だけ除去し、内側のテキストは保持する
  text = text.replace(/(\*{1,3}|_{1,3})([\s\S]*?)\1/g, "$2");

  // 12. aozora ルビ：[|｜]親文字《ルビ》→ 親文字（半角バー・全角バーの両方に対応）
  text = text.replace(/[|｜]([^《\n]+)《[^》]*》/g, "$1");
  // バーなし aozora：漢字直後《ルビ》→ 漢字（CJK統合漢字ブロック＋々を対象）
  text = text.replace(/([\u3005\u4E00-\u9FFF\u3400-\u4DBF]+)《[^》]*》/g, "$1");

  // 13. denden ルビ：{親文字|ルビ} → 親文字
  text = text.replace(/\{([^|]+)\|[^}]+\}/g, "$1");

  // 14. Markdown 水平線（--- *** ___）を除去
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // 15. Markdown 画像 ![alt](url) → 除去（リンク変換より先に処理する）
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, "");

  // 16. Markdown リンク [テキスト](url) → テキスト
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  return text;
}

// ─────────────────────────────────────────
// #tag 除去（文字数カウントから #tag を除外する場合に使用）
//
// 1. タグだけの行はまるごと削除
// 2. 文中の #タグ も削除（直後の空白1つも消費）
// 3. 削除によって生じた連続空白を1つに圧縮
// ─────────────────────────────────────────
function stripHashtags(text: string): string {
  text = text.replace(/^[ \t\u3000]*#\S+[ \t\u3000]*$/gm, "");
  text = text.replace(/#\S+[ \t\u3000]?/g, "");
  text = text.replace(/[ \t\u3000]{2,}/g, " ");
  return text;
}

// ─────────────────────────────────────────
// 文字数カウント本体
// ─────────────────────────────────────────

/**
 * 1文字の幅を返す（novel モード用）
 * 全角：1、半角：0.5
 */
function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  // 半角ASCII・半角カタカナ・半角記号
  if (
    (code >= 0x0020 && code <= 0x007E) || // ASCII 印刷可能文字
    (code >= 0xFF61 && code <= 0xFF9F)    // 半角カタカナ
  ) {
    return 0.5;
  }
  return 1;
}

/**
 * テキストから文字数を集計する。
 * @param text     エディタの生テキスト
 * @param settings プラグイン設定（空白・空行・#tag カウント制御）
 */
export function countCharacters(
  text: string,
  settings: NovelsNoteSettings
): CountResult {
  // クリーニング
  let cleaned = cleanNovelText(text);

  // #tag を文字数に含めない場合（デフォルト）：#tag を除去
  if (!settings.countHashtags) {
    cleaned = stripHashtags(cleaned);
  }

  // 空行を除外する場合：空行（空白のみの行も含む）を除去
  if (!settings.countEmptyLines) {
    cleaned = cleaned.replace(/^[ \t\u3000]*\n/gm, "");
  }

  // 全角スペースを除外する場合
  if (!settings.countFullWidthSpace) {
    cleaned = cleaned.replace(/\u3000/g, "");
  }

  // 半角スペース・タブは常に除外（原稿本文として不要）
  cleaned = cleaned.replace(/[ \t]/g, "");

  // 改行は文字数に含めない
  cleaned = cleaned.replace(/\n/g, "");

  const raw = cleaned.length;

  // novel 換算（全角1・半角0.5）
  let novel = 0;
  for (const ch of cleaned) {
    novel += charWidth(ch);
  }
  // 小数点以下1桁で丸める（例：123.5）
  novel = Math.round(novel * 10) / 10;

  // 原稿用紙換算（400字詰め）
  const manuscript = Math.round((raw / 400) * 10) / 10;

  return { raw, novel, manuscript };
}

// ─────────────────────────────────────────
// ステータスバー表示用のフォーマット
// ─────────────────────────────────────────
export function formatCount(result: CountResult, mode: CountMode): string {
  switch (mode) {
    case "raw":
      return `${result.raw.toLocaleString()} 字`;
    case "novel":
      return `${result.novel.toLocaleString()} 字（小説換算）`;
    case "manuscript":
      return `${result.manuscript.toLocaleString()} 枚（400字詰め）`;
  }
}

export type CountMode = "raw" | "novel" | "manuscript";
