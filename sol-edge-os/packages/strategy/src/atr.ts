export interface PriceBar {
  high: number;
  low: number;
  close: number;
}

/// True range per bar. bars[0] has no prior close, so TR[0] = high - low.
function trueRange(bars: PriceBar[]): number[] {
  return bars.map((bar, i) => {
    if (i === 0) return bar.high - bar.low;
    const prevClose = bars[i - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  });
}

/**
 * Average True Range using Wilder's smoothing (the standard ATR definition,
 * distinct from a plain SMA of true range). Same length as input; entries
 * before the series has enough data to seed are NaN.
 * Seed = SMA of the first `period` true-range values; thereafter
 * ATR_t = ATR_{t-1} + (TR_t - ATR_{t-1}) / period.
 */
export function atr(bars: PriceBar[], period = 14): number[] {
  const tr = trueRange(bars);
  const out = new Array<number>(bars.length).fill(NaN);
  if (tr.length < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  seed /= period;
  out[period - 1] = seed;

  let prev = seed;
  for (let i = period; i < tr.length; i++) {
    const next = prev + (tr[i] - prev) / period;
    out[i] = next;
    prev = next;
  }
  return out;
}
