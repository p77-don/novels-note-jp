// ─────────────────────────────────────────
// manuscript-rules — 一時保護（プレースホルダー置換）
//
// コードブロックなど「以後の変換処理から中身を守りたい」要素を、
// 一意なプレースホルダートークンに置き換えて後続処理から隠し、
// パイプラインの最後に元のテキストへ復元するためのユーティリティ。
//
// U+0000（NUL文字）は通常の小説本文には出現しないため、
// 衝突リスクの低いプレースホルダー境界として利用する。
// ─────────────────────────────────────────

export interface ProtectionSession {
  /** 保護済みトークンを埋め込んだテキスト */
  text: string;
  /** パイプラインの最後に呼び出し、プレースホルダーを元のテキストへ戻す */
  restore: (text: string) => string;
}

/**
 * regex にマッチした範囲を順番に抜き出し、prefix で名前空間を切った
 * プレースホルダートークンに置換する。
 *
 * @param source 対象テキスト
 * @param regex  保護したい範囲を検出する正規表現（global フラグ必須）
 * @param prefix プレースホルダーの名前空間（他の保護処理と衝突しないよう要素ごとに固有の文字列を渡す）
 * @param replacer マッチ結果から「保護対象として埋め込む文字列」を作る関数（省略時はマッチ全体をそのまま使う）
 */
export function protectMatches(
  source: string,
  regex: RegExp,
  prefix: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  replacer?: (match: string, ...groups: any[]) => string
): ProtectionSession {
  const preserved: string[] = [];
  const text = source.replace(regex, (...args: unknown[]) => {
    const match = args[0] as string;
    const content = replacer ? replacer(...(args as [string, ...unknown[]])) : match;
    const token = `\u0000MRP:${prefix}:${preserved.length}\u0000`;
    preserved.push(content);
    return token;
  });

  const tokenRe = new RegExp(`\\u0000MRP:${prefix}:(\\d+)\\u0000`, "g");
  return {
    text,
    restore: (t: string) =>
      t.replace(tokenRe, (_m, i: string) => preserved[Number(i)] ?? ""),
  };
}
