/**
 * Historical data loader, parameterized by entry-timeframe interval (not
 * hardcoded to 15m) so the same loader drives both the locked-15m
 * diagnostics and the timeframe sweep in runDiagnostic.ts. The trend
 * timeframe is derived via trendIntervalFor() per STEP4_STRATEGY_SPEC.md
 * Addendum 1 — it is NOT fixed at 1H. Walks the available entry-tf candles
 * forward, aligning each one against only the trend-tf candles that have
 * actually completed by that point (no look-ahead), and runs the real
 * evaluateSignal at every bar.
 */
import { getOHLC, type Candle } from "@sol-edge/exchanges";
import { ema, trendBias, type Bias } from "@sol-edge/strategy";
import { evaluateSignal, MIN_TREND_CANDLES, MIN_LOWER_TF_CANDLES, PAIR, trendIntervalFor, type Signal } from "./strategyEngine";

export function utcDay(unixSeconds: number): number {
  return Math.floor(unixSeconds / 86400);
}

export interface TimedSignal {
  time: number; // close time of the lower-tf candle the signal fired on
  index: number; // index of that candle within HistoricalSignals.completedLowerTf
  signal: Signal;
}

export interface HistoricalSignals {
  intervalMinutes: number;
  trendIntervalMinutes: number;
  spanHours: number;
  candlesTrendCount: number;
  candlesLowerTfCount: number;
  barsEvaluated: number;
  signals: TimedSignal[];
  completedLowerTf: Candle[];
  completedTrend: Candle[];
}

export async function loadHistoricalSignals(intervalMinutes: number): Promise<HistoricalSignals> {
  const trendIntervalMinutes = trendIntervalFor(intervalMinutes);
  const candlesTrend = await getOHLC(PAIR, trendIntervalMinutes);
  const completedTrend = candlesTrend.slice(0, -1);
  const candlesLower = await getOHLC(PAIR, intervalMinutes);
  const completedLowerTf = candlesLower.slice(0, -1);

  const spanHours = (completedLowerTf[completedLowerTf.length - 1].time - completedLowerTf[0].time) / 3600;
  const lowerTfSeconds = intervalMinutes * 60;
  const trendTfSeconds = trendIntervalMinutes * 60;

  let barsEvaluated = 0;
  const signals: TimedSignal[] = [];
  let trendPointer = 0;

  for (let i = MIN_LOWER_TF_CANDLES - 1; i < completedLowerTf.length; i++) {
    const c = completedLowerTf[i];
    const evalTime = c.time + lowerTfSeconds;

    while (trendPointer < completedTrend.length && completedTrend[trendPointer].time + trendTfSeconds <= evalTime) {
      trendPointer++;
    }
    const visibleTrend = completedTrend.slice(0, trendPointer);
    if (visibleTrend.length < MIN_TREND_CANDLES) continue;

    barsEvaluated++;
    const signal = evaluateSignal(visibleTrend, completedLowerTf.slice(0, i + 1));
    if (signal) signals.push({ time: c.time, index: i, signal });
  }

  return {
    intervalMinutes,
    trendIntervalMinutes,
    spanHours,
    candlesTrendCount: completedTrend.length,
    candlesLowerTfCount: completedLowerTf.length,
    barsEvaluated,
    signals,
    completedLowerTf,
    completedTrend,
  };
}

const EMA_PERIOD_FOR_BIAS = 50;

/// Trend bias as of each lower-tf candle's close time, using only
/// trend-tf candles completed by then (same alignment as
/// loadHistoricalSignals' own walk). Used by exit strategies that need to
/// detect a trend break after entry — not by the locked production path.
export function computeBiasSeries(completedTrend: Candle[], completedLowerTf: Candle[], intervalMinutes: number): Bias[] {
  const trendIntervalMinutes = trendIntervalFor(intervalMinutes);
  const closesTrend = completedTrend.map((c) => c.close);
  const ema50 = ema(closesTrend, EMA_PERIOD_FOR_BIAS);
  const trendTfSeconds = trendIntervalMinutes * 60;

  const biasSeries: Bias[] = [];
  let trendPointer = 0;
  for (const c of completedLowerTf) {
    const evalTime = c.time + intervalMinutes * 60;
    while (trendPointer < completedTrend.length && completedTrend[trendPointer].time + trendTfSeconds <= evalTime) {
      trendPointer++;
    }
    if (trendPointer === 0) {
      biasSeries.push("NONE");
      continue;
    }
    const lastVisibleTrendIndex = trendPointer - 1;
    biasSeries.push(trendBias(closesTrend[lastVisibleTrendIndex], ema50[lastVisibleTrendIndex]));
  }
  return biasSeries;
}
