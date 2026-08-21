// ─────────────────────────────────────────
// Novels Note JP — 文字数カウント
//
// 【2026-08 一本化】
// かつては本ファイル独自の cleanNovelText() で原稿をクリーニングして
// いたが、Export と判定基準が食い違う（≒メンテナンス時にズレが生じる）
// リスクがあったため廃止した。現在は Export と同じ
// manuscript-rules エンジン（cleanManuscript）を使い、常に
// 「オプション設定で指定されている原稿クリーニング定義（登録済み定義ファイル、
// または未登録時は組み込みのデフォルト定義）」で処理した後のテキストを
// カウント対象にする。
// ─────────────────────────────────────────

import { NovelsNoteSettings } from "../settings";
import { parseBrackets } from "../editor/bracketParser";
import { findRubyMatches } from "./rubyPatterns";
import type { ManuscriptRules } from "../manuscript-rules/types/rules";
import { cleanManuscript } from "../manuscript-rules/cleaner/manuscriptCleaner";

// ─────────────────────────────────────────
// カウント結果
// ─────────────────────────────────────────
export interface CountResult {
  raw: number;           // 純粋な文字数
  novel: number;         // 小説換算（全角1・半角0.5）
  pageEquivalent: number; // ページ換算（設定した1ページあたりの文字数で割った枚数・小数1桁）
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

// ─────────────────────────────────────────
// カウント用の最終整形（空白・改行の扱い）
//
// manuscript-rules による原稿クリーニング定義の適用（Frontmatter・タグ・
// Wikilink・見出し記号などの除去/変換）が済んだテキストに対して、
// 「文字数として数えるかどうか」の最後の調整だけをここで行う。
//
// 全角スペースの扱いだけは設定で切り替えられるようにしている
// （原稿クリーニング定義には「全角スペースをカウントに含めるか」という
// 概念がないため）。半角スペース・タブ・改行は、原稿の版面制御用の
// 記号であり文字数そのものではないため、常に除外する。
// ─────────────────────────────────────────
function finalizeCountText(cleaned: string, settings: NovelsNoteSettings): string {
  // 全角スペースを除外する場合
  if (!settings.countFullWidthSpace) {
    cleaned = cleaned.replace(/\u3000/g, "");
  }

  // 半角スペース・タブは常に除外（原稿本文として不要）
  cleaned = cleaned.replace(/[ \t]/g, "");

  // 改行は文字数に含めない
  cleaned = cleaned.replace(/\n/g, "");

  return cleaned;
}

// ─────────────────────────────────────────
// ルビ記法を「親文字＋（トグルONなら）読み仮名」の平文へ還元する
//
// 文字数カウントにおけるルビの扱いは、Export用に選択している定義
// ファイルの ruby.mode（none/remove/narou/aozora/…）とは独立させる。
// カウントは常に「親文字のみを基準」とし、トグル設定がオンの場合のみ
// 読み仮名も文字数に含める。これにより、Export時の出力フォーマット
// 選択が文字数カウントの結果に影響しないようにしている。
//
// ページ換算では「どの行にどれだけ文字があるか」（改行位置）が
// そのまま結果に影響するため、ここでは改行を保持したまま処理する
// （raw/novel用に改行を落とすのは呼び出し側で行う）。
// ─────────────────────────────────────────
function buildCountableText(
  text: string,
  settings: NovelsNoteSettings,
  rules: ManuscriptRules
): string {
  if (!settings.countRubyText) {
    // 親文字のみ：ruby.mode を強制的に "remove" として扱う
    const baseRules: ManuscriptRules = {
      ...rules,
      inline: { ...rules.inline, ruby: { mode: "remove" } },
    };
    return cleanManuscript(text, baseRules, settings.rubyStyle);
  }

  // 親文字＋読み仮名：記法を変換しない（ruby.mode: "none"）テキストを
  // 作り、findRubyMatches() で実際に残っているルビペアを抽出して、
  // 記法記号（｜《》等）を除いた「親文字＋読み仮名」に置き換える
  // （frontmatter・コメント等に含まれていた「ルビらしき記法」を
  // 誤って拾わないよう、他ルール適用後のテキストに対して検出する）。
  const notationRules: ManuscriptRules = {
    ...rules,
    inline: { ...rules.inline, ruby: { mode: "none" } },
  };
  const withRubyNotation = cleanManuscript(text, notationRules, settings.rubyStyle);
  const matches = findRubyMatches(withRubyNotation, settings.rubyStyle);

  let rebuilt = "";
  let cursor = 0;
  for (const m of matches) {
    rebuilt += withRubyNotation.slice(cursor, m.from);
    rebuilt += m.base + m.ruby;
    cursor = m.to;
  }
  rebuilt += withRubyNotation.slice(cursor);
  return rebuilt;
}

/** 1行分のテキストから、カウント対象外の空白を除去する（改行はここでは扱わない）。 */
function finalizeLine(line: string, settings: NovelsNoteSettings): string {
  let l = line;
  if (!settings.countFullWidthSpace) {
    l = l.replace(/\u3000/g, "");
  }
  l = l.replace(/[ \t]/g, "");
  return l;
}

/**
 * テキストから文字数を集計する。
 * @param text     エディタの生テキスト
 * @param settings プラグイン設定（全角スペース・ルビ文字カウント制御・ページ換算の設定）
 * @param rules    カウントに使う原稿クリーニング定義（登録済み定義ファイル、または組み込みのデフォルト）
 */
export function countCharacters(
  text: string,
  settings: NovelsNoteSettings,
  rules: ManuscriptRules
): CountResult {
  // 改行を保持したまま整形する（ページ換算で行構造が必要なため）
  const countable = buildCountableText(text, settings, rules);

  // split("\n") は文字列が改行で終わっている場合、末尾に余分な空文字列
  // （ファイル終端の記号であり、実際の空行ではない）を1つ生成してしまう
  // （例："a\nb\n".split("\n") === ["a","b",""]）。
  // document.trailingWhitespace が normalize されている定義では
  // 常に末尾に改行が1つ付与されるため、この末尾要素をそのまま
  // 「余分な空行」として数えてしまうと、段落数が多いほどページ数が
  // 過大に算出されてしまう。末尾が改行で終わっている場合のみ、
  // split結果の最後の要素（必ず空文字列になる）を1つ取り除く。
  const rawLines = countable.split("\n");
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }
  const finalizedLines = rawLines.map(line => finalizeLine(line, settings));

  // raw / novel：全行を連結した、従来通りのフラットな文字数集計
  const flat = finalizedLines.join("");
  // スプレッド構文でコードポイント単位に分解（絵文字・拡張漢字などの
  // サロゲートペアを UTF-16 コードユニット 2 個と誤計上しないため）
  const raw = [...flat].length;

  let novel = 0;
  for (const ch of flat) {
    novel += charWidth(ch);
  }
  // 小数点以下1桁で丸める（例：123.5）
  novel = Math.round(novel * 10) / 10;

  // ─────────────────────────────────────────
  // ページ換算：総文字数を1ページの文字数で単純に割るのではなく、
  // 段落（改行で区切られた行）ごとに実際に必要な行数を積み上げてから
  // ページ数を算出する。
  //
  // 例：1行20文字・1ページ20行（400字詰め）の設定で、1段落が30文字の
  // 場合、単純な「総文字数 ÷ 400」では計算に含まれない「行末の余白
  // （20文字分の空白）」が、段落数が多いほど無視できない誤差になる。
  // 実際の原稿用紙・小説投稿サイトのページ表示と同様に、各段落は
  // 必ず新しい行から始まり、1行に収まらない分は次の行へ折り返す、
  // という組版の考え方に合わせて行数を計算する。
  // ─────────────────────────────────────────
  const charsPerLine = Math.max(1, settings.wrapColumn);
  const linesPerPage = Math.max(1, settings.pageLinesPerPage);

  let totalLines = 0;
  if (raw > 0) {
    for (const line of finalizedLines) {
      const lineLength = [...line].length;
      // 空行（段落間の区切り）も1行分の版面を占めるため、最低1行として数える
      totalLines += Math.max(1, Math.ceil(lineLength / charsPerLine));
    }
  }
  const pageEquivalent = Math.round((totalLines / linesPerPage) * 10) / 10;

  return { raw, novel, pageEquivalent };
}

// ─────────────────────────────────────────
// 地の文／会話文カウント結果
// ─────────────────────────────────────────
export interface NarrativeDialogueCount {
  narrativeChars: number; // 地の文の文字数
  dialogueChars: number;  // 会話文の文字数
}

// ─────────────────────────────────────────
// カッコ範囲のマージ（重複・入れ子区間の統合）
//
// parseBrackets() は有効なカッコ種別ごとにネスト対応で範囲を返すため、
// 同一カッコの入れ子（「…「…」…」）や、異なるカッコ種別同士が
// 重なるケース（「…（…）…」）では区間が重複する。
// 会話文の文字数を二重カウントしないよう、重複・隣接する区間を
// 1本の連続区間にマージしてから合計する。
// ─────────────────────────────────────────
function mergeRanges(
  ranges: { start: number; end: number }[]
): { start: number; end: number }[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * テキストから地の文／会話文の文字数を集計する。
 *
 * 「会話文」は settings.bracketDefinitions で enabled: true になっている
 * すべてのカッコ種別（鍵カッコ「」・二重鍵カッコ『』など）の内側を対象とする。
 * 「地の文」はそれ以外（カウント対象の本文からカッコ内を除いた残り）。
 *
 * countCharacters() と同じく、ルビは常に「親文字のみ」を基準にカウントする
 * （Export用の ruby.mode 設定とは独立）。
 *
 * 【制限事項】「ルビ文字もカウントする」設定（countRubyText）は、
 * 地の文／会話文どちらに計上すべきかの判定が複雑になるため、本関数では
 * 未対応（常に親文字のみで集計する）。そのため countRubyText が
 * オンの場合、narrativeChars + dialogueChars は countCharacters().raw
 * より小さくなる（読み仮名の分だけ差が生じる）。
 *
 * @param text     エディタの生テキスト
 * @param settings プラグイン設定
 * @param rules    カウントに使う原稿クリーニング定義
 */
export function countNarrativeAndDialogue(
  text: string,
  settings: NovelsNoteSettings,
  rules: ManuscriptRules
): NarrativeDialogueCount {
  const baseRules: ManuscriptRules = {
    ...rules,
    inline: { ...rules.inline, ruby: { mode: "remove" } },
  };
  const cleaned = finalizeCountText(cleanManuscript(text, baseRules, settings.rubyStyle), settings);
  const totalChars = [...cleaned].length;

  const enabledBrackets = settings.bracketDefinitions.filter(bd => bd.enabled);
  const matches = parseBrackets(cleaned, enabledBrackets);
  const merged = mergeRanges(matches.map(m => ({ start: m.start, end: m.end })));

  // 各区間はコードポイント境界（カッコ自体はBMP内の1文字）で
  // 区切られているため、slice() で安全に取り出せる。
  // サロゲートペアを含む文字を UTF-16 コードユニット単位で
  // 誤計上しないよう、スプレッド構文でコードポイント単位に分解する。
  let dialogueChars = 0;
  for (const range of merged) {
    dialogueChars += [...cleaned.slice(range.start, range.end)].length;
  }

  const narrativeChars = totalChars - dialogueChars;

  return { narrativeChars, dialogueChars };
}

// ─────────────────────────────────────────
// ステータスバー表示用のフォーマット
// ─────────────────────────────────────────
export function formatCount(result: CountResult, mode: CountMode, settings: NovelsNoteSettings): string {
  switch (mode) {
    case "raw":
      return `${result.raw.toLocaleString()} 字`;
    case "novel":
      return `${result.novel.toLocaleString()} 字（小説換算）`;
    case "page": {
      const charsPerPage = Math.max(1, settings.wrapColumn) * Math.max(1, settings.pageLinesPerPage);
      return `${result.pageEquivalent.toLocaleString()} 枚（${charsPerPage}文字詰め）`;
    }
  }
}

export type CountMode = "raw" | "novel" | "page";
