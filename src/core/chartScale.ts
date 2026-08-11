// ─────────────────────────────────────────
// Novels Note JP — グラフ目盛り軸の計算（nice numbers）
//
// 「執筆情報一覧」のグラフ表示（積み上げ棒グラフ）で使用する、
// 見やすいキリのよい目盛り間隔（1・2・5 × 10^n）を算出する。
// 外部チャートライブラリを使わず、算出結果はCSSのパーセンテージ幅
// （setCssProps()経由）としてバーの長さに反映される。
// ─────────────────────────────────────────

export interface NiceScale {
  /** 目盛り軸の最大値（キリのよい数値に切り上げ済み） */
  max: number;
  /** 目盛りの間隔 */
  step: number;
  /** 0 から max までの目盛り値の配列 */
  ticks: number[];
}

/**
 * データの最大値から、見やすい目盛り軸（0を含む）を算出する。
 * @param maxValue 表示対象データの最大値
 * @param targetTickCount 目安とする目盛りの本数（0を除く）
 */
export function computeNiceScale(maxValue: number, targetTickCount = 5): NiceScale {
  if (!isFinite(maxValue) || maxValue <= 0) {
    return { max: 0, step: 0, ticks: [0] };
  }

  const rawStep = maxValue / targetTickCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;

  let niceResidual: number;
  if (residual > 5) niceResidual = 10;
  else if (residual > 2) niceResidual = 5;
  else if (residual > 1) niceResidual = 2;
  else niceResidual = 1;

  const step = niceResidual * magnitude;
  const niceMax = Math.ceil(maxValue / step) * step;

  const ticks: number[] = [];
  // 浮動小数点誤差でステップが1本欠ける／余分に出るのを避けるための微小補正
  for (let v = 0; v <= niceMax + step * 1e-6; v += step) {
    ticks.push(Math.round(v));
  }

  return { max: niceMax, step, ticks };
}
