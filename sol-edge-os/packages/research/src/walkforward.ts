import { CausalViolationException, type CompactCandle } from "@sol-edge/core";

export interface WalkForwardFold {
  readonly train: readonly CompactCandle[];
  readonly test: readonly CompactCandle[];
}

export interface WalkForwardPlan {
  readonly folds: readonly WalkForwardFold[];
  readonly holdout: readonly CompactCandle[]; // touched once, after the final fold
}

/// Throws CausalViolationException unless every fold is causal (its test
/// strictly follows its own train, no overlap) and the holdout strictly
/// follows every fold's test window. Exported separately so it can
/// validate any WalkForwardPlan-shaped value, not just one this module
/// produced (lets the verify hand it a deliberately-broken plan). Same
/// "a non-disjoint temporal partition is a causal violation" reasoning as
/// split.ts (9.1).
export function assertWalkForwardCausal(plan: WalkForwardPlan): void {
  let maxTestTsAcrossFolds = -Infinity;

  for (let k = 0; k < plan.folds.length; k++) {
    const { train, test } = plan.folds[k];
    if (train.length === 0) throw new CausalViolationException(`planWalkForward: fold ${k} has an empty train window`);
    if (test.length === 0) throw new CausalViolationException(`planWalkForward: fold ${k} has an empty test window`);

    const maxTrain = Math.max(...train.map((c) => c.timestamp));
    const minTest = Math.min(...test.map((c) => c.timestamp));
    if (!(maxTrain < minTest)) {
      throw new CausalViolationException(
        `planWalkForward: fold ${k} not causal — max(train.timestamp)=${maxTrain} is not < min(test.timestamp)=${minTest} (test must strictly follow train)`,
      );
    }
    maxTestTsAcrossFolds = Math.max(maxTestTsAcrossFolds, Math.max(...test.map((c) => c.timestamp)));
  }

  if (plan.holdout.length > 0 && plan.folds.length > 0) {
    const minHoldout = Math.min(...plan.holdout.map((c) => c.timestamp));
    if (!(maxTestTsAcrossFolds < minHoldout)) {
      throw new CausalViolationException(
        `planWalkForward: holdout not after all folds — max fold test.timestamp=${maxTestTsAcrossFolds} is not < min(holdout.timestamp)=${minHoldout}`,
      );
    }
  }
}

/// Marching folds: fold k = train window of `trainBars` immediately
/// followed by a test window of `testBars`, with the window advancing by
/// `step` bars each fold. Rolling (fixed-size) train, because `trainBars`
/// is a fixed cap — an expanding-train variant would ignore it, so it is a
/// deliberate non-choice here. A fold is emitted while its full
/// (train+test) span fits within the data; the holdout is the remainder
/// strictly after the final fold's test window — evaluated exactly once,
/// later (Step 9.8's evaluateHoldoutOnce).
export function planWalkForward(candles: readonly CompactCandle[], trainBars: number, testBars: number, step: number): WalkForwardPlan {
  if (!Number.isInteger(trainBars) || trainBars < 1) throw new Error(`planWalkForward: trainBars must be a positive integer, got ${trainBars}`);
  if (!Number.isInteger(testBars) || testBars < 1) throw new Error(`planWalkForward: testBars must be a positive integer, got ${testBars}`);
  if (!Number.isInteger(step) || step < 1) throw new Error(`planWalkForward: step must be a positive integer, got ${step}`);

  const foldSpan = trainBars + testBars;
  if (candles.length < foldSpan) {
    throw new Error(`planWalkForward: not enough candles (${candles.length}) to form even one fold of trainBars+testBars=${foldSpan}`);
  }

  const folds: WalkForwardFold[] = [];
  let lastTestEnd = 0;
  for (let start = 0; start + foldSpan <= candles.length; start += step) {
    const trainEnd = start + trainBars;
    const testEnd = trainEnd + testBars;
    folds.push({ train: candles.slice(start, trainEnd), test: candles.slice(trainEnd, testEnd) });
    lastTestEnd = testEnd;
  }

  // Holdout = everything strictly after the final fold's test window.
  const holdout = candles.slice(lastTestEnd);

  const plan: WalkForwardPlan = { folds, holdout };
  assertWalkForwardCausal(plan); // defense in depth, catches malformed/unsorted input too
  return plan;
}
