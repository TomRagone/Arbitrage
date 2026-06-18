/**
 * Step 1 of the "is the entry signal even capable of producing real moves"
 * investigation: for every signal, compute Maximum Favorable Excursion
 * (MFE) — the best price the market reached in the trade's favorable
 * direction, in R terms — over several forward windows, independent of
 * any stop/target structure. This measures available move, not captured
 * move (that's what baseline/variant gross R already measures).
 *
 * Read-only analysis; no strategy/filter changes.
 */
import { loadHistoricalSignals } from "./historicalSignals";
import { simulateTrade as simulateBaselineTrade } from "@sol-edge/analytics";
import { getSettings, getSystemConfiguration } from "@sol-edge/db";
import type { CostRates } from "@sol-edge/analytics";

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mfeR(signal: { direction: "LONG" | "SHORT"; entryPrice: number; atrValue: number }, window: Array<{ high: number; low: number }>): number {
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

  const windows = [10, 20, 40, 80]; // 2.5h, 5h, 10h, 20h at 15m bars
  const mfeByWindow = new Map<number, number[]>();
  for (const w of windows) mfeByWindow.set(w, []);
  const capturedGrossRs: number[] = [];

  for (const { index, signal } of signals) {
    const candlesAfter = completedLowerTf.slice(index + 1);
    for (const w of windows) {
      mfeByWindow.get(w)!.push(mfeR(signal, candlesAfter.slice(0, w)));
    }

    const baseline = simulateBaselineTrade(signal, candlesAfter, riskAmount, rates);
    capturedGrossRs.push(baseline ? baseline.grossR : NaN);
  }
  // Reference window for "available move" claims below: 80 candles (20h).
  // An earlier version of this script used an unbounded lookback ("every
  // remaining candle in the dataset") and got a nonsense median of 17R —
  // that measures unrelated future price action for signals near the
  // start of the sample, not the move actually available after THIS
  // breakout. Bounded windows are the only methodologically valid reading.
  const referenceMfes = mfeByWindow.get(80)!;

  console.log(`${signals.length} signals analyzed.\n`);
  console.log("── MFE distribution by forward window (R terms, floored at 0) ──");
  console.log("window   median   p25    p75    %>=1R   %>=2R   %>=3R");
  for (const w of windows) {
    const vals = mfeByWindow.get(w)!;
    const sorted = [...vals].sort((a, b) => a - b);
    const p = (q: number) => sorted[Math.floor(q * sorted.length)];
    const pct = (threshold: number) => (vals.filter((v) => v >= threshold).length / vals.length) * 100;
    console.log(
      `${String(w).padEnd(8)} ${median(vals).toFixed(3).padEnd(8)} ${p(0.25).toFixed(3).padEnd(6)} ${p(0.75).toFixed(3).padEnd(6)} ${pct(1).toFixed(1).padEnd(7)} ${pct(2).toFixed(1).padEnd(7)} ${pct(3).toFixed(1)}`,
    );
  }

  console.log("\n── 80-candle (20h) MFE vs captured gross R (baseline structure) — the reference window ──");
  console.log(`  Median 80-candle MFE:    ${median(referenceMfes).toFixed(3)}R`);
  console.log(`  Median captured grossR:  ${median(capturedGrossRs.filter((r) => !Number.isNaN(r))).toFixed(3)}R`);
  console.log(`  %>=2R available (80-candle MFE): ${((referenceMfes.filter((v) => v >= 2).length / referenceMfes.length) * 100).toFixed(1)}%`);
  console.log(`  %>=3R available (80-candle MFE): ${((referenceMfes.filter((v) => v >= 3).length / referenceMfes.length) * 100).toFixed(1)}%`);

  // Step 2: Group A/B split using the 80-candle (20h) MFE — bounded, not the broken unbounded measure.
  const groupA = referenceMfes.filter((v) => v < 1.2).length;
  const groupMiddle = referenceMfes.filter((v) => v >= 1.2 && v < 3).length;
  const groupB = referenceMfes.filter((v) => v >= 3).length;
  console.log("\n── Group split (using 80-candle/20h MFE) ──");
  console.log(`  Group A (dies before 1.2R):  ${groupA}/${signals.length} (${((groupA / signals.length) * 100).toFixed(1)}%)`);
  console.log(`  Middle (1.2R–3R):            ${groupMiddle}/${signals.length} (${((groupMiddle / signals.length) * 100).toFixed(1)}%)`);
  console.log(`  Group B (3R+ true expansion): ${groupB}/${signals.length} (${((groupB / signals.length) * 100).toFixed(1)}%)`);

  console.log("\nKnown round-trip cost base for reference: ~0.75-0.84R (from earlier cost-model-report / variant-test runs).");
}

main();
