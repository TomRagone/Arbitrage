import type { CompactCandle, StrategyDSL } from "@sol-edge/core";
import { FeatureEngine } from "@sol-edge/database";
import type { SimConfig, FrictionParams } from "@sol-edge/sim";
import { generateStrategies, type SearchSpace } from "./generator";
import { runStrategyExecution, type BacktestExecutionResult } from "./run";
import type { TemporalSplit } from "./split";

export interface RankedStrategy {
  readonly strategy: StrategyDSL;
  readonly trainStats: BacktestExecutionResult; // diagnostic only
  readonly testStats: BacktestExecutionResult; // SELECTION KEY
  readonly trials: number; // how many candidates were searched
}

// Defaults not specified by the given 3-arg signature (runSearch needs
// per-candle features and friction/risk assumptions to run the real
// validate->kernel->sim pipeline, neither of which space/seed/split alone
// provide). Same modest values already used and reasoned about throughout
// this phase's verify scripts — not new guesses.
const DEFAULT_COUNT = 200;
const DEFAULT_SIM_CONFIG: SimConfig = { alpha: 0.0005, beta: 0.1, gammaPanic: 1.5, kappaImpact: 0.02, fixedFeeRate: 0.0004 };
const DEFAULT_FRICTION_PARAMS: FrictionParams = { sigmaEntry: 0.02, sigmaExit: 0.02, quantity: 1000, adv: 1000000 };

/// Precomputes a features array for a candle segment, using the FULL
/// (train+test+holdout) series for causal lookback — a candle at the start
/// of test legitimately sees train's tail history (still strictly causal,
/// since train always precedes test in time); only this segment's own
/// candles are ever passed to the kernel for trading.
function computeFeatures(segment: readonly CompactCandle[], fullSeries: readonly CompactCandle[], featureKeys: readonly string[]): Record<string, number>[] {
  return segment.map((c) => {
    const record: Record<string, number> = {};
    for (const key of featureKeys) record[key] = FeatureEngine.getFeatureSlice(key, c.timestamp, fullSeries);
    return record;
  });
}

/// Single-candidate evaluation: run validate->kernel->sim on train, then
/// independently on test. Exported (beyond what the given signature
/// strictly required) because it's the directly-testable unit for "does
/// ranking actually use test stats" — runSearch is just this, looped and sorted.
export function evaluateCandidate(
  strategy: StrategyDSL,
  trainCandles: readonly CompactCandle[],
  trainFeatures: readonly Readonly<Record<string, number>>[],
  testCandles: readonly CompactCandle[],
  testFeatures: readonly Readonly<Record<string, number>>[],
  simConfig: SimConfig,
  frictionParams: FrictionParams,
): { trainStats: BacktestExecutionResult; testStats: BacktestExecutionResult } {
  const trainStats = runStrategyExecution(strategy, trainCandles, trainFeatures, simConfig, frictionParams);
  const testStats = runStrategyExecution(strategy, testCandles, testFeatures, simConfig, frictionParams);
  return { trainStats, testStats };
}

export function runSearch(
  space: SearchSpace,
  seed: number,
  split: TemporalSplit,
  count: number = DEFAULT_COUNT,
  simConfig: SimConfig = DEFAULT_SIM_CONFIG,
  frictionParams: FrictionParams = DEFAULT_FRICTION_PARAMS,
): readonly RankedStrategy[] {
  const candidates = generateStrategies(space, seed, count);

  // Features computed ONCE, shared across all candidates (they don't
  // depend on the strategy, only on candles + featureKeys) — not
  // recomputed per candidate.
  const fullSeries = [...split.train, ...split.test, ...split.holdout]; // holdout is NEVER passed to the kernel below, only used for causal feature lookback continuity
  const trainFeatures = computeFeatures(split.train, fullSeries, space.featureKeys);
  const testFeatures = computeFeatures(split.test, fullSeries, space.featureKeys);

  const ranked: RankedStrategy[] = candidates.map((strategy) => {
    const { trainStats, testStats } = evaluateCandidate(strategy, split.train, trainFeatures, split.test, testFeatures, simConfig, frictionParams);
    return { strategy, trainStats, testStats, trials: candidates.length };
  });

  // Rank by the OUT-OF-SAMPLE (test) objective only. In-sample (train)
  // stats are carried for diagnostics and are never part of the sort key.
  ranked.sort((a, b) => b.testStats.simulatedExpectancy - a.testStats.simulatedExpectancy);

  return ranked;
}
