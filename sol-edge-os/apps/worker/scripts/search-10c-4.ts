/**
 * Phase 10C — committed search #4. A genuinely new hypothesis: price
 * breakout / momentum continuation, not mean-reversion (10C-001/002/003
 * all tested rsi_14/ema_ratio_20 mean-reversion conditions). Pre-
 * registration record: docs/preregistration/10C-004-breakout-momentum.md
 * (committed before this ran).
 *
 * Same process as 10C-002/003: reads ONLY source = 'trades_resampled'
 * from the local sqlite store, carves the most recent 2,160 bars as a
 * touch-once holdout before any fold, walk-forwards the remainder (8
 * folds), and ranks by pooled cross-fold OOS expectancy. Depth-1 only,
 * 14 candidates total — small enough to report every candidate
 * individually, not just the top.
 *
 * I/O lives here (sqlite read, console report) per this project's own
 * layering rule — packages/research stays pure, no I/O.
 */
import { readOHLCV, validateDataIntegrity, type MarketConfig, type OHLCVBar } from "@sol-edge/database";
import { validateStrategy, type BoolExpr, type CompactCandle, type StrategyDSL } from "@sol-edge/core";
import {
  describeStrategy,
  evaluateCandidate,
  computeFeatures,
  planWalkForward,
  evaluateHoldoutOnce,
  isSignificant,
  DEFAULT_SIM_CONFIG,
  DEFAULT_FRICTION_PARAMS,
  type RankedStrategy,
} from "@sol-edge/research";
import marketConfig from "../../../config/market.json";

const HOLDOUT_BARS = 2160; // 90 days, carved out FIRST, before any fold
const TRAIN_BARS = 2160; // 90 days
const TEST_BARS = 720; // 30 days
const STEP_BARS = 720; // 30 days
const LOOKBACKS = [10, 14, 20, 30, 50, 75, 100] as const;

function toBps(logReturn: number): number {
  return logReturn * 10000;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

function maxDrawdown(returns: readonly number[]): number {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const r of returns) {
    equity *= Math.exp(r);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > worst) worst = dd;
  }
  return worst;
}

/// LONG: enter close > breakout_high_N, exit close < breakout_high_N (negation).
/// SHORT: enter close < breakout_low_N, exit close > breakout_low_N (negation).
/// Price-vs-feature comparisons, not feature-vs-const — generateDepth1Strategies
/// doesn't cover this shape, so built directly here (only 14 candidates).
function buildCandidates(): { strategy: StrategyDSL; featureName: string; n: number }[] {
  const candidates: { strategy: StrategyDSL; featureName: string; n: number }[] = [];
  for (const n of LOOKBACKS) {
    const highFeature = `breakout_high_${n}`;
    const lowFeature = `breakout_low_${n}`;

    const longEntry: BoolExpr = { type: "gt", left: { type: "price", field: "close" }, right: { type: "feature", name: highFeature } };
    const longExit: BoolExpr = { type: "lt", left: { type: "price", field: "close" }, right: { type: "feature", name: highFeature } };
    const longStrategy: StrategyDSL = { side: "LONG", entry: longEntry, exit: longExit };
    validateStrategy(longStrategy);
    candidates.push({ strategy: longStrategy, featureName: highFeature, n });

    const shortEntry: BoolExpr = { type: "lt", left: { type: "price", field: "close" }, right: { type: "feature", name: lowFeature } };
    const shortExit: BoolExpr = { type: "gt", left: { type: "price", field: "close" }, right: { type: "feature", name: lowFeature } };
    const shortStrategy: StrategyDSL = { side: "SHORT", entry: shortEntry, exit: shortExit };
    validateStrategy(shortStrategy);
    candidates.push({ strategy: shortStrategy, featureName: lowFeature, n });
  }
  return candidates;
}

async function main() {
  const cfg = marketConfig as MarketConfig;

  // ── Read ONLY trades_resampled rows from the local store — no live endpoint call ──
  const rows = readOHLCV(cfg, "trades_resampled", 0, 9_999_999_999);
  const barDurationSeconds = 3600;
  const bars: OHLCVBar[] = rows.map((r) => ({ timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));

  const integrity = validateDataIntegrity(bars, barDurationSeconds); // throws on hard violations; gaps are a soft report
  console.log(`Integrity: ${integrity.barCount} bars, ${integrity.gaps.length} gap(s).`);
  for (const g of integrity.gaps) {
    console.log(
      `  gap after ${new Date(g.afterTimestamp * 1000).toISOString()} -> ${new Date(g.actualNextTimestamp * 1000).toISOString()} (${g.missingBars} missing bar(s))`,
    );
  }

  const candles: CompactCandle[] = bars.map((b) => ({ timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close }));
  console.log(`Series: ${candles.length} bars [${new Date(candles[0].timestamp * 1000).toISOString()} .. ${new Date(candles[candles.length - 1].timestamp * 1000).toISOString()}]`);

  const holdoutCandles = candles.slice(candles.length - HOLDOUT_BARS);
  const walkForwardPool = candles.slice(0, candles.length - HOLDOUT_BARS);
  console.log(
    `Holdout (locked, touch-once): ${holdoutCandles.length} bars [${new Date(holdoutCandles[0].timestamp * 1000).toISOString()} .. ${new Date(holdoutCandles[holdoutCandles.length - 1].timestamp * 1000).toISOString()}]`,
  );
  console.log(`Walk-forward pool (everything before the holdout): ${walkForwardPool.length} bars.`);

  const plan = planWalkForward(walkForwardPool, TRAIN_BARS, TEST_BARS, STEP_BARS);
  console.log(
    `Walk-forward (${TRAIN_BARS}h train / ${TEST_BARS}h test / ${STEP_BARS}h step): ${plan.folds.length} fold(s). Unused tail: ${plan.holdout.length} bars.\n`,
  );

  const built = buildCandidates();
  const candidates = built.map((b) => b.strategy);
  console.log(`Committed search space: ${candidates.length} candidates (pre-registered, docs/preregistration/10C-004-breakout-momentum.md).`);
  if (candidates.length !== 14) {
    throw new Error(`search-10c-4: candidate count mismatch — expected exactly 14, got ${candidates.length}.`);
  }
  console.log(`Sanity check: candidate count == 14 confirmed.\n`);

  const allFeatureKeys = Array.from(new Set(built.map((b) => b.featureName)));
  const pooledReturns: number[][] = candidates.map(() => []);

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

    console.log(`  Fold ${foldIndex}: best OOS expectancy ${toBps(bestExpectancy).toFixed(2)}bps/trade (${bestTrades} trades) — ${describeStrategy(candidates[bestIdx])}`);
  });

  // ── All 14 candidates individually, ranked by pooled OOS expectancy ──
  const ranked: RankedStrategy[] = candidates.map((strategy, i) => {
    const returns = pooledReturns[i];
    const testStats = {
      strategySignature: "",
      totalTrades: returns.length,
      kernelExpectancy: 0,
      simulatedExpectancy: mean(returns),
      maxDrawdownSimulated: maxDrawdown(returns),
    };
    return { strategy, trainStats: testStats, testStats, trials: candidates.length, testReturns: returns };
  });
  ranked.sort((a, b) => b.testStats.simulatedExpectancy - a.testStats.simulatedExpectancy);

  console.log(`\n── All ${candidates.length} candidates, ranked by pooled OOS expectancy ──`);
  ranked.forEach((r, rank) => {
    console.log(
      `  #${rank + 1}: ${toBps(r.testStats.simulatedExpectancy).toFixed(2)}bps/trade (${r.testStats.totalTrades} trades, max DD ${(r.testStats.maxDrawdownSimulated * 100).toFixed(2)}%) — ${describeStrategy(r.strategy)}`,
    );
  });

  const top = ranked[0];
  const significant = isSignificant(top);

  console.log(`\n── Top-ranked candidate (by pooled OOS expectancy across all ${plan.folds.length} folds) ──`);
  console.log(`  Rule: ${describeStrategy(top.strategy)}`);
  console.log(`  Pooled OOS expectancy: ${toBps(top.testStats.simulatedExpectancy).toFixed(2)}bps/trade (${top.testStats.totalTrades} trades)`);
  console.log(`  Pooled OOS max drawdown: ${(top.testStats.maxDrawdownSimulated * 100).toFixed(2)}%`);
  console.log(`  Trials (committed N): ${top.trials}`);
  console.log(`  Significant (DSR >= 0.95, min 10 pooled OOS trades): ${significant}`);

  if (significant) {
    console.log(`\n── HOLDOUT (touched once, final honest estimate) ──`);
    const holdoutSplit = { train: walkForwardPool, test: [], holdout: holdoutCandles };
    const holdoutResult = evaluateHoldoutOnce(top.strategy, holdoutSplit, DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS);
    console.log(`  Holdout expectancy: ${toBps(holdoutResult.simulatedExpectancy).toFixed(2)}bps/trade (${holdoutResult.totalTrades} trades) — DO NOT RE-RUN.`);
    console.log(`  Holdout max drawdown: ${(holdoutResult.maxDrawdownSimulated * 100).toFixed(2)}%`);
  } else {
    console.log(`\nNo candidate cleared significance at the committed budget (14 trials, DSR >= 0.95, min 10 pooled OOS trades). This is a valid, complete null result — the holdout is NOT touched.`);
  }
}

main();
