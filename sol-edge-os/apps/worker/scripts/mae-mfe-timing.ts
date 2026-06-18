/**
 * The 2b experiment: joint MAE/MFE distribution + timing, split by outcome
 * category, so trades that stopped out aren't averaged together with
 * trades that reached a real target. For each trade (truncated to the
 * window the position was actually open):
 *
 *   MFE: best excursion in the favorable direction, and when it peaked
 *   MAE: worst excursion in the adverse direction (vs entry), and when
 *
 * Ordering (MAE peak before or after MFE peak) plus category distinguishes:
 *   - early-stop-destruction: adverse excursion hits the stop almost
 *     immediately, with little or no favorable excursion ever shown
 *   - late-entry / structural chop: real favorable excursion did occur
 *     before the adverse move that ultimately closed the trade
 *
 * Read-only analysis; no strategy/filter changes.
 */
import { checkFill, type PositionState, type FillEvent } from "@sol-edge/analytics";
import { loadHistoricalSignals } from "./historicalSignals";
import { categorizeOutcome } from "@sol-edge/analytics";
import type { Candle } from "@sol-edge/exchanges";

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface TradeAnalysis {
  category: string;
  mfeR: number;
  mfePeakIndex: number;
  maeR: number;
  maePeakIndex: number;
  maeBeforeMfe: boolean; // adverse excursion peaked before favorable excursion peaked
}

/// Single pass through the candles the position was actually open for:
/// tracks running MFE/MAE high-water-marks (vs entry) alongside the real
/// checkFill state machine, stopping at the same point the trade closes.
function analyzeTrade(
  signal: { direction: "LONG" | "SHORT"; entryPrice: number; atrValue: number },
  candlesAfter: Candle[],
): TradeAnalysis | null {
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
      return { category: categorizeOutcome(events), mfeR, mfePeakIndex, maeR, maePeakIndex, maeBeforeMfe: maePeakIndex <= mfePeakIndex };
    }
    state = {
      ...state,
      filledKinds: [...state.filledKinds, event.kind as "TP1" | "TP2" | "TP3"],
      currentStop: event.movesStopToBreakeven ? state.entryPrice : state.currentStop,
    };
    if (state.filledKinds.length === 3) {
      return { category: categorizeOutcome(events), mfeR, mfePeakIndex, maeR, maePeakIndex, maeBeforeMfe: maePeakIndex <= mfePeakIndex };
    }
  }
  return null; // never resolved within available data
}

async function main() {
  const { signals, completedLowerTf } = await loadHistoricalSignals();

  const byCategory = new Map<string, TradeAnalysis[]>();
  let neverClosed = 0;

  for (const { index, signal } of signals) {
    const candlesAfter = completedLowerTf.slice(index + 1);
    const analysis = analyzeTrade(signal, candlesAfter);
    if (!analysis) {
      neverClosed++;
      continue;
    }
    byCategory.set(analysis.category, [...(byCategory.get(analysis.category) ?? []), analysis]);
  }

  console.log(`${signals.length} signals; ${neverClosed} never closed within available data (excluded).\n`);

  const CATEGORY_ORDER = ["SL before TP1", "TP1 then BE", "TP1 + TP2 then BE", "TP3 full winner"];
  console.log("Category               Count  MedianMFE  MedianMAE  MAE<=1candle  MAEbeforeMFE%  MedianMAEpeakIdx");
  for (const category of CATEGORY_ORDER) {
    const trades = byCategory.get(category) ?? [];
    if (trades.length === 0) {
      console.log(`${category.padEnd(23)} 0`);
      continue;
    }
    const medMfe = median(trades.map((t) => t.mfeR));
    const medMae = median(trades.map((t) => t.maeR));
    const earlyMaePct = (trades.filter((t) => t.maePeakIndex <= 1).length / trades.length) * 100;
    const maeBeforeMfePct = (trades.filter((t) => t.maeBeforeMfe).length / trades.length) * 100;
    const medMaeIdx = median(trades.map((t) => t.maePeakIndex));
    console.log(
      `${category.padEnd(23)} ${String(trades.length).padEnd(6)} ${medMfe.toFixed(3).padEnd(10)} ${medMae.toFixed(3).padEnd(10)} ${earlyMaePct.toFixed(1).padEnd(13)} ${maeBeforeMfePct.toFixed(1).padEnd(14)} ${medMaeIdx.toFixed(1)}`,
    );
  }

  console.log("\nInterpretation key:");
  console.log("  MAE<=1candle: adverse excursion peaked within the first 1-2 candles after entry (signature of early-stop-destruction / noise, not a real reversal)");
  console.log("  MAEbeforeMFE%: trades where the worst adverse point came before the best favorable point (price went against us first, recovered or extended favorably after)");
}

main();
