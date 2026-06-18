import type { BoolExpr, CompactCandle, ValueExpr } from "./types";

export interface EvalContext {
  readonly candle: CompactCandle; // current bar (close[t] allowed)
  readonly features: Readonly<Record<string, number>>; // precomputed, causal
}

function resolveValue(expr: ValueExpr, ctx: EvalContext): number {
  switch (expr.type) {
    case "const":
      return expr.value;
    case "price":
      return ctx.candle[expr.field];
    case "feature": {
      const value = ctx.features[expr.name];
      if (value === undefined) {
        throw new Error(`evaluator: feature "${expr.name}" not present in context — fail loud, not silent`);
      }
      return value;
    }
  }
}

export function evaluateBoolExpr(expr: BoolExpr, ctx: EvalContext): boolean {
  switch (expr.type) {
    case "gt":
      return resolveValue(expr.left, ctx) > resolveValue(expr.right, ctx);
    case "lt":
      return resolveValue(expr.left, ctx) < resolveValue(expr.right, ctx);
    case "and":
      return evaluateBoolExpr(expr.left, ctx) && evaluateBoolExpr(expr.right, ctx);
    case "or":
      return evaluateBoolExpr(expr.left, ctx) || evaluateBoolExpr(expr.right, ctx);
  }
}
