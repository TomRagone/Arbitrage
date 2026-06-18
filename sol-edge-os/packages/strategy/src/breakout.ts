import { rollingHigh, rollingLow } from "./rolling";

/**
 * True at index i when closes[i] breaks above the highest high of the
 * `period` completed candles immediately before i (rollingHigh(highs,
 * period)[i-1]). False where there isn't enough prior history.
 */
export function breakoutHigh(closes: number[], highs: number[], period = 20): boolean[] {
  const levels = rollingHigh(highs, period);
  return closes.map((close, i) => (i >= 1 && !Number.isNaN(levels[i - 1]) ? close > levels[i - 1] : false));
}

/**
 * True at index i when closes[i] breaks below the lowest low of the
 * `period` completed candles immediately before i (rollingLow(lows,
 * period)[i-1]). False where there isn't enough prior history.
 */
export function breakoutLow(closes: number[], lows: number[], period = 20): boolean[] {
  const levels = rollingLow(lows, period);
  return closes.map((close, i) => (i >= 1 && !Number.isNaN(levels[i - 1]) ? close < levels[i - 1] : false));
}

/// True when series[i] is true and series[i-1] was not — i.e. the first
/// candle in a run to satisfy the condition (the locked anti-chase rule:
/// signal only on the first breakout candle, not a continuation).
export function isFirstOccurrence(series: boolean[], index: number): boolean {
  if (!series[index]) return false;
  if (index === 0) return true;
  return !series[index - 1];
}
