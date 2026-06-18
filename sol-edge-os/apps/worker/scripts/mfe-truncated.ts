/**
 * Truncated MFE: the bounded 80-candle MFE in mfe-analysis.ts still
 * overstates "available" move, because it keeps searching for favorable
 * excursion even after the position would have already been stopped out.
 * A trade that stops at -1R in candle 3 and rallies to +3R by candle 40
 * gets credited with +3R "available" — but the position was flat by then.
 *
 * This measures MFE only while the position is actually open: from entry
 * up to (and including) the candle where the baseline structure's real
 * exit (checkFill) would have closed it. That's the only version of MFE
 * that speaks to whether the stop is the problem.
 */
import { checkFill, type PositionState, type FillEvent } from "@sol-edge/analytics";
import { loadHistoricalSignals } from "./historicalSignals";
import { simulateTrade as simulateBaselineTrade } from "@sol-edge/analytics";
import { getSettings, getSystemConfiguration } from "@sol-edge/db";
import type { CostRates } from "@sol-edge/analytics";
import type { Candle } from "@sol-edge/exchanges";

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/// Same control flow as checkFill/simulateExits, but returns the INDEX
/// (within candlesAfter) where the trade fully closes, not just the events.
function findExitIndex(
  signal: { direction: "LONG" | "SHORT"; entryPrice: number; atrValue: number },
  candlesAfter: Candle[],
): number | null {
  const initialStop = signal.direction === "LONG" ? signal.entryPrice - signal.atrValue : signal.entryPrice + signal.atrValue;
  let state: PositionState = {
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    riskPerUnit: signal.atrValue,
    filledKinds: [],
    currentStop: initialStop,
  };
  for (let i = 0; i < candlesAfter.length; i++) {
    const event: FillEvent | null = checkFill({ high: candlesAfter[i].high, low: candlesAfter[i].low }, state);
    if (!event) continue;
    if (event.kind === "SL") return i;
    state = {
      ...state,
      filledKinds: [...state.filledKinds, event.kind as "TP1" | "TP2" | "TP3"],
      currentStop: event.movesStopToBreakeven ? state.entryPrice : state.currentStop,
    };
    if (state.filledKinds.length === 3) return i;
  }
  return null; // never closes within available data
}

function mfeR(signal: { direction: "LONG" | "SHORT"; entryPrice: number; atrValue: number }, window: Candle[]): number {
  if (window.length === 0) return 0;
  if (signal.direction === "LONG") {
    const maxHigh = Math.max(...window.map((c) => c.high));
    return Math.max(0, (maxHigh - signal.entryPrice) / signal.atrValue);
  }
  const minLow = Math.min(...window.map((c) => c.low));
  return Math.max(0, (signal.entryPrice - minLow) / signal.atrValue);
}

async function main() {
  const { signals, completedLowerTf } = await loadHistoricalSignals();
  const sysConfig = await getSystemConfiguration();
  const settings = await getSettings();
  const ASSUMED_ACCOUNT_SIZE = 10000;
  const riskAmount = (Number(settings.riskPctPerTrade) / 100) * ASSUMED_ACCOUNT_SIZE;
  const rates: CostRates = {
    feeRateEntry: Number(sysConfig.feeRateEntryBps) / 10000,
    feeRateExit: Number(sysConfig.feeRateExitBps) / 10000,
    slippageRate: Number(sysConfig.slippageBps) / 10000,
  };

  const truncatedMfes: number[] = [];
  const boundedMfes80: number[] = []; // for side-by-side comparison with the old (contaminated) figure
  const capturedGrossRs: number[] = [];
  let neverClosed = 0;

  for (const { index, signal } of signals) {
    const candlesAfter = completedLowerTf.slice(index + 1);
    const exitIndex = findExitIndex(signal, candlesAfter);

    if (exitIndex === null) {
      neverClosed++;
      continue;
    }

    const truncatedWindow = candlesAfter.slice(0, exitIndex + 1); // open through the closing candle, inclusive
    truncatedMfes.push(mfeR(signal, truncatedWindow));
    boundedMfes80.push(mfeR(signal, candlesAfter.slice(0, 80)));

    const baseline = simulateBaselineTrade(signal, candlesAfter, riskAmount, rates);
    capturedGrossRs.push(baseline ? baseline.grossR : NaN);
  }

  console.log(`${signals.length} signals; ${neverClosed} never closed within available data (excluded).\n`);

  const mean = (vals: number[]) => vals.reduce((s, v) => s + v, 0) / vals.length;
  const MEAN_COST_DRAG_R = 0.7664 + 0.1894; // avg fees R + avg slippage R, from cost-model-report
  const meanTruncatedMfe = mean(truncatedMfes);
  console.log("── Step 1: mean truncated MFE vs mean cost drag (the fork) ──");
  console.log(`  Mean truncated-at-exit MFE: ${meanTruncatedMfe.toFixed(4)}R  (median was ${median(truncatedMfes).toFixed(4)}R — right-skewed as expected)`);
  console.log(`  Mean cost drag:             ${MEAN_COST_DRAG_R.toFixed(4)}R`);
  console.log(`  Mean MFE - mean drag:       ${(meanTruncatedMfe - MEAN_COST_DRAG_R).toFixed(4)}R  -> ${meanTruncatedMfe - MEAN_COST_DRAG_R > 0 ? "POSITIVE: route to 2b (MAE+timing worth running)" : "NEGATIVE: route to 2a (exits are a dead end at this config)"}\n`);

  console.log("── MFE while position was actually open (truncated at real exit) vs the old bounded-80-candle figure ──");
  console.log(`  Median truncated-at-exit MFE: ${median(truncatedMfes).toFixed(3)}R`);
  console.log(`  Median bounded-80-candle MFE: ${median(boundedMfes80).toFixed(3)}R  (previous measurement, for comparison — overstates availability)`);
  console.log(`  Median captured gross R:      ${median(capturedGrossRs.filter((r) => !Number.isNaN(r))).toFixed(3)}R`);

  const pctAtLeast = (vals: number[], threshold: number) => (vals.filter((v) => v >= threshold).length / vals.length) * 100;
  console.log(`\n  %>=1R (truncated): ${pctAtLeast(truncatedMfes, 1).toFixed(1)}%   %>=1R (bounded-80): ${pctAtLeast(boundedMfes80, 1).toFixed(1)}%`);
  console.log(`  %>=2R (truncated): ${pctAtLeast(truncatedMfes, 2).toFixed(1)}%   %>=2R (bounded-80): ${pctAtLeast(boundedMfes80, 2).toFixed(1)}%`);
  console.log(`  %>=3R (truncated): ${pctAtLeast(truncatedMfes, 3).toFixed(1)}%   %>=3R (bounded-80): ${pctAtLeast(boundedMfes80, 3).toFixed(1)}%`);

  const gapClosedPct = ((median(boundedMfes80) - median(truncatedMfes)) / median(boundedMfes80)) * 100;
  console.log(`\n  The "available move" shrinks by ${gapClosedPct.toFixed(1)}% once truncated to what the position could actually have captured.`);
}

main();
