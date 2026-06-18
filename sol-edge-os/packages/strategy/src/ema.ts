/**
 * Exponential moving average. Same length as input; entries before the
 * series has enough data to seed are NaN. Seed = SMA of the first `period`
 * values; thereafter EMA_t = value_t * k + EMA_{t-1} * (1 - k), k = 2/(period+1).
 */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;

  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;
  out[period - 1] = seed;

  let prev = seed;
  for (let i = period; i < values.length; i++) {
    const next = values[i] * k + prev * (1 - k);
    out[i] = next;
    prev = next;
  }
  return out;
}
