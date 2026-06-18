/**
 * Simple moving average. Same length as input; entries before the window
 * is full, or where the window contains a NaN (e.g. composing with another
 * indicator's leading NaNs, like sma(atr(...))), are NaN. Recomputes each
 * window from scratch rather than a running sum, since a running sum gets
 * permanently poisoned by a single NaN and never recovers.
 */
export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let valid = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (Number.isNaN(values[j])) {
        valid = false;
        break;
      }
      sum += values[j];
    }
    out[i] = valid ? sum / period : NaN;
  }
  return out;
}
