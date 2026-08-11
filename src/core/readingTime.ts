// ─────────────────────────────────────────
// Novels Note JP — 推定読了時間
//
// 小説換算文字数（novel：全角1・半角0.5）と、設定で指定された
// 読了速度（字/分）から、おおよその読了時間を算出する。
//
// あくまで「目安」であり、正確な読了時間を保証するものではないため、
// 表示側では常に「約」を付けて表現する（本モジュールの呼び出し側の責務）。
// ─────────────────────────────────────────

/**
 * 小説換算文字数と読了速度（字/分）から、読了時間（分）を算出する。
 * @param novelChars 小説換算文字数（全角1・半角0.5換算）
 * @param charsPerMinute 読了速度（字/分）。0以下の場合は算出不能として NaN を返す。
 */
export function estimateReadingMinutes(
  novelChars: number,
  charsPerMinute: number
): number {
  if (charsPerMinute <= 0 || novelChars <= 0) return 0;
  return novelChars / charsPerMinute;
}

/**
 * 読了時間（分）を、人間が読みやすい形式の文字列に変換する。
 *
 * - 60分未満          → 「約15分」
 * - 60分〜24時間未満  → 「約2時間15分」
 * - 24時間（1440分）以上 → 「約1日3時間」
 *
 * 文字数が0、または読了速度が未設定（0以下）の場合は "—" を返す。
 */
export function formatReadingTime(minutes: number): string {
  if (!isFinite(minutes) || minutes <= 0) return "—";

  const totalMinutes = Math.round(minutes);

  const MINUTES_PER_HOUR = 60;
  const MINUTES_PER_DAY = 60 * 24;

  if (totalMinutes < MINUTES_PER_HOUR) {
    // 端数切り上げで最低1分は表示する（極端に短い文章向け）
    return `約${Math.max(totalMinutes, 1)}分`;
  }

  if (totalMinutes < MINUTES_PER_DAY) {
    const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
    const remMinutes = totalMinutes % MINUTES_PER_HOUR;
    return remMinutes > 0 ? `約${hours}時間${remMinutes}分` : `約${hours}時間`;
  }

  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const remHours = Math.floor((totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  return remHours > 0 ? `約${days}日${remHours}時間` : `約${days}日`;
}
