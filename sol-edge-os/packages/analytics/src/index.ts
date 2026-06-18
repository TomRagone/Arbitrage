export { checkFill, simulateExits, type PositionState, type FillEvent, type TpKind, type ExitKind } from "./lifecycle";
export { estimateTradeCosts, type CostRates, type CostFill, type TradeCosts } from "./costs";
export { checkTradeConsistency, toConsistencyTrade, type ConsistencyTrade, type ConsistencyExit, type ConsistencyStopMove, type Violation } from "./consistency";
export {
  evaluateSignal,
  decideTrade,
  PAIR,
  LOWER_TF_INTERVAL_MINUTES,
  EMA_PERIOD,
  ATR_PERIOD,
  ATR_SMA_PERIOD,
  VOLUME_SMA_PERIOD,
  BREAKOUT_PERIOD,
  MIN_TREND_CANDLES,
  MIN_LOWER_TF_CANDLES,
  trendIntervalFor,
  type Signal,
  type ValidationResult,
  type RiskSettings,
  type RiskState,
} from "./strategyEngine";
export { simulateTrade, categorizeOutcome, type TradeResult } from "./tradeSimulation";
export { simulateVariantTrade, type ExitLeg, type ExitPlan, type VariantFillEvent } from "./variants";
export { mfeOverWindow, analyzeTradeExcursion, findExitIndex, type TradeExcursion } from "./mfeMae";
export { median, mean, profitFactor, summarizeRDistribution, type RDistributionSummary } from "./stats";
export { loadHistoricalSignals, computeBiasSeries, utcDay, type HistoricalSignals, type TimedSignal } from "./historicalData";
export { runDiagnostic, type DiagnosticResult } from "./runDiagnostic";
export {
  estimateBarLogReturns,
  estimateAverageDailyVolume,
  deriveCalibratedFriction,
  type OhlcvPoint,
  type CalibrationInputs,
  type CalibrationResult,
} from "./frictionCalibration";
