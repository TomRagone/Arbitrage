/**
 * Phase 10C — committed search #3. Extends the hypothesis class beyond
 * depth-1 (10C-001/002, both null): depth-2 cross-feature conjunctions of
 * rsi_14 and ema_ratio_20 (a trend-context condition confirming a
 * mean-reversion trigger, or vice versa). Pre-registration record:
 * docs/preregistration/10C-003-depth2-conjunctions.md (committed before
 * this ran). Not a re-roll of 10C-002's null — that stands as the answer
 * for the depth-1 question at its budget.
 *
 * Same process as 10C-002: reads ONLY source = 'trades_resampled' from the
 * local sqlite store, carves the most recent 2,160 bars as a touch-once
 * holdout before any fold, walk-forwards the remainder (8 folds), and
 * ranks by pooled cross-fold OOS expectancy for the significance call.
 *
 * I/O lives here (sqlite read, console report) per this project's own
 * layering rule — packages/research stays pure, no I/O.
 */
import { readOHLCV, validateDataIntegrity, type MarketConfig, type OHLCVBar } from "@sol-edge/database";
import type { CompactCandle, StrategyDSL } from "@sol-edge/core";
import {
  linearGrid,
  generateDepth2CrossFeatureStrategies,
  describeStrategy,
  evaluateCandidate,
  computeFeatures,
  planWalkForward,
  evaluateHoldoutOnce,
  isSignificant,
  DEFAULT_SIM_CONFIG,
  DEFAULT_FRICTION_PARAMS,
  type Depth1Feature,
  type RankedStrategy,
} from "@sol-edge/research";
import marketConfig from "../../../config/market.json";
import path from "path";
import { writeSearchResultJson } from "./lib/searchResultJson";

const PREREG_DIR = path.join(process.cwd(), "..", "..", "docs", "preregistration");
const FEATURE_KEYS = ["rsi_14", "ema_ratio_20"];
const HOLDOUT_BARS = 2160; // 90 days, carved out FIRST, before any fold
const TRAIN_BARS = 2160; // 90 days
const TEST_BARS = 720; // 30 days
const STEP_BARS = 720; // 30 days

function toBps(logReturn: number): number {
  return logReturn * 10000;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

/// Same fixed-ledger-order max-drawdown logic as run.ts's runStrategyExecution
/// (not exported from there), applied here to a POOLED, chronologically
/// concatenated cross-fold return series.
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

  // ── Holdout carved out FIRST, before any fold is constructed ──
  const holdoutCandles = candles.slice(candles.length - HOLDOUT_BARS);
  const walkForwardPool = candles.slice(0, candles.length - HOLDOUT_BARS);
  console.log(
    `Holdout (locked, touch-once): ${holdoutCandles.length} bars [${new Date(holdoutCandles[0].timestamp * 1000).toISOString()} .. ${new Date(holdoutCandles[holdoutCandles.length - 1].timestamp * 1000).toISOString()}]`,
  );
  console.log(`Walk-forward pool (everything before the holdout): ${walkForwardPool.length} bars.`);

  const plan = planWalkForward(walkForwardPool, TRAIN_BARS, TEST_BARS, STEP_BARS);
  console.log(
    `Walk-forward (${TRAIN_BARS}h train / ${TEST_BARS}h test / ${STEP_BARS}h step): ${plan.folds.length} fold(s). Unused tail of the walk-forward pool (too short for a 9th fold, NOT the real holdout): ${plan.holdout.length} bars.`,
  );

  const rsi: Depth1Feature = { name: "rsi_14", thresholds: linearGrid(20, 80, 25) };
  const emaRatio: Depth1Feature = { name: "ema_ratio_20", thresholds: linearGrid(0.98, 1.02, 41) };
  const candidates = generateDepth2CrossFeatureStrategies(rsi, emaRatio, ["LONG", "SHORT"]);
  console.log(`\nCommitted search space: ${candidates.length} candidates (pre-registered, docs/preregistration/10C-003-depth2-conjunctions.md).`);
  if (candidates.length !== 8200) {
    throw new Error(`search-10c-3: candidate count mismatch — expected exactly 8200, got ${candidates.length}. Aborting per the pre-registered sanity check.`);
  }
  console.log(`Sanity check: candidate count == 8200 confirmed.\n`);

  // ── Single pass: evaluate every candidate on every fold once. Each
  // fold's test results both (a) produce that fold's per-fold diagnostic
  // best, and (b) are pooled (chronologically concatenated, folds are
  // non-overlapping and time-ordered) into that candidate's cross-fold OOS
  // return series — the significance-bearing evaluation for this design. ──
  const pooledReturns: number[][] = candidates.map(() => []);
  const perFoldRecords: { fold: number; expectancyBps: number; trades: number; rule: string }[] = [];

  console.log(`── Per-fold OOS results ──`);
  plan.folds.forEach((fold, foldIndex) => {
    const fullSeries = [...fold.train, ...fold.test];
    const trainFeatures = computeFeatures(fold.train, fullSeries, FEATURE_KEYS);
    const testFeatures = computeFeatures(fold.test, fullSeries, FEATURE_KEYS);

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

    perFoldRecords.push({ fold: foldIndex, expectancyBps: toBps(bestExpectancy), trades: bestTrades, rule: describeStrategy(candidates[bestIdx]) });
    console.log(`  Fold ${foldIndex}: best OOS expectancy ${toBps(bestExpectancy).toFixed(2)}bps/trade (${bestTrades} trades) — ${describeStrategy(candidates[bestIdx])}`);
  });

  // ── Full enumerated search's top candidate: ranked by pooled OOS expectancy across all 8 folds ──
  const ranked: RankedStrategy[] = candidates.map((strategy, i) => {
    const returns = pooledReturns[i];
    const testStats = {
      strategySignature: "",
      totalTrades: returns.length,
      kernelExpectancy: 0, // not tracked at the pooled level — diagnostic-only field, unused for ranking/significance
      simulatedExpectancy: mean(returns),
      maxDrawdownSimulated: maxDrawdown(returns),
    };
    return {
      strategy,
      trainStats: testStats, // no separate train segment at the pooled level in this design; unused by isSignificant
      testStats,
      trials: candidates.length,
      testReturns: returns,
    };
  });
  ranked.sort((a, b) => b.testStats.simulatedExpectancy - a.testStats.simulatedExpectancy);

  const top = ranked[0];
  const significant = isSignificant(top);

  console.log(`\n── Top-ranked candidate (by pooled OOS expectancy across all ${plan.folds.length} folds) ──`);
  console.log(`  Rule: ${describeStrategy(top.strategy)}`);
  console.log(`  Pooled OOS expectancy: ${toBps(top.testStats.simulatedExpectancy).toFixed(2)}bps/trade (${top.testStats.totalTrades} trades)`);
  console.log(`  Pooled OOS max drawdown: ${(top.testStats.maxDrawdownSimulated * 100).toFixed(2)}%`);
  console.log(`  Trials (committed N): ${top.trials}`);
  console.log(`  Significant (DSR >= 0.95, min 10 pooled OOS trades): ${significant}`);

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
    console.log(
      `\nNo candidate cleared significance at the committed budget (8200 trials, DSR >= 0.95, min 10 pooled OOS trades). This is a valid, complete null result — the holdout is NOT touched.`,
    );
  }

  writeSearchResultJson(
    "10C-003-depth2-conjunctions",
    {
      runId: "10C-003",
      trials: top.trials,
      significant,
      perFold: perFoldRecords,
      topCandidate: {
        label: describeStrategy(top.strategy),
        pooledExpectancyBps: toBps(top.testStats.simulatedExpectancy),
        pooledTrades: top.testStats.totalTrades,
        maxDrawdownPct: top.testStats.maxDrawdownSimulated * 100,
      },
      topCandidateReturns: top.testReturns,
      holdout: holdoutJson,
    },
    PREREG_DIR,
  );
}

main();
