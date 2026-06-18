export type { CompactCandle, ValueExpr, BoolExpr, StrategyDSL, RawTrade } from "./types";
export { evaluateBoolExpr, type EvalContext } from "./evaluator";
export { FEATURE_REGISTRY, type FeatureDefinition } from "./registry";
export { validateStrategy, CausalViolationException } from "./validator";
