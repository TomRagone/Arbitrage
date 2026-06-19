/**
 * Phase 10C — committed search #5. Derived directly from 10C-004's
 * post-hoc diagnostic: does requiring a confirmation condition (rsi_14 or
 * ema_ratio_20) alongside a breakout (10C-004's close-vs-breakout-level
 * conditions) remove the immediate-reversal whipsaw churn observed there
 * (median holding period 1 bar)? Pre-registration record:
 * docs/preregistration/10C-005-breakout-confirmed.md (committed before
 * this ran).
 *
 * Same process as 10C-002/003/004: reads ONLY source = 'trades_resampled'
 * from the local sqlite store, carves the most recent 2,160 bars as a
 * touch-once holdout before any fold, walk-forwards the remainder (8
 * folds), ranks by pooled cross-fold OOS expectancy.
 *
 * Search space: 14 breakout leaves (10C-004's 14 candidates, used as AND
 * legs) x 132 confirmation leaves (10C-003's rsi_14/ema_ratio_20 leaf
 * pool) = 1,848 candidates. Exit = De Morgan negation, same as 003/004.
 *
 * I/O lives here (sqlite read, console report) per this project's own
 * layering rule — packages/research stays pure, no I/O.
 */
import { readOHLCV, validateDataIntegrity, type MarketConfig, type OHLCVBar } from "@sol-edge/database";
import { validateStrategy, type BoolExpr, type CompactCandle, type StrategyDSL } from "@sol-edge/core";
import {
  linearGrid,
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
import { runAstKernel } from "@sol-edge/kernel";
import marketConfig from "../../../config/market.json";

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

function negate(leaf: BoolExpr): BoolExpr {
  if (leaf.type !== "gt" && leaf.type !== "lt") throw new Error("negate: expected a gt/lt leaf");
  return { type: leaf.type === "gt" ? "lt" : "gt", left: leaf.left, right: leaf.right };
}

interface BreakoutLeaf {
  expr: BoolExpr;
  side: "LONG" | "SHORT";
  featureName: string;
  label: string;
}

function buildBreakoutLeaves(): BreakoutLeaf[] {
  const leaves: BreakoutLeaf[] = [];
  for (const n of LOOKBACKS) {
    const highFeature = `breakout_high_${n}`;
    leaves.push({
      expr: { type: "gt", left: { type: "price", field: "close" }, right: { type: "feature", name: highFeature } },
      side: "LONG",
      featureName: highFeature,
      label: `close>${highFeature}`,
    });
    const lowFeature = `breakout_low_${n}`;
    leaves.push({
      expr: { type: "lt", left: { type: "price", field: "close" }, right: { type: "feature", name: lowFeature } },
      side: "SHORT",
      featureName: lowFeature,
      label: `close<${lowFeature}`,
    });
  }
  return leaves;
}

interface ConfirmationLeaf {
  expr: BoolExpr;
  featureName: string;
  label: string;
}

function buildConfirmationLeaves(): ConfirmationLeaf[] {
  const leaves: ConfirmationLeaf[] = [];
  const features: { name: string; thresholds: readonly number[] }[] = [
    { name: "rsi_14", thresholds: linearGrid(20, 80, 25) },
    { name: "ema_ratio_20", thresholds: linearGrid(0.98, 1.02, 41) },
  ];
  for (const feature of features) {
    for (const threshold of feature.thresholds) {
      for (const op of ["gt", "lt"] as const) {
        leaves.push({
          expr: { type: op, left: { type: "feature", name: feature.name }, right: { type: "const", value: threshold } },
          featureName: feature.name,
          label: `${feature.name}${op === "gt" ? ">" : "<"}${threshold}`,
        });
      }
    }
  }
  return leaves;
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

  // ── Build all 1,848 candidates ──
  const breakoutLeaves = buildBreakoutLeaves();
  const confirmationLeaves = buildConfirmationLeaves();
  const candidates: { strategy: StrategyDSL; label: string }[] = [];
  for (const b of breakoutLeaves) {
    for (const c of confirmationLeaves) {
      const entry: BoolExpr = { type: "and", left: b.expr, right: c.expr };
      const exit: BoolExpr = { type: "or", left: negate(b.expr), right: negate(c.expr) };
      const strategy: StrategyDSL = { side: b.side, entry, exit };
      validateStrategy(strategy);
      candidates.push({ strategy, label: `${b.side}: (${b.label} AND ${c.label})` });
    }
  }

  console.log(`Generated + validated candidates: ${candidates.length} (expected 1848)`);
  if (candidates.length !== 1848) {
    throw new Error(`search-10c-5: candidate count mismatch — expected exactly 1848, got ${candidates.length}. Aborting per the pre-registered sanity check.`);
  }
  console.log(`Sanity check: candidate count == 1848 confirmed.`);
  console.log(`Example candidates:`);
  console.log(`  [0]    ${describeStrategy(candidates[0].strategy)}`);
  const firstShortIdx = candidates.findIndex((c) => c.strategy.side === "SHORT");
  console.log(`  [SHORT example] ${describeStrategy(candidates[firstShortIdx].strategy)}`);
  console.log(`  [last] ${describeStrategy(candidates[candidates.length - 1].strategy)}\n`);

  const allFeatureKeys = Array.from(
    new Set([...breakoutLeaves.map((b) => b.featureName), ...confirmationLeaves.map((c) => c.featureName)]),
  );

  const strategies = candidates.map((c) => c.strategy);
  const pooledReturns: number[][] = strategies.map(() => []);

  console.log(`── Per-fold OOS results ──`);
  plan.folds.forEach((fold, foldIndex) => {
    const fullSeries = [...fold.train, ...fold.test];
    const trainFeatures = computeFeatures(fold.train, fullSeries, allFeatureKeys);
    const testFeatures = computeFeatures(fold.test, fullSeries, allFeatureKeys);

    let bestIdx = -1;
    let bestExpectancy = -Infinity;
    let bestTrades = 0;

    strategies.forEach((strategy, i) => {
      const { testStats, testReturns } = evaluateCandidate(strategy, fold.train, trainFeatures, fold.test, testFeatures, DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS);
      pooledReturns[i].push(...testReturns);
      if (testStats.simulatedExpectancy > bestExpectancy) {
        bestExpectancy = testStats.simulatedExpectancy;
        bestIdx = i;
        bestTrades = testStats.totalTrades;
      }
    });

    console.log(`  Fold ${foldIndex}: best OOS expectancy ${toBps(bestExpectancy).toFixed(2)}bps/trade (${bestTrades} trades) — ${candidates[bestIdx].label}`);
  });

  const ranked: (RankedStrategy & { label: string })[] = strategies.map((strategy, i) => {
    const returns = pooledReturns[i];
    const testStats = {
      strategySignature: "",
      totalTrades: returns.length,
      kernelExpectancy: 0,
      simulatedExpectancy: mean(returns),
      maxDrawdownSimulated: maxDrawdown(returns),
    };
    return { strategy, trainStats: testStats, testStats, trials: strategies.length, testReturns: returns, label: candidates[i].label };
  });
  ranked.sort((a, b) => b.testStats.simulatedExpectancy - a.testStats.simulatedExpectancy);

  console.log(`\n── Top 10 candidates, ranked by pooled OOS expectancy (of ${ranked.length} total) ──`);
  ranked.slice(0, 10).forEach((r, rank) => {
    console.log(
      `  #${rank + 1}: ${toBps(r.testStats.simulatedExpectancy).toFixed(2)}bps/trade (${r.testStats.totalTrades} trades, max DD ${(r.testStats.maxDrawdownSimulated * 100).toFixed(2)}%) — ${r.label}`,
    );
  });

  // ── Honesty check: the raw top-10 are dominated by 1-2 trade flukes
  // (same sparsity problem 10C-003 had). Separately surface the
  // best-by-expectancy among candidates with an actually meaningful
  // sample size, so "confirmation fixes whipsaw" gets a fair look rather
  // than being judged on noise. ──
  const sufficientlyTraded = ranked.filter((r) => r.testStats.totalTrades >= 10);
  console.log(`\n── Among candidates with >=10 pooled OOS trades (${sufficientlyTraded.length} of ${ranked.length} qualify) ──`);
  if (sufficientlyTraded.length === 0) {
    console.log(`  None. Every candidate in this 1,848-strategy space has fewer than 10 pooled OOS trades — the AND conjunction is too restrictive for any candidate here to be evaluable at all, let alone significant.`);
  } else {
    sufficientlyTraded.slice(0, 5).forEach((r, rank) => {
      console.log(
        `  #${rank + 1}: ${toBps(r.testStats.simulatedExpectancy).toFixed(2)}bps/trade (${r.testStats.totalTrades} trades, max DD ${(r.testStats.maxDrawdownSimulated * 100).toFixed(2)}%) — ${r.label}`,
      );
    });
  }

  const top = ranked[0];
  const significant = isSignificant(top);

  console.log(`\n── Top-ranked candidate ──`);
  console.log(`  Rule: ${top.label}`);
  console.log(`  Pooled OOS expectancy: ${toBps(top.testStats.simulatedExpectancy).toFixed(2)}bps/trade (${top.testStats.totalTrades} trades)`);
  console.log(`  Pooled OOS max drawdown: ${(top.testStats.maxDrawdownSimulated * 100).toFixed(2)}%`);
  console.log(`  Trials (committed N): ${top.trials}`);
  console.log(`  Significant (DSR >= 0.95, min 10 pooled OOS trades): ${significant}`);

  // ── Holding-period diagnostic on the top 3, regardless of significance (pre-registered) ──
  console.log(`\n── Holding-period diagnostic (top 3, vs. 10C-004's ~1.5-bar median) ──`);
  for (const r of ranked.slice(0, 3)) {
    const holdingPeriods: number[] = [];
    plan.folds.forEach((fold) => {
      const fullSeries = [...fold.train, ...fold.test];
      const testFeatures = computeFeatures(fold.test, fullSeries, allFeatureKeys);
      const trades = runAstKernel(r.strategy, fold.test, testFeatures);
      for (const trade of trades) holdingPeriods.push(trade.exitTime - trade.entryTime);
    });
    if (holdingPeriods.length === 0) {
      console.log(`  ${r.label}: 0 trades, no holding-period data.`);
      continue;
    }
    const meanHold = mean(holdingPeriods);
    const sorted = [...holdingPeriods].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const oneBarFraction = holdingPeriods.filter((h) => h === 1).length / holdingPeriods.length;
    console.log(`  ${r.label}: mean=${meanHold.toFixed(2)} median=${median} max=${sorted[sorted.length - 1]} (${(oneBarFraction * 100).toFixed(1)}% held exactly 1 bar)`);
  }

  if (significant) {
    console.log(`\n── HOLDOUT (touched once, final honest estimate) ──`);
    const holdoutSplit = { train: walkForwardPool, test: [], holdout: holdoutCandles };
    const holdoutResult = evaluateHoldoutOnce(top.strategy, holdoutSplit, DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS);
    console.log(`  Holdout expectancy: ${toBps(holdoutResult.simulatedExpectancy).toFixed(2)}bps/trade (${holdoutResult.totalTrades} trades) — DO NOT RE-RUN.`);
    console.log(`  Holdout max drawdown: ${(holdoutResult.maxDrawdownSimulated * 100).toFixed(2)}%`);
  } else {
    console.log(`\nNo candidate cleared significance at the committed budget (1848 trials, DSR >= 0.95, min 10 pooled OOS trades). This is a valid, complete null result — the holdout is NOT touched.`);
  }
}

main();
