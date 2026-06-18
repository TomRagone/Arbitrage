export type Bias = "LONG" | "SHORT" | "NONE";

/// Trend bias: LONG if close is above the EMA, SHORT if below, NONE if
/// equal or the EMA isn't defined yet (insufficient history).
export function trendBias(close: number, emaValue: number): Bias {
  if (Number.isNaN(emaValue)) return "NONE";
  if (close > emaValue) return "LONG";
  if (close < emaValue) return "SHORT";
  return "NONE";
}
