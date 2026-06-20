/**
 * Phase 10C — committed search #6. A structurally distinct hypothesis
 * from 10C-004/005, not another feature pairing on the same mechanism:
 * 10C-005's diagnostic showed mechanical negation exits the instant the
 * SAME noisy entry level gets recrossed — exactly when whipsaw happens
 * by construction. This tests the fix directly: decouple entry/exit to
 * use independent reference levels (a classic Donchian channel — enter
 * breaking the N-bar high, exit breaking the N-bar low, not a negation
 * of the entry). Pre-registration record:
 * docs/preregistration/10C-006-donchian-channel.md (committed before
 * this ran).
 *
 * Same process as prior runs: reads ONLY source = 'trades_resampled'
 * from the local sqlite store, carves the most recent 2,160 bars as a
 * touch-once holdout before any fold, walk-forwards the remainder (8
 * folds), ranks by pooled cross-fold OOS expectancy. 14 candidates,
 * exhaustive — small enough to report every candidate individually.
 *
 * Standing diagnostic (kept from 10C-004/005): holding-period check on
 * whatever clears the >=10-trade floor, regardless of significance.
 *
 * I/O lives here (sqlite read, console report) per this project's own
 * layering rule — packages/research stays pure, no I/O.
 */
import { readOHLCV, validateDataIntegrity, type MarketConfig, type OHLCVBar } from "@sol-edge/database";
import { validateStrategy, type BoolExpr, type CompactCandle, type StrategyDSL } from "@sol-edge/core";
import {
  evaluateCandidate,
  computeFeatures,
  planWalkForward,
  evaluateHoldoutOnce,
  isSignificant,
  DEFAULT_SIM_CONFIG,
  DEFAULT_FRICTION_PARAMS,
  type RankedStrategy,
} from "@sol-edge/research";
import { runAstKernel } from "@sol-edge/kernel";
import marketConfig from "../../../config/market.json";
import path from "path";
import { writeSearchResultJson } from "./lib/searchResultJson";

const PREREG_DIR = path.join(process.cwd(), "..", "..", "docs", "preregistration");
const HOLDOUT_BARS = 2160;
const TRAIN_BARS = 2160;
const TEST_BARS = 720;
const STEP_BARS = 720;
const LOOKBACKS = [10, 14, 20, 30, 50, 75, 100] as const;

function toBps(logReturn: number): number {
  return logReturn * 10000;
}
function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}
function maxDrawdown(returns: readonly number[]): number {
  let equity = 1, peak = 1, worst = 0;
  for (const r of returns) {
    equity *= Math.exp(r);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > worst) worst = dd;
  }
  return worst;
}

/// Decoupled entry/exit (Donchian channel) — NOT mechanical negation.
/// LONG: enter close>breakout_high_N, exit close<breakout_low_N (opposite channel boundary).
/// SHORT: mirror.
function buildCandidates(): { strategy: StrategyDSL; label: string }[] {
  const candidates: { strategy: StrategyDSL; label: string }[] = [];
  for (const n of LOOKBACKS) {
    const highFeature = `breakout_high_${n}`;
    const lowFeature = `breakout_low_${n}`;

    const longEntry: BoolExpr = { type: "gt", left: { type: "price", field: "close" }, right: { type: "feature", name: highFeature } };
    const longExit: BoolExpr = { type: "lt", left: { type: "price", field: "close" }, right: { type: "feature", name: lowFeature } };
    const longStrategy: StrategyDSL = { side: "LONG", entry: longEntry, exit: longExit };
    validateStrategy(longStrategy);
    candidates.push({ strategy: longStrategy, label: `LONG: enter close>${highFeature}, exit close<${lowFeature}` });

    const shortEntry: BoolExpr = { type: "lt", left: { type: "price", field: "close" }, right: { type: "feature", name: lowFeature } };
    const shortExit: BoolExpr = { type: "gt", left: { type: "price", field: "close" }, right: { type: "feature", name: highFeature } };
    const shortStrategy: StrategyDSL = { side: "SHORT", entry: shortEntry, exit: shortExit };
    validateStrategy(shortStrategy);
    candidates.push({ strategy: shortStrategy, label: `SHORT: enter close<${lowFeature}, exit close>${highFeature}` });
  }
  return candidates;
}

async function main() {
  const cfg = marketConfig as MarketConfig;

  const rows = readOHLCV(cfg, "trades_resampled", 0, 9_999_999_999);
  const barDurationSeconds = 3600;
  const bars: OHLCVBar[] = rows.map((r) => ({ timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));

  const integrity = validateDataIntegrity(bars, barDurationSeconds);
  console.log(`Integrity: ${integrity.barCount} bars, ${integrity.gaps.length} gap(s).`);
  for (const g of integrity.gaps) {
    console.log(`  gap after ${new Date(g.afterTimestamp * 1000).toISOString()} -> ${new Date(g.actualNextTimestamp * 1000).toISOString()} (${g.missingBars} missing bar(s))`);
  }

  const candles: CompactCandle[] = bars.map((b) => ({ timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close }));
  console.log(`Series: ${candles.length} bars [${new Date(candles[0].timestamp * 1000).toISOString()} .. ${new Date(candles[candles.length - 1].timestamp * 1000).toISOString()}]`);

  const holdoutCandles = candles.slice(candles.length - HOLDOUT_BARS);
  const walkForwardPool = candles.slice(0, candles.length - HOLDOUT_BARS);
  console.log(
    `Holdout (locked, touch-once): ${holdoutCandles.length} bars [${new Date(holdoutCandles[0].timestamp * 1000).toISOString()} .. ${new Date(holdoutCandles[holdoutCandles.length - 1].timestamp * 1000).toISOString()}]`,
  );
  console.log(`Walk-forward pool: ${walkForwardPool.length} bars.`);

  const plan = planWalkForward(walkForwardPool, TRAIN_BARS, TEST_BARS, STEP_BARS);
  console.log(`Walk-forward (${TRAIN_BARS}h/${TEST_BARS}h/${STEP_BARS}h): ${plan.folds.length} fold(s). Unused tail: ${plan.holdout.length} bars.\n`);

  const built = buildCandidates();
  const candidates = built.map((b) => b.strategy);
  console.log(`Committed search space: ${candidates.length} candidates (pre-registered, docs/preregistration/10C-006-donchian-channel.md).`);
  if (candidates.length !== 14) {
    throw new Error(`search-10c-6: candidate count mismatch — expected exactly 14, got ${candidates.length}.`);
  }
  console.log(`Sanity check: candidate count == 14 confirmed.`);
  console.log(`Example: ${built[0].label}`);
  console.log(`Example: ${built[1].label}\n`);

  const allFeatureKeys = Array.from(
    new Set(LOOKBACKS.flatMap((n) => [`breakout_high_${n}`, `breakout_low_${n}`])),
  );
  const pooledReturns: number[][] = candidates.map(() => []);
  const perFoldRecords: { fold: number; expectancyBps: number; trades: number; rule: string }[] = [];

  console.log(`── Per-fold OOS results ──`);
  plan.folds.forEach((fold, foldIndex) => {
    const fullSeries = [...fold.train, ...fold.test];
    const trainFeatures = computeFeatures(fold.train, fullSeries, allFeatureKeys);
    const testFeatures = computeFeatures(fold.test, fullSeries, allFeatureKeys);

    let bestIdx = -1;
    let bestExpectancy = -Infinity;
    let bestTrades = 0;

    candidates.forEach((strategy, i) => {
      const { testStats, testReturns } = evaluateCandidate(strategy, fold.train, trainFeatures, fold.test, testFeatures, DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS);
      pooledReturns[i].push(...testReturns);
      if (testStats.simulatedExpectancy > bestExpectancy) {
        bestExpectancy = testStats.simulatedExpectancy;
        bestIdx = i;
        bestTrades = testStats.totalTrades;
      }
    });

    perFoldRecords.push({ fold: foldIndex, expectancyBps: toBps(bestExpectancy), trades: bestTrades, rule: built[bestIdx].label });
    console.log(`  Fold ${foldIndex}: best OOS expectancy ${toBps(bestExpectancy).toFixed(2)}bps/trade (${bestTrades} trades) — ${built[bestIdx].label}`);
  });

  const ranked: (RankedStrategy & { label: string })[] = candidates.map((strategy, i) => {
    const returns = pooledReturns[i];
    const testStats = {
      strategySignature: "",
      totalTrades: returns.length,
      kernelExpectancy: 0,
      simulatedExpectancy: mean(returns),
      maxDrawdownSimulated: maxDrawdown(returns),
    };
    return { strategy, trainStats: testStats, testStats, trials: candidates.length, testReturns: returns, label: built[i].label };
  });
  ranked.sort((a, b) => b.testStats.simulatedExpectancy - a.testStats.simulatedExpectancy);

  console.log(`\n── All ${candidates.length} candidates, ranked by pooled OOS expectancy ──`);
  ranked.forEach((r, rank) => {
    console.log(
      `  #${rank + 1}: ${toBps(r.testStats.simulatedExpectancy).toFixed(2)}bps/trade (${r.testStats.totalTrades} trades, max DD ${(r.testStats.maxDrawdownSimulated * 100).toFixed(2)}%) — ${r.label}`,
    );
  });

  const top = ranked[0];
  const significant = isSignificant(top);

  console.log(`\n── Top-ranked candidate ──`);
  console.log(`  Rule: ${top.label}`);
  console.log(`  Pooled OOS expectancy: ${toBps(top.testStats.simulatedExpectancy).toFixed(2)}bps/trade (${top.testStats.totalTrades} trades)`);
  console.log(`  Pooled OOS max drawdown: ${(top.testStats.maxDrawdownSimulated * 100).toFixed(2)}%`);
  console.log(`  Trials (committed N): ${top.trials}`);
  console.log(`  Significant (DSR >= 0.95, min 10 pooled OOS trades): ${significant}`);

  // ── Standing diagnostic: holding period on whatever clears the >=10-trade floor ──
  const sufficientlyTraded = ranked.filter((r) => r.testStats.totalTrades >= 10);
  console.log(`\n── Holding-period diagnostic (candidates with >=10 pooled trades: ${sufficientlyTraded.length} of ${ranked.length}) ──`);
  let topHoldingPeriods: number[] = [];
  sufficientlyTraded.forEach((r) => {
    const holdingPeriods: number[] = [];
    plan.folds.forEach((fold) => {
      const fullSeries = [...fold.train, ...fold.test];
      const testFeatures = computeFeatures(fold.test, fullSeries, allFeatureKeys);
      const trades = runAstKernel(r.strategy, fold.test, testFeatures);
      for (const trade of trades) holdingPeriods.push(trade.exitTime - trade.entryTime);
    });
    if (r === top) topHoldingPeriods = holdingPeriods;
    const meanHold = mean(holdingPeriods);
    const sorted = [...holdingPeriods].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const oneBarFraction = holdingPeriods.filter((h) => h === 1).length / holdingPeriods.length;
    console.log(
      `  ${r.label}: ${holdingPeriods.length} trades, mean=${meanHold.toFixed(2)} median=${median} max=${sorted[sorted.length - 1]} (${(oneBarFraction * 100).toFixed(1)}% held exactly 1 bar)`,
    );
  });
  if (sufficientlyTraded.length === 0) {
    console.log(`  None — every candidate has fewer than 10 pooled trades.`);
  }

  let holdoutJson: { evaluated: boolean; expectancyBps?: number; trades?: number; maxDrawdownPct?: number } = { evaluated: false };
  if (significant) {
    console.log(`\n── HOLDOUT (touched once, final honest estimate) ──`);
    const holdoutSplit = { train: walkForwardPool, test: [], holdout: holdoutCandles };
    const holdoutResult = evaluateHoldoutOnce(top.strategy, holdoutSplit, DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS);
    console.log(`  Holdout expectancy: ${toBps(holdoutResult.simulatedExpectancy).toFixed(2)}bps/trade (${holdoutResult.totalTrades} trades) — DO NOT RE-RUN.`);
    console.log(`  Holdout max drawdown: ${(holdoutResult.maxDrawdownSimulated * 100).toFixed(2)}%`);
    holdoutJson = {
      evaluated: true,
      expectancyBps: toBps(holdoutResult.simulatedExpectancy),
      trades: holdoutResult.totalTrades,
      maxDrawdownPct: holdoutResult.maxDrawdownSimulated * 100,
    };
  } else {
    console.log(`\nNo candidate cleared significance at the committed budget (14 trials, DSR >= 0.95, min 10 pooled OOS trades). This is a valid, complete null result — the holdout is NOT touched.`);
  }

  writeSearchResultJson(
    "10C-006-donchian-channel",
    {
      runId: "10C-006",
      trials: top.trials,
      significant,
      perFold: perFoldRecords,
      topCandidate: {
        label: top.label,
        pooledExpectancyBps: toBps(top.testStats.simulatedExpectancy),
        pooledTrades: top.testStats.totalTrades,
        maxDrawdownPct: top.testStats.maxDrawdownSimulated * 100,
      },
      topCandidateReturns: top.testReturns,
      topCandidateHoldingPeriods: topHoldingPeriods,
      holdout: holdoutJson,
    },
    PREREG_DIR,
  );
}

main();
