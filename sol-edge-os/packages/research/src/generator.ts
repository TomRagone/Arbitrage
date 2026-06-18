import { FEATURE_REGISTRY, validateStrategy, type BoolExpr, type StrategyDSL, type ValueExpr } from "@sol-edge/core";

export interface SearchSpace {
  readonly featureKeys: readonly string[]; // must be subset of FEATURE_REGISTRY keys
  readonly maxDepth: number;
  readonly thresholdRange: readonly [number, number];
  readonly sides: readonly ("LONG" | "SHORT")[];
}

/// Deterministic seeded PRNG (mulberry32) — same implementation used
/// throughout this project's determinism tests (3.2, 8.1, 8.2, 8.4). No
/// Math.random, no Date.now.
function mulberry32(seed: number) {
  return function (): number {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function validateSearchSpace(space: SearchSpace): void {
  for (const key of space.featureKeys) {
    if (!(key in FEATURE_REGISTRY)) {
      throw new Error(`generateStrategies: SearchSpace.featureKeys contains "${key}", which is not in FEATURE_REGISTRY`);
    }
  }
  if (!(space.maxDepth >= 1)) throw new Error(`generateStrategies: maxDepth must be >= 1, got ${space.maxDepth}`);
  if (!(space.thresholdRange[0] < space.thresholdRange[1])) {
    throw new Error(`generateStrategies: thresholdRange must be [min,max) with min < max, got ${JSON.stringify(space.thresholdRange)}`);
  }
  if (space.sides.length === 0) throw new Error("generateStrategies: SearchSpace.sides must not be empty");
}

const PRICE_FIELDS = ["open", "high", "low", "close"] as const;

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randomThreshold(rng: () => number, range: readonly [number, number]): number {
  return range[0] + rng() * (range[1] - range[0]);
}

function generateValueExpr(rng: () => number, space: SearchSpace): ValueExpr {
  // Feature nodes draw ONLY from space.featureKeys (itself a validated
  // subset of FEATURE_REGISTRY) — never an arbitrary string. If
  // featureKeys is empty, "feature" is simply never chosen.
  const options: Array<"const" | "price" | "feature"> = space.featureKeys.length > 0 ? ["const", "price", "feature"] : ["const", "price"];
  const kind = pick(rng, options);
  switch (kind) {
    case "const":
      return { type: "const", value: randomThreshold(rng, space.thresholdRange) };
    case "price":
      return { type: "price", field: pick(rng, PRICE_FIELDS) };
    case "feature":
      return { type: "feature", name: pick(rng, space.featureKeys) };
  }
}

/// Bounded-depth recursive generation. depthRemaining reaching 0 forces a
/// leaf comparison (gt/lt) — guarantees termination, no unbounded trees.
function generateBoolExpr(rng: () => number, space: SearchSpace, depthRemaining: number): BoolExpr {
  const canRecurse = depthRemaining > 0;
  const useCombinator = canRecurse && rng() < 0.4;
  if (useCombinator) {
    return {
      type: pick(rng, ["and", "or"] as const),
      left: generateBoolExpr(rng, space, depthRemaining - 1),
      right: generateBoolExpr(rng, space, depthRemaining - 1),
    };
  }
  return {
    type: pick(rng, ["gt", "lt"] as const),
    left: generateValueExpr(rng, space),
    right: generateValueExpr(rng, space),
  };
}

/// Deterministic, seeded generation of valid bounded-depth StrategyDSL
/// trees. Every emitted strategy passes validateStrategy by construction
/// (feature nodes only ever draw from the registry-checked search space).
/// validateStrategy is still called on each one before returning — defense
/// in depth, same reasoning as splitChronological's internal
/// assertNoOverlap call: cheap, and catches any future change to this
/// generator that accidentally breaks the by-construction guarantee.
export function generateStrategies(space: SearchSpace, seed: number, count: number): readonly StrategyDSL[] {
  validateSearchSpace(space);
  if (!(count >= 0)) throw new Error(`generateStrategies: count must be >= 0, got ${count}`);

  const rng = mulberry32(seed);
  const strategies: StrategyDSL[] = [];
  for (let i = 0; i < count; i++) {
    const strategy: StrategyDSL = {
      side: pick(rng, space.sides),
      entry: generateBoolExpr(rng, space, space.maxDepth - 1),
      exit: generateBoolExpr(rng, space, space.maxDepth - 1),
    };
    validateStrategy(strategy);
    strategies.push(strategy);
  }
  return strategies;
}
