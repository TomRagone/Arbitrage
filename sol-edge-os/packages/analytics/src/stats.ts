/**
 * Shared statistical helpers. Pure, no I/O. Consolidates median/mean/
 * profit-factor implementations that had been independently reimplemented
 * (with no real differences) in diagnostics.ts, expectancy-report.ts,
 * cost-model-report.ts, variant-test.ts, mfe-analysis.ts, and others.
 */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function profitFactor(values: number[]): number {
  const wins = values.filter((v) => v > 0).reduce((sum, v) => sum + v, 0);
  const losses = Math.abs(values.filter((v) => v < 0).reduce((sum, v) => sum + v, 0));
  return losses > 0 ? wins / losses : Infinity;
}

export interface RDistributionSummary {
  count: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  profitFactor: number;
  medianR: number;
}

/// Standard expectancy-report summary over an array of R-multiples
/// (typically net R per trade, but works for gross R too).
export function summarizeRDistribution(values: number[]): RDistributionSummary {
  const wins = values.filter((v) => v > 0);
  const losses = values.filter((v) => v < 0);
  return {
    count: values.length,
    winRate: values.length > 0 ? wins.length / values.length : NaN,
    avgWin: mean(wins),
    avgLoss: mean(losses),
    expectancy: mean(values),
    profitFactor: profitFactor(values),
    medianR: median(values),
  };
}
