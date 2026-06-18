import { validateStrategy, type CompactCandle, type RawTrade, type StrategyDSL } from "@sol-edge/core";
import { runAstKernel } from "@sol-edge/kernel";
import { applyFriction, type FrictionParams, type SimConfig } from "@sol-edge/sim";

export interface BacktestExecutionResult {
  readonly strategySignature: string;
  readonly totalTrades: number;
  readonly kernelExpectancy: number; // mean rawReturnLog
  readonly simulatedExpectancy: number; // mean netReturnLog
  readonly maxDrawdownSimulated: number;
}

/// Deterministic, sorted-key signature for a strategy — used to identify
/// a run, not to re-derive the AST. Same canonicalization approach as the
/// kernel determinism test (sorted keys, fixed-precision floats).
function strategySignatureOf(strategy: StrategyDSL): string {
  function canonicalize(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "number") return value.toFixed(12);
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
    }
    throw new Error(`strategySignatureOf: unsupported value ${String(value)}`);
  }
  return canonicalize(strategy);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/// Max peak-to-trough decline of the equity curve implied by a sequence of
/// log returns, applied in fixed (ledger) order, starting from equity = 1.
function maxDrawdown(logReturns: readonly number[]): number {
  let equity = 1;
  let peak = 1;
  let worstDrawdown = 0;
  for (const r of logReturns) {
    equity *= Math.exp(r);
    if (equity > peak) peak = equity;
    const drawdown = (peak - equity) / peak;
    if (drawdown > worstDrawdown) worstDrawdown = drawdown;
  }
  return worstDrawdown;
}

/// Validate (core) -> run kernel -> run sim -> aggregate. Parameter search
/// lives in this package, decoupled from the live path — this function is
/// the single entry point a parameter search would call repeatedly.
export function runStrategyExecution(
  strategy: StrategyDSL,
  candles: readonly CompactCandle[],
  features: readonly Readonly<Record<string, number>>[],
  simConfig: SimConfig,
  frictionParams: FrictionParams,
): BacktestExecutionResult {
  validateStrategy(strategy); // throws CausalViolationException on any violation

  const trades: readonly RawTrade[] = runAstKernel(strategy, candles, features);
  const netReturns = trades.map((trade) => applyFriction(trade, simConfig, frictionParams).netReturnLog);

  return {
    strategySignature: strategySignatureOf(strategy),
    totalTrades: trades.length,
    kernelExpectancy: mean(trades.map((t) => t.rawReturnLog)),
    simulatedExpectancy: mean(netReturns),
    maxDrawdownSimulated: maxDrawdown(netReturns),
  };
}
