/**
 * Live I/O wrappers around the pure strategy engine, which now lives in
 * @sol-edge/analytics (so diagnostics/backtests/the eventual reporting
 * layer all import the same decision logic the worker runs). This file
 * should stay thin — any new decision logic belongs in
 * packages/analytics/src/strategyEngine.ts, not here.
 */
import { countOpenTrades, countTradesToday, getSettings } from "@sol-edge/db";
import { getOHLC } from "@sol-edge/exchanges";
import {
  evaluateSignal,
  decideTrade,
  PAIR,
  LOWER_TF_INTERVAL_MINUTES,
  MIN_TREND_CANDLES,
  MIN_LOWER_TF_CANDLES,
  trendIntervalFor,
  type Signal,
  type ValidationResult,
  type RiskSettings,
  type RiskState,
} from "@sol-edge/analytics";

export { evaluateSignal, decideTrade, PAIR, LOWER_TF_INTERVAL_MINUTES, MIN_TREND_CANDLES, MIN_LOWER_TF_CANDLES };
export type { Signal, ValidationResult, RiskSettings, RiskState };

/// Live wrapper: fetches current candles from Kraken, drops the
/// still-forming candle from each timeframe, and evaluates. Trend
/// timeframe is derived from the entry timeframe via trendIntervalFor()
/// (STEP4_STRATEGY_SPEC.md Addendum 1) rather than hardcoded — resolves
/// to 1H for the currently-locked 15m entry timeframe.
export async function computeSignal(): Promise<Signal | null> {
  const trendIntervalMinutes = trendIntervalFor(LOWER_TF_INTERVAL_MINUTES);
  const candlesTrend = await getOHLC(PAIR, trendIntervalMinutes);
  const completedTrend = candlesTrend.slice(0, -1);
  if (completedTrend.length < MIN_TREND_CANDLES) {
    console.log(`[signal] insufficient trend-tf history (${completedTrend.length}/${MIN_TREND_CANDLES})`);
    return null;
  }

  const candlesLower = await getOHLC(PAIR, LOWER_TF_INTERVAL_MINUTES);
  const completedLowerTf = candlesLower.slice(0, -1);
  if (completedLowerTf.length < MIN_LOWER_TF_CANDLES) {
    console.log(`[signal] insufficient 15m history (${completedLowerTf.length}/${MIN_LOWER_TF_CANDLES})`);
    return null;
  }

  return evaluateSignal(completedTrend, completedLowerTf);
}

/// Live wrapper: reads real Settings + real open/today trade counts from
/// the DB, then defers to the pure decideTrade.
export async function validateSignal(signal: Signal): Promise<ValidationResult> {
  const settings = await getSettings();
  const openPositions = await countOpenTrades();
  const tradesToday = await countTradesToday();
  return decideTrade(
    signal,
    {
      riskPctPerTrade: Number(settings.riskPctPerTrade),
      accountSize: Number(settings.accountSize),
      maxOpenPositions: settings.maxOpenPositions,
      maxTradesPerDay: settings.maxTradesPerDay,
    },
    { openPositions, tradesToday },
  );
}
