export { generateStrategies, type SearchSpace } from "./generator";
export {
  computeFeatures,
  evaluateCandidate,
  rankCandidates,
  runSearch,
  DEFAULT_SIM_CONFIG,
  DEFAULT_FRICTION_PARAMS,
  type RankedStrategy,
} from "./search";
export {
  linearGrid,
  generateDepth1Strategies,
  generateDepth2CrossFeatureStrategies,
  describeStrategy,
  type Depth1Feature,
} from "./exhaustiveGenerator";
export { runStrategyExecution, type BacktestExecutionResult } from "./run";
export { evaluateHoldoutOnce } from "./holdout";
export { splitChronological, assertNoOverlap, type TemporalSplit } from "./split";
export { planWalkForward, assertWalkForwardCausal, type WalkForwardFold, type WalkForwardPlan } from "./walkforward";
export { deflatedSharpe, isSignificant } from "./significance";
