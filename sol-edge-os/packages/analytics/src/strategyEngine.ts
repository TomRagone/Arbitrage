/**
 * EMA Trend Breakout System v1 — pure signal/decision logic only. Moved
 * here from apps/worker/src/engine.ts so both the live worker and any
 * analytics/diagnostic tooling (including a future reporting layer) import
 * the exact same decision functions — apps/worker/src/engine.ts now keeps
 * only the live I/O wrappers (computeSignal/validateSignal) and re-exports
 * these.
 *
 * Locked rules unaffected by this move: breakout/ATR/volume window counts
 * (14/20/20), TP structure (1R/2R/3R), risk model.
 *
 * Trend filter timeframe is NOT fixed at 1H — see STEP4_STRATEGY_SPEC.md
 * Addendum 1. It scales with the entry timeframe via trendIntervalFor()
 * below, locked to an explicit table (Kraken's OHLC endpoint only
 * supports a fixed interval grid, so this is a lookup, not a formula).
 */
import type { Direction } from "@sol-edge/db";
import type { Candle } from "@sol-edge/exchanges";
import { ema, sma, atr, breakoutHigh, breakoutLow, isFirstOccurrence, trendBias } from "@sol-edge/strategy";

export const PAIR = "SOLUSD";
export const LOWER_TF_INTERVAL_MINUTES = 15; // the currently-locked base timeframe

export const EMA_PERIOD = 50;
export const ATR_PERIOD = 14;
export const ATR_SMA_PERIOD = 20;
export const VOLUME_SMA_PERIOD = 20;
export const BREAKOUT_PERIOD = 20;
export const MIN_TREND_CANDLES = EMA_PERIOD + 1;
export const MIN_LOWER_TF_CANDLES = ATR_PERIOD + ATR_SMA_PERIOD + BREAKOUT_PERIOD; // generous margin

/// STEP4_STRATEGY_SPEC.md Addendum 1: trend timeframe = the next interval
/// on Kraken's supported grid that is at least 4x the entry interval.
/// Locked as an explicit table, not computed, because Kraken's OHLC
/// endpoint only accepts a fixed set of intervals (90 is rejected
/// outright, confirmed empirically) — an arbitrary multiplier would
/// frequently land on an unsupported value.
const TREND_INTERVAL_TABLE: Array<[number, number]> = [
  [15, 60], // 15m entry -> 1H trend (4x; the original, already-validated relationship)
  [60, 240], // 1H entry -> 4H trend (4x)
  [240, 1440], // 4H entry -> 1D trend (6x)
  [1440, 10080], // 1D entry -> 1W trend (7x)
];

export function trendIntervalFor(entryIntervalMinutes: number): number {
  const row = TREND_INTERVAL_TABLE.find(([entry]) => entry === entryIntervalMinutes);
  if (!row) {
    throw new Error(
      `No locked trend-timeframe mapping for entry interval ${entryIntervalMinutes}min — add it to TREND_INTERVAL_TABLE in strategyEngine.ts and STEP4_STRATEGY_SPEC.md Addendum 1, don't compute it ad hoc.`,
    );
  }
  return row[1];
}

// ──────────────────────────── 1. SIGNAL ────────────────────────────

export interface Signal {
  direction: Direction;
  entryPrice: number;
  atrValue: number;
  atrSmaValue: number;
  volume: number;
  volumeSmaValue: number;
  isFirstBreakout: boolean;
  bias: "LONG" | "SHORT" | "NONE";
}

/// Pure: completedTrend/completedLowerTf must already exclude any
/// still-forming candle. The signal is evaluated on the last element of
/// completedLowerTf — interval-agnostic on both sides, so this same
/// function drives any entry/trend timeframe pair (the locked 15m/1H
/// pair today, swept across others via trendIntervalFor() for the
/// timeframe comparison in runDiagnostic.ts).
export function evaluateSignal(completedTrend: Candle[], completedLowerTf: Candle[]): Signal | null {
  if (completedTrend.length < MIN_TREND_CANDLES || completedLowerTf.length < MIN_LOWER_TF_CANDLES) return null;

  const closesTrend = completedTrend.map((c) => c.close);
  const ema50 = ema(closesTrend, EMA_PERIOD);
  const bias = trendBias(closesTrend[closesTrend.length - 1], ema50[ema50.length - 1]);
  if (bias === "NONE") return null;

  const closesLower = completedLowerTf.map((c) => c.close);
  const highsLower = completedLowerTf.map((c) => c.high);
  const lowsLower = completedLowerTf.map((c) => c.low);
  const volumesLower = completedLowerTf.map((c) => c.volume);

  const atr14 = atr(completedLowerTf, ATR_PERIOD);
  const atrSma20 = sma(atr14, ATR_SMA_PERIOD);
  const volSma20 = sma(volumesLower, VOLUME_SMA_PERIOD);
  const breakHigh = breakoutHigh(closesLower, highsLower, BREAKOUT_PERIOD);
  const breakLow = breakoutLow(closesLower, lowsLower, BREAKOUT_PERIOD);

  const i = closesLower.length - 1; // C: the latest completed candle

  let direction: Direction | null = null;
  let isFirstBreakout = false;
  if (bias === "LONG" && breakHigh[i]) {
    direction = "LONG";
    isFirstBreakout = isFirstOccurrence(breakHigh, i);
  } else if (bias === "SHORT" && breakLow[i]) {
    direction = "SHORT";
    isFirstBreakout = isFirstOccurrence(breakLow, i);
  }
  if (!direction) return null;

  return {
    direction,
    entryPrice: closesLower[i],
    atrValue: atr14[i],
    atrSmaValue: atrSma20[i],
    volume: volumesLower[i],
    volumeSmaValue: volSma20[i],
    isFirstBreakout,
    bias,
  };
}

// ──────────────────────────── 2. VALIDATE ────────────────────────────

export interface ValidationResult {
  approved: boolean;
  size?: number;
  initialStop?: number;
  riskAmount?: number;
  reason: string;
}

export interface RiskSettings {
  riskPctPerTrade: number;
  accountSize: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
}

export interface RiskState {
  openPositions: number;
  tradesToday: number;
}

/// Pure: same decision rules whether driven live or by a backtest.
export function decideTrade(signal: Signal, settings: RiskSettings, state: RiskState): ValidationResult {
  if (!(signal.atrValue > signal.atrSmaValue)) {
    return { approved: false, reason: `volatility: ATR14 (${signal.atrValue}) <= SMA20(ATR14) (${signal.atrSmaValue})` };
  }
  if (!(signal.volume > signal.volumeSmaValue)) {
    return { approved: false, reason: `volume: candle volume (${signal.volume}) <= SMA20(volume) (${signal.volumeSmaValue})` };
  }
  if (!signal.isFirstBreakout) {
    return { approved: false, reason: "anti-chase: not the first breakout candle" };
  }
  if (state.openPositions >= settings.maxOpenPositions) {
    return { approved: false, reason: `risk cap: open positions (${state.openPositions}) >= maxOpenPositions (${settings.maxOpenPositions})` };
  }
  if (state.tradesToday >= settings.maxTradesPerDay) {
    return { approved: false, reason: `risk cap: trades today (${state.tradesToday}) >= maxTradesPerDay (${settings.maxTradesPerDay})` };
  }

  const riskAmount = (settings.riskPctPerTrade / 100) * settings.accountSize;
  if (!(riskAmount > 0)) {
    return { approved: false, reason: `sizing: riskAmount <= 0 (accountSize ${settings.accountSize} not configured)` };
  }

  const stopDistance = signal.atrValue; // 1R = 1x ATR14
  const size = riskAmount / stopDistance;
  const initialStop = signal.direction === "LONG" ? signal.entryPrice - stopDistance : signal.entryPrice + stopDistance;

  return {
    approved: true,
    size,
    initialStop,
    riskAmount,
    reason: "trend + breakout + volatility + volume + anti-chase + risk caps all passed",
  };
}
