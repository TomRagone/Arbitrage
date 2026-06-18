/**
 * Maximum Favorable/Adverse Excursion analysis. Pure, no I/O. Consolidates
 * logic that had been reimplemented separately in mfe-analysis.ts,
 * mfe-truncated.ts, mfe-timing-analysis.ts, and mae-mfe-timing.ts.
 *
 * Important: MFE/MAE measured over a fixed forward window (not truncated
 * to when the position would have actually closed) overstates available
 * move — it credits price action that happens after the position is
 * already flat. analyzeTradeExcursion below is truncated-at-exit by
 * construction; mfeOverWindow is provided separately only for explicitly
 * bounded-but-uncapped comparisons (e.g. "how far did price move in the
 * next 20h regardless of trade management") and should not be presented
 * as "available to the strategy" without that caveat.
 */
import type { Direction } from "@sol-edge/db";
import type { Candle } from "@sol-edge/exchanges";
import { checkFill, type PositionState, type FillEvent } from "./lifecycle";
import { categorizeOutcome } from "./tradeSimulation";

interface MinimalSignal {
  direction: Direction;
  entryPrice: number;
  atrValue: number;
}

/// MFE over an arbitrary forward window, in R terms, floored at 0.
/// Does NOT account for whether the position would have already closed —
/// see module-level caveat.
export function mfeOverWindow(signal: MinimalSignal, window: Array<{ high: number; low: number }>): number {
  if (window.length === 0) return 0;
  if (signal.direction === "LONG") {
    const maxHigh = Math.max(...window.map((c) => c.high));
    return Math.max(0, (maxHigh - signal.entryPrice) / signal.atrValue);
  }
  const minLow = Math.min(...window.map((c) => c.low));
  return Math.max(0, (signal.entryPrice - minLow) / signal.atrValue);
}

export interface TradeExcursion {
  category: string;
  mfeR: number;
  mfePeakIndex: number; // -1 if favorable excursion never exceeded 0
  maePeakIndex: number;
  maeR: number;
  maeBeforeMfe: boolean; // worst adverse point at/before the best favorable point
  exitIndex: number; // index within candlesAfter where the trade closed
}

/// Single pass through the candles the position was actually open for:
/// tracks running MFE/MAE high-water-marks (vs entry) alongside the real
/// checkFill state machine, stopping at the same point the trade closes.
/// This is the truncated-at-exit measurement — the only version of MFE/MAE
/// that speaks to what the position could actually have captured.
export function analyzeTradeExcursion(signal: MinimalSignal, candlesAfter: Candle[]): TradeExcursion | null {
  const initialStop = signal.direction === "LONG" ? signal.entryPrice - signal.atrValue : signal.entryPrice + signal.atrValue;
  let state: PositionState = {
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    riskPerUnit: signal.atrValue,
    filledKinds: [],
    currentStop: initialStop,
  };
  const events: FillEvent[] = [];

  let mfeR = 0;
  let mfePeakIndex = -1;
  let maeR = 0;
  let maePeakIndex = -1;

  for (let i = 0; i < candlesAfter.length; i++) {
    const c = candlesAfter[i];
    const favorable = signal.direction === "LONG" ? (c.high - signal.entryPrice) / signal.atrValue : (signal.entryPrice - c.low) / signal.atrValue;
    const adverse = signal.direction === "LONG" ? (signal.entryPrice - c.low) / signal.atrValue : (c.high - signal.entryPrice) / signal.atrValue;
    if (favorable > mfeR) {
      mfeR = favorable;
      mfePeakIndex = i;
    }
    if (adverse > maeR) {
      maeR = adverse;
      maePeakIndex = i;
    }

    const event = checkFill({ high: c.high, low: c.low }, state);
    if (!event) continue;
    events.push(event);
    if (event.kind === "SL") {
      return { category: categorizeOutcome(events), mfeR, mfePeakIndex, maeR, maePeakIndex, maeBeforeMfe: maePeakIndex <= mfePeakIndex, exitIndex: i };
    }
    state = {
      ...state,
      filledKinds: [...state.filledKinds, event.kind as "TP1" | "TP2" | "TP3"],
      currentStop: event.movesStopToBreakeven ? state.entryPrice : state.currentStop,
    };
    if (state.filledKinds.length === 3) {
      return { category: categorizeOutcome(events), mfeR, mfePeakIndex, maeR, maePeakIndex, maeBeforeMfe: maePeakIndex <= mfePeakIndex, exitIndex: i };
    }
  }
  return null; // never resolved within available data
}

/// Convenience: just the exit index (no excursion tracking), for callers
/// that only need to know where to truncate a window.
export function findExitIndex(signal: MinimalSignal, candlesAfter: Candle[]): number | null {
  const result = analyzeTradeExcursion(signal, candlesAfter);
  return result ? result.exitIndex : null;
}
