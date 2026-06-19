import { validateStrategy, type BoolExpr, type StrategyDSL } from "@sol-edge/core";

export interface Depth1Feature {
  readonly name: string; // must be a FEATURE_REGISTRY key — validateStrategy enforces this per-candidate
  readonly thresholds: readonly number[];
}

/// Inclusive linear grid of `count` values from `min` to `max`.
export function linearGrid(min: number, max: number, count: number): readonly number[] {
  if (!(count >= 2)) throw new Error(`linearGrid: count must be >= 2, got ${count}`);
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

/// Exhaustive enumeration of every depth-1 (feature gt/lt const) x side
/// candidate over the given features/thresholds — no sampling, no seed.
/// Exit is NOT searched: it's mechanically derived from each candidate's
/// own entry by negating the comparison (gt<->lt) on the same feature and
/// threshold, e.g. entry "rsi_14 < 30" -> exit "rsi_14 > 30". This adds
/// zero extra degrees of freedom (Phase 10C pre-registration: exit
/// searched = N, fixed rule = mechanical negation).
export function generateDepth1Strategies(features: readonly Depth1Feature[], sides: readonly ("LONG" | "SHORT")[]): readonly StrategyDSL[] {
  const candidates: StrategyDSL[] = [];

  for (const feature of features) {
    for (const threshold of feature.thresholds) {
      for (const op of ["gt", "lt"] as const) {
        const negatedOp = op === "gt" ? "lt" : "gt";
        const entry: BoolExpr = { type: op, left: { type: "feature", name: feature.name }, right: { type: "const", value: threshold } };
        const exit: BoolExpr = { type: negatedOp, left: { type: "feature", name: feature.name }, right: { type: "const", value: threshold } };

        for (const side of sides) {
          const strategy: StrategyDSL = { side, entry, exit };
          validateStrategy(strategy);
          candidates.push(strategy);
        }
      }
    }
  }

  return candidates;
}

/// Human-readable rendering of a depth-1 strategy generated above — for
/// reporting only, not re-parsed by anything.
export function describeStrategy(strategy: StrategyDSL): string {
  function describeBoolExpr(expr: BoolExpr): string {
    if (expr.type !== "gt" && expr.type !== "lt") return JSON.stringify(expr); // not depth-1; fall back rather than guess
    const left = expr.left.type === "feature" ? expr.left.name : expr.left.type === "const" ? expr.left.value : expr.left.field;
    const right = expr.right.type === "feature" ? expr.right.name : expr.right.type === "const" ? expr.right.value : expr.right.field;
    return `${left} ${expr.type === "gt" ? ">" : "<"} ${right}`;
  }
  return `${strategy.side}: enter when ${describeBoolExpr(strategy.entry)}, exit when ${describeBoolExpr(strategy.exit)}`;
}
