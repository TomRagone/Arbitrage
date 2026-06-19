/**
 * Phase 10C — the real pre-registered search. Pre-registration record:
 * docs/preregistration/10C-depth1-rsi-ema.md (committed before this ran).
 * Single committed search, run once: ENUMERATE the full 264-candidate
 * depth-1 grid (rsi_14, ema_ratio_20), no sampling, no re-rolling on the
 * result. A null result is the answer at this budget.
 *
 * I/O lives here (ingest, sqlite read, console report) per this project's
 * own layering rule — packages/research stays pure, no I/O.
 */
import { ingestOHLCV, readOHLCV, validateDataIntegrity, segmentAtGaps, type MarketConfig, type OHLCVBar } from "@sol-edge/database";
import type { CompactCandle } from "@sol-edge/core";
import {
  linearGrid,
  generateDepth1Strategies,
  describeStrategy,
  rankCandidates,
  splitChronological,
  planWalkForward,
  evaluateHoldoutOnce,
  isSignificant,
  DEFAULT_SIM_CONFIG,
  DEFAULT_FRICTION_PARAMS,
  type Depth1Feature,
} from "@sol-edge/research";
import marketConfig from "../../../config/market.json";

const FEATURE_KEYS = ["rsi_14", "ema_ratio_20"];
const TRAIN_BARS = 480; // 20 days at 1h
const TEST_BARS = 120; // 5 days at 1h
const STEP_BARS = 120;

function toBps(logReturn: number): number {
  return logReturn * 10000;
}

async function main() {
  const cfg = marketConfig as MarketConfig;
  const toTs = Math.floor(Date.now() / 1000);
  const fromTs = toTs - 3 * 365 * 86400; // ask for 3 years; Kraken returns whatever it actually has (~720 bars for this pair, confirmed in the pre-registration record)

  console.log(`Ingesting ${cfg.exchange}/${cfg.pair}/${cfg.resolution}...`);
  const ingestResult = await ingestOHLCV(cfg, fromTs, toTs);
  console.log(`  Ingested/verified ${ingestResult.count} bars.`);

  const rows = readOHLCV(cfg, "ohlc", fromTs, toTs);
  const barDurationSeconds = 3600;
  const bars: OHLCVBar[] = rows.map((r) => ({ timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));

  const integrity = validateDataIntegrity(bars, barDurationSeconds); // throws on hard violations; gaps are a soft report
  console.log(`  Integrity: ${integrity.barCount} bars, ${integrity.gaps.length} gap(s).`);

  const segments = segmentAtGaps(bars, barDurationSeconds);
  const longest = segments.reduce((best, s) => (s.endIndex - s.startIndex > best.endIndex - best.startIndex ? s : best));
  const segmentBars = bars.slice(longest.startIndex, longest.endIndex + 1);
  console.log(`  Longest gap-free segment: ${segmentBars.length} bars [${new Date(segmentBars[0].timestamp * 1000).toISOString()} .. ${new Date(segmentBars[segmentBars.length - 1].timestamp * 1000).toISOString()}]`);

  const candles: CompactCandle[] = segmentBars.map((b) => ({ timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close }));

  const features: Depth1Feature[] = [
    { name: "rsi_14", thresholds: linearGrid(20, 80, 25) },
    { name: "ema_ratio_20", thresholds: linearGrid(0.98, 1.02, 41) },
  ];
  const candidates = generateDepth1Strategies(features, ["LONG", "SHORT"]);
  console.log(`\nCommitted search space: ${candidates.length} candidates (pre-registered as 264 in docs/preregistration/10C-depth1-rsi-ema.md).\n`);

  // ── Walk-forward diagnostic (per-fold stability, not itself the significance claim) ──
  let walkForwardFolds: ReturnType<typeof planWalkForward>["folds"] = [];
  try {
    const plan = planWalkForward(candles, TRAIN_BARS, TEST_BARS, STEP_BARS);
    walkForwardFolds = plan.folds;
  } catch (err) {
    console.log(`  Walk-forward: ${(err as Error).message}`);
  }

  console.log(`── Walk-forward (${TRAIN_BARS}h train / ${TEST_BARS}h test / ${STEP_BARS}h step): ${walkForwardFolds.length} real fold(s) ──`);
  walkForwardFolds.forEach((fold, i) => {
    const ranked = rankCandidates(candidates, { train: fold.train, test: fold.test, holdout: [] }, FEATURE_KEYS, DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS);
    const best = ranked[0];
    console.log(
      `  Fold ${i}: best OOS expectancy ${toBps(best.testStats.simulatedExpectancy).toFixed(2)}bps/trade (${best.testStats.totalTrades} trades) — ${describeStrategy(best.strategy)}`,
    );
  });
  if (walkForwardFolds.length === 0) {
    console.log(`  (Not enough real history for even one ${TRAIN_BARS + TEST_BARS}-bar fold — see pre-registration record.)`);
  }

  // ── Single 60/20/20 chronological split — the significance-testing run ──
  console.log(`\n── 60/20/20 chronological split (${candles.length} bars) ──`);
  const split = splitChronological(candles, 0.6, 0.2);
  console.log(`  train=${split.train.length} test=${split.test.length} holdout=${split.holdout.length}`);

  const ranked = rankCandidates(candidates, split, FEATURE_KEYS, DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS);
  const top = ranked[0];
  const significant = isSignificant(top);

  console.log(`\n── Top-ranked candidate (by OOS expectancy) ──`);
  console.log(`  Rule: ${describeStrategy(top.strategy)}`);
  console.log(`  Train expectancy (diagnostic only): ${toBps(top.trainStats.simulatedExpectancy).toFixed(2)}bps/trade (${top.trainStats.totalTrades} trades)`);
  console.log(`  Test (OOS) expectancy:               ${toBps(top.testStats.simulatedExpectancy).toFixed(2)}bps/trade (${top.testStats.totalTrades} trades)`);
  console.log(`  Test (OOS) max drawdown:              ${(top.testStats.maxDrawdownSimulated * 100).toFixed(2)}%`);
  console.log(`  Trials (committed N):                 ${top.trials}`);
  console.log(`  Significant (DSR >= 0.95, min 10 OOS trades): ${significant}`);

  if (significant) {
    console.log(`\n── HOLDOUT (touched once, final honest estimate) ──`);
    const holdoutResult = evaluateHoldoutOnce(top.strategy, split, DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS);
    console.log(`  Holdout expectancy: ${toBps(holdoutResult.simulatedExpectancy).toFixed(2)}bps/trade (${holdoutResult.totalTrades} trades)`);
    console.log(`  Holdout max drawdown: ${(holdoutResult.maxDrawdownSimulated * 100).toFixed(2)}%`);
  } else {
    console.log(`\nNo candidate cleared significance at the committed budget (264 trials, DSR >= 0.95, min 10 OOS trades). This is a valid, complete null result — the holdout is NOT touched (it's reserved for a selected strategy only).`);
  }
}

main();
