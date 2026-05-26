// ─────────────────────────────────────────
// Novels Note JP — 原稿 Export パイプライン
//
// 本文ファイルは一切変更しない（Read Only Export）。
// ─────────────────────────────────────────

import { RubyStyle } from "./settings";

// ─────────────────────────────────────────
// Export 設定
// ─────────────────────────────────────────
export type ExportFormat = "txt" | "md";

/**
 * ルビ変換モード
 * "none"   : 変換しない（記法をそのまま維持）
 * "remove" : ルビ記号をすべて除去し親文字のみ残す
 * その他   : 指定の方式に変換
 */
export type RubyConvertMode = "none" | RubyStyle | "remove";

export interface ExportOptions {
  format:           ExportFormat;    // 出力形式
  removeBlankLines: boolean;         // 連続空行を1行に圧縮するか
  rubyConvert:      RubyConvertMode; // ルビ変換モード
  sourceRubyStyle:  RubyStyle;       // 入力のルビ方式（設定から渡す）
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format:           "txt",
  removeBlankLines: true,
  rubyConvert:      "none",
  sourceRubyStyle:  "narou",
};

// ─────────────────────────────────────────
// ルビ変換（1パス方式）
//
// 【設計方針】
// 旧実装では「縦棒あり/なし」を2つの正規表現で別々に収集し、
// 収集後に split().join() で置換していた。
// この方式には：
//   ①同一箇所に2パターンがマッチして重複置換が起きる
//   ②置換後テキストへ別のルビが誤マッチする
//   ③sourceStyle=undefined のとき何も変換されない
// という問題があった。
//
// 修正後は方式ごとに1つの正規表現で全パターンを網羅し、
// String.replace() コールバックでその場で変換する（1パス）。
// ─────────────────────────────────────────

/** ルビペアを指定の方式に文字列化する */
function rubyPairToStyle(base: string, ruby: string, target: RubyConvertMode): string {
  switch (target) {
    case "none":    return base + "《" + ruby + "》"; // 呼ばれないはず
    case "remove":  return base;
    case "narou":   return "|" + base + "《" + ruby + "》";
    case "aozora":  return "｜" + base + "《" + ruby + "》";
    case "denden":  return "{" + base + "|" + ruby + "}";
    case "html":    return "<ruby>" + base + "<rt>" + ruby + "</rt></ruby>";
  }
}

/**
 * テキスト内のルビ記法を変換する。
 * sourceStyle の記法を検出し、target の方式に変換して返す。
 *
 * narou / aozora は半角縦棒（|）・全角縦棒（｜）の両方を検出する。
 */
export function convertRubyStyle(
  text: string,
  sourceStyle: RubyStyle,
  target: RubyConvertMode
): string {
  if (target === "none") return text;

  const CJK = "\u3005\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF";

  switch (sourceStyle) {
    case "narou":
    case "aozora": {
      // 半角縦棒（|）・全角縦棒（｜）どちらでも検出。
      // パターン1：[|｜]base《ruby》
      // パターン2：CJK漢字《ruby》（縦棒なし）
      // 1つの正規表現で左から1パスで処理する。
      const re = new RegExp(
        "[|｜]([^\u300A\\n]+)\u300A([^\u300B\\n]*)\u300B" +
        "|([" + CJK + "]+)\u300A([^\u300B\\n]*)\u300B",
        "g"
      );
      return text.replace(re, (_m: string, b1: string, r1: string, b2: string, r2: string) => {
        const base = b1 !== undefined ? b1 : b2;
        const ruby = r1 !== undefined ? r1 : r2;
        return rubyPairToStyle(base, ruby, target);
      });
    }

    case "denden": {
      const re = /\{([^|\n]+)\|([^}\n]+)\}/g;
      return text.replace(re, (_m: string, base: string, ruby: string) =>
        rubyPairToStyle(base, ruby, target)
      );
    }

    case "html": {
      const re = /<ruby>([^<]+)<rt>([^<]*)<\/rt><\/ruby>/g;
      return text.replace(re, (_m: string, base: string, ruby: string) =>
        rubyPairToStyle(base, ruby, target)
      );
    }

    default:
      return text;
  }
}

// ─────────────────────────────────────────
// メイン変換関数
// ─────────────────────────────────────────
/**
 * 原稿テキストを Export 用にクリーニングして返す。
 * 元テキストは変更しない（破壊的操作なし）。
 */
export function exportText(source: string, opts: ExportOptions): string {
  let text = source;

  // ── Step 1: Frontmatter 削除 ──────────────────
  text = text.replace(/^---[\s\S]*?^---[ \t]*\n?/m, "");

  // ── Step 2: Obsidian コメント削除 ──────────────
  text = text.replace(/%%[\s\S]*?%%/g, "");

  // ── Step 3: Callout ブロック削除 ───────────────
  text = text.replace(/^(>[ \t]*\[![\w-]+\][^\n]*\n(?:>[ \t]*[^\n]*\n?)*)/gm, "");

  // ── Step 4: Wikilink を表示テキストに変換 ──────
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // ── Step 5: タグ削除 ────────────────────────────
  //
  // タグの書き方：本文中に半角スペースで前後を囲んで記入する。
  //   例）「この文章 #確認 は後で見直す」
  //       「#メモ この行は仮」
  //
  // ① 行全体がタグだけの行 → 行ごと削除（空行にする）
  text = text.replace(/^[ \t\u3000]*#[^\s#][^\n]*$/gm, "");
  //
  // ② 行中・行末のタグ：
  //    「タグの前のスペース1つ」＋「タグ本体」＋「タグの後のスペース0〜1つ」を一括削除。
  //    こうすることでタグを削除した後にスペースが残らない。
  //    タグ終端 = スペース / 全角スペース / 句読点 / 括弧 / 行末
  text = text.replace(
    / #[^\s\u3000\u3001\u3002\uff01\uff1f!?「」『』（）()\n]+ ?/g,
    " "
  );
  //
  // ③ 行頭のタグ（行頭に直接 # が来る場合）
  text = text.replace(/^#[^\s\u3000\u3001\u3002\uff01\uff1f!?「」『』（）()\n]+ ?/gm, "");
  //
  // ④ 残留する連続スペースを1つに正規化（タグ除去の副作用対策）
  text = text.replace(/  +/g, " ");

  // ── Step 6: Markdown 見出し記号除去 ────────────
  text = text.replace(/^#{1,6}[ \t]+/gm, "");

  // ── Step 7: Markdown 引用記号除去 ──────────────
  text = text.replace(/^>[ \t]?/gm, "");

  // ── Step 8: Markdown リスト記号除去 ────────────
  text = text.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  text = text.replace(/^[ \t]*\d+\.[ \t]+/gm, "");

  // ── Step 9: Markdown 強調記号除去 ──────────────
  text = text.replace(/(\*{1,3}|_{1,3})([\s\S]*?)\1/g, "$2");

  // ── Step 10: Markdown 水平線除去 ───────────────
  text = text.replace(/^[-*_]{3,}[ \t]*$/gm, "");

  // ── Step 11: Markdown コードブロック除去 ────────
  text = text.replace(/^```[\s\S]*?^```[ \t]*$/gm, "");
  text = text.replace(/^~~~[\s\S]*?^~~~[ \t]*$/gm, "");
  text = text.replace(/`([^`]+)`/g, "$1");

  // ── Step 12: Markdown リンク変換 ───────────────
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // ── Step 13: HTML タグ除去（ruby・rt は除外） ───
  text = text.replace(/<(?!\/?(ruby|rt)\b)[^>]+>/gi, "");

  // ── Step 14: ルビ変換 ───────────────────────────
  // sourceRubyStyle の記法を rubyConvert の方式に変換する。
  // "none" の場合は何もしない（元の記法をそのまま維持）。
  if (opts.rubyConvert !== "none") {
    text = convertRubyStyle(text, opts.sourceRubyStyle, opts.rubyConvert);
  }

  // ── Step 15: 連続空行の圧縮 ────────────────────
  if (opts.removeBlankLines) {
    text = text.replace(/\n{3,}/g, "\n\n");
  }

  // ── Step 16: 末尾の余分な空白行を除去 ───────────
  text = text.replace(/[\s\n]+$/, "") + "\n";

  return text;
}

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
