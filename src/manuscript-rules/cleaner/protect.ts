// ─────────────────────────────────────────
// manuscript-rules — 一時保護（プレースホルダー置換）
//
// コードブロックなど「以後の変換処理から中身を守りたい」要素を、
// 一意なプレースホルダートークンに置き換えて後続処理から隠し、
// パイプラインの最後に元のテキストへ復元するためのユーティリティ。
//
// U+0000（NUL文字）は通常の小説本文には出現しないため、
// 衝突リスクの低いプレースホルダー境界として利用するが、
// 同じ形式のトークンが（意図的にせよ偶然にせよ）原稿本文に
// 存在する可能性はゼロではない。そのため、呼び出しごとに
// ランダムなnonceを発行し、元テキストに同じnonceを含む
// トークン文字列が存在しないことを確認してから使用する。
// ─────────────────────────────────────────

export interface ProtectionSession {
  /** 保護済みトークンを埋め込んだテキスト */
  text: string;
  /** パイプラインの最後に呼び出し、プレースホルダーを元のテキストへ戻す */
  restore: (text: string) => string;
}

/** 8桁の英数字ランダム文字列を生成する（衝突検査用のnonce）。 */
function generateNonce(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

/**
 * source 中に、nonce を含むプレースホルダートークンの接頭辞
 * （\u0000MRP:<prefix>:<nonce>:）が既に存在しないかを調べる。
 * 存在しなければそのnonceは安全に使用できる。
 */
function isNonceSafe(source: string, prefix: string, nonce: string): boolean {
  return !source.includes(`\u0000MRP:${prefix}:${nonce}:`);
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
  replacer?: (match: string, ...groups: unknown[]) => string
): ProtectionSession {
  // 衝突しないnonceが見つかるまで再生成する（現実的にはほぼ1回で確定する）。
  let nonce = generateNonce();
  let attempts = 0;
  while (!isNonceSafe(source, prefix, nonce) && attempts < 20) {
    nonce = generateNonce();
    attempts += 1;
  }

  const preserved: string[] = [];
  const text = source.replace(regex, (...args: unknown[]) => {
    const match = args[0] as string;
    const content = replacer ? replacer(...(args as [string, ...unknown[]])) : match;
    const token = `\u0000MRP:${prefix}:${nonce}:${preserved.length}\u0000`;
    preserved.push(content);
    return token;
  });

  const tokenRe = new RegExp(`\\u0000MRP:${prefix}:${nonce}:(\\d+)\\u0000`, "g");
  return {
    text,
    restore: (t: string) =>
      t.replace(tokenRe, (_m, i: string) => {
        const idx = Number(i);
        // インデックス範囲外（＝本来復元すべきでないトークン）の場合、
        // 黙って空文字にすると本文が消失してしまう。安全側に倒し、
        // マッチした文字列をそのまま残す（内容が失われない）。
        if (idx < 0 || idx >= preserved.length) {
          return _m;
        }
        return preserved[idx];
      }),
  };
}
