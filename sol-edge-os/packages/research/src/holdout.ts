import { CausalViolationException, type BoolExpr, type StrategyDSL } from "@sol-edge/core";
import type { SimConfig, FrictionParams } from "@sol-edge/sim";
import { runStrategyExecution, type BacktestExecutionResult } from "./run";
import { computeFeatures, DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS } from "./search";
import type { TemporalSplit } from "./split";

// Module-level state: tracks whether the holdout has been consumed within
// this run (process). Deliberately not reset by anything — the whole
// point is that touching it twice is unrecoverable within a run, the same
// way a real holdout can't be "looked at twice" once the decision it
// informs has been made.
let consumed = false;

/// Walks a strategy's entry/exit trees and collects every feature name it
/// actually references — evaluateHoldoutOnce has no SearchSpace (the
/// given signature is just (selected, split)), so the features needed are
/// derived from the selected strategy's own AST, not a feature-key list.
function collectFeatureNames(expr: BoolExpr, out: Set<string>): void {
  if (expr.type === "and" || expr.type === "or") {
    collectFeatureNames(expr.left, out);
    collectFeatureNames(expr.right, out);
    return;
  }
  for (const side of [expr.left, expr.right]) {
    if (side.type === "feature") out.add(side.name);
  }
}

/// Evaluates ONLY the single selected strategy on the locked holdout —
/// the one honest, unbiased estimate, since holdout was never used for
/// selection (unlike train/test, which were used to rank/choose). Throws
/// CausalViolationException on any second call within this run, the same
/// way an overlapping temporal split throws (Step 9.1) — re-using the
/// holdout for a second look is the same class of violation: information
/// crossing a boundary it's not supposed to cross.
export function evaluateHoldoutOnce(
  selected: StrategyDSL,
  split: TemporalSplit,
  simConfig: SimConfig = DEFAULT_SIM_CONFIG,
  frictionParams: FrictionParams = DEFAULT_FRICTION_PARAMS,
): BacktestExecutionResult {
  if (consumed) {
    throw new CausalViolationException("evaluateHoldoutOnce: the holdout has already been evaluated once in this run — re-using it would turn it into another optimization target");
  }
  consumed = true;

  const featureNames = new Set<string>();
  collectFeatureNames(selected.entry, featureNames);
  collectFeatureNames(selected.exit, featureNames);

  const fullSeries = [...split.train, ...split.test, ...split.holdout]; // causal lookback continuity, same convention as runSearch
  const holdoutFeatures = computeFeatures(split.holdout, fullSeries, [...featureNames]);

  return runStrategyExecution(selected, split.holdout, holdoutFeatures, simConfig, frictionParams);
}
