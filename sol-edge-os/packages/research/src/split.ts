import { CausalViolationException, type CompactCandle } from "@sol-edge/core";

export interface TemporalSplit {
  readonly train: readonly CompactCandle[];
  readonly test: readonly CompactCandle[]; // selection key, out-of-sample
  readonly holdout: readonly CompactCandle[]; // touched exactly once, at the very end
}

/// Throws CausalViolationException if the three segments are not strictly
/// ordered in time with no overlap. A non-disjoint split is a causal
/// violation in the same sense as reading future data — it lets
/// information cross a boundary it's not supposed to cross. Exported
/// separately from splitChronological so it can validate any
/// TemporalSplit-shaped value, not just one this module produced.
export function assertNoOverlap(split: TemporalSplit): void {
  const maxTrain = split.train.length > 0 ? Math.max(...split.train.map((c) => c.timestamp)) : -Infinity;
  const minTest = split.test.length > 0 ? Math.min(...split.test.map((c) => c.timestamp)) : Infinity;
  const maxTest = split.test.length > 0 ? Math.max(...split.test.map((c) => c.timestamp)) : -Infinity;
  const minHoldout = split.holdout.length > 0 ? Math.min(...split.holdout.map((c) => c.timestamp)) : Infinity;

  if (split.train.length > 0 && split.test.length > 0 && !(maxTrain < minTest)) {
    throw new CausalViolationException(
      `splitChronological: train/test overlap or disorder — max(train.timestamp)=${maxTrain} is not < min(test.timestamp)=${minTest}`,
    );
  }
  if (split.test.length > 0 && split.holdout.length > 0 && !(maxTest < minHoldout)) {
    throw new CausalViolationException(
      `splitChronological: test/holdout overlap or disorder — max(test.timestamp)=${maxTest} is not < min(holdout.timestamp)=${minHoldout}`,
    );
  }
  if (split.test.length === 0 && split.train.length > 0 && split.holdout.length > 0 && !(maxTrain < minHoldout)) {
    throw new CausalViolationException(
      `splitChronological: train/holdout overlap or disorder (test empty) — max(train.timestamp)=${maxTrain} is not < min(holdout.timestamp)=${minHoldout}`,
    );
  }
}

/// Chronological split, no shuffling — the split itself is causal. Train
/// -> Test -> locked Holdout, strictly ordered in time. holdout = remainder.
export function splitChronological(candles: readonly CompactCandle[], trainFrac: number, testFrac: number): TemporalSplit {
  if (candles.length === 0) {
    throw new Error("splitChronological: candles must not be empty");
  }
  if (!(trainFrac > 0) || !(testFrac > 0)) {
    throw new Error(`splitChronological: trainFrac and testFrac must both be > 0, got trainFrac=${trainFrac}, testFrac=${testFrac}`);
  }
  if (trainFrac + testFrac >= 1) {
    throw new Error(`splitChronological: trainFrac + testFrac must be < 1 (holdout would be empty), got ${trainFrac + testFrac}`);
  }

  const trainEnd = Math.floor(candles.length * trainFrac);
  const testEnd = trainEnd + Math.floor(candles.length * testFrac);

  const split: TemporalSplit = {
    train: candles.slice(0, trainEnd),
    test: candles.slice(trainEnd, testEnd),
    holdout: candles.slice(testEnd),
  };

  assertNoOverlap(split); // defense in depth — catches malformed input (e.g. unsorted, duplicate boundary timestamps) too

  return split;
}
