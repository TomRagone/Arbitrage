/**
 * Rolling max/min over a trailing window of `period` values ending at the
 * current index (inclusive). Same length as input; entries before the
 * window is full are NaN. Callers needing "prior N, excluding current"
 * (e.g. breakout levels, volume averages) read index i-1 of this output.
 */
export function rollingHigh(values: number[], period: number): number[] {
  return rollingExtreme(values, period, (a, b) => Math.max(a, b), -Infinity);
}

export function rollingLow(values: number[], period: number): number[] {
  return rollingExtreme(values, period, (a, b) => Math.min(a, b), Infinity);
}

function rollingExtreme(values: number[], period: number, pick: (a: number, b: number) => number, identity: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let extreme = identity;
    for (let j = i - period + 1; j <= i; j++) extreme = pick(extreme, values[j]);
    out[i] = extreme;
  }
  return out;
}
