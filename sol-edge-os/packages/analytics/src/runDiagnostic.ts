/**
 * The canonical diagnostic pipeline: given a lower-timeframe interval and
 * cost/risk assumptions, fetch real candles, generate signals via the
 * locked strategy engine, simulate each one through the locked exit
 * structure, apply costs, and summarize. This is what the timeframe sweep
 * calls for each candidate interval — and, per the analytics-package
 * design, the same function the eventual live reporting layer can call,
 * so the research path and the product path stay one piece of code.
 *
 * Caveat worth stating plainly: this sweeps the entry/breakout timeframe
 * only. The 1H EMA50 trend filter stays fixed at 1H for every interval
 * tested, including 4H/1D, where "trend" computed from a shorter bar than
 * the entry signal itself is an unusual combination — not a bug, just a
 * faithful single-knob sweep, not a redesigned multi-timeframe relationship.
 * Also: every interval's usable backtest window is capped by the shared
 * 1H trend data's own depth (~30 days from Kraken's public endpoint), not
 * by how much raw history the entry timeframe itself has available.
 */
import type { CostRates } from "./costs";
import { loadHistoricalSignals } from "./historicalData";
import { simulateTrade, type TradeResult } from "./tradeSimulation";
import { summarizeRDistribution, type RDistributionSummary } from "./stats";

export interface DiagnosticResult {
  intervalMinutes: number;
  spanHours: number;
  barsEvaluated: number;
  signalCount: number;
  resolvedCount: number;
  grossSummary: RDistributionSummary;
  netSummary: RDistributionSummary;
  results: TradeResult[];
}

export async function runDiagnostic(
  intervalMinutes: number,
  riskAmount: number,
  rates: CostRates,
): Promise<DiagnosticResult> {
  const { signals, completedLowerTf, spanHours, barsEvaluated } = await loadHistoricalSignals(intervalMinutes);

  const results: TradeResult[] = [];
  for (const { index, signal } of signals) {
    const candlesAfter = completedLowerTf.slice(index + 1);
    const result = simulateTrade(signal, candlesAfter, riskAmount, rates);
    if (result) results.push(result);
  }

  return {
    intervalMinutes,
    spanHours,
    barsEvaluated,
    signalCount: signals.length,
    resolvedCount: results.length,
    grossSummary: summarizeRDistribution(results.map((r) => r.grossR)),
    netSummary: summarizeRDistribution(results.map((r) => r.netR)),
    results,
  };
}
