/**
 * What happens to each of the 46 generated signals, taken independently
 * (ignoring risk caps / portfolio limits — this is about the entry/exit
 * mechanism's raw quality, not whether the risk model would have allowed
 * all of them). Uses the real simulateExits from src/lifecycle.ts against
 * actual subsequent candles for each signal in isolation.
 *
 * Gross R only — no fees/slippage (Step 5 cost model is still paused).
 */
import { simulateExits, type PositionState } from "@sol-edge/analytics";
import { loadHistoricalSignals } from "./historicalSignals";

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  const { signals, completedLowerTf } = await loadHistoricalSignals();

  interface Outcome {
    time: number;
    direction: string;
    resolved: boolean;
    stoppedBeforeTp1: boolean;
    reachedTp1: boolean;
    reachedTp2: boolean;
    reachedTp3: boolean;
    grossR: number | null;
  }

  const outcomes: Outcome[] = signals.map(({ time, index, signal }) => {
    const initialStop = signal.direction === "LONG" ? signal.entryPrice - signal.atrValue : signal.entryPrice + signal.atrValue;
    const state: PositionState = {
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      riskPerUnit: signal.atrValue,
      filledKinds: [],
      currentStop: initialStop,
    };
    const candlesAfter = completedLowerTf.slice(index + 1);
    const events = simulateExits(state, candlesAfter);

    const hitSl = events.some((e) => e.kind === "SL");
    const reachedTp1 = events.some((e) => e.kind === "TP1");
    const reachedTp2 = events.some((e) => e.kind === "TP2");
    const reachedTp3 = events.some((e) => e.kind === "TP3");
    const resolved = hitSl || reachedTp3; // simulateExits only stops at SL or TP3

    return {
      time,
      direction: signal.direction,
      resolved,
      stoppedBeforeTp1: hitSl && !reachedTp1,
      reachedTp1,
      reachedTp2,
      reachedTp3,
      grossR: resolved ? events.reduce((sum, e) => sum + e.sizePortion * e.rMultiple, 0) : null,
    };
  });

  const resolvedOutcomes = outcomes.filter((o) => o.resolved);
  const stillOpen = outcomes.filter((o) => !o.resolved);

  console.log(`${outcomes.length} signals, each simulated independently (ignoring risk caps/portfolio limits).`);
  console.log(`${resolvedOutcomes.length} resolved (hit SL or completed TP3) within available data; ${stillOpen.length} still open at end of data — excluded from the stats below.\n`);

  const stoppedBeforeTp1Count = outcomes.filter((o) => o.stoppedBeforeTp1).length;
  const reachedTp1Count = outcomes.filter((o) => o.reachedTp1).length;
  const reachedTp2Count = outcomes.filter((o) => o.reachedTp2).length;
  const reachedTp3Count = outcomes.filter((o) => o.reachedTp3).length;

  console.log("Milestone counts (out of all 46 signals, including still-open ones — these are cumulative, not mutually exclusive):");
  console.log(`  Stopped out before ever reaching TP1: ${stoppedBeforeTp1Count}`);
  console.log(`  Reached TP1 (at any point):           ${reachedTp1Count}`);
  console.log(`  Reached TP2 (at any point):           ${reachedTp2Count}`);
  console.log(`  Reached TP3 (full target completion): ${reachedTp3Count}`);
  console.log(`  Still open at end of available data:  ${stillOpen.length}`);

  const grossRs = resolvedOutcomes.map((o) => o.grossR!);
  const wins = grossRs.filter((r) => r > 0);
  const losses = grossRs.filter((r) => r < 0);
  const winRate = grossRs.length > 0 ? wins.length / grossRs.length : NaN;
  const avgGrossR = grossRs.length > 0 ? grossRs.reduce((s, r) => s + r, 0) / grossRs.length : NaN;
  const grossWinSum = wins.reduce((s, r) => s + r, 0);
  const grossLossSum = Math.abs(losses.reduce((s, r) => s + r, 0));
  const profitFactor = grossLossSum > 0 ? grossWinSum / grossLossSum : Infinity;

  console.log(`\nAggregate over the ${resolvedOutcomes.length} resolved signals (gross R, no fees/slippage — Step 5 cost model still paused):`);
  console.log(`  Win rate:        ${(winRate * 100).toFixed(1)}%  (${wins.length}W / ${losses.length}L / ${grossRs.length - wins.length - losses.length} breakeven)`);
  console.log(`  Average gross R: ${avgGrossR.toFixed(4)}R`);
  console.log(`  Expectancy:      ${avgGrossR.toFixed(4)}R per trade (same figure — expectancy is the mean gross R here)`);
  console.log(`  Profit factor:   ${profitFactor === Infinity ? "∞ (no losses)" : profitFactor.toFixed(2)}`);
  console.log(`  Median gross R:  ${median(grossRs).toFixed(4)}R`);

  console.log("\nPer-signal detail:");
  for (const o of outcomes) {
    const status = o.resolved ? `grossR=${o.grossR!.toFixed(4)}` : "STILL OPEN";
    console.log(`  ${new Date(o.time * 1000).toISOString()} ${o.direction.padEnd(5)} TP1=${o.reachedTp1} TP2=${o.reachedTp2} TP3=${o.reachedTp3} SLbeforeTP1=${o.stoppedBeforeTp1}  ${status}`);
  }
}

main();
