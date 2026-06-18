import type { RankedStrategy } from "./search";

const EULER_MASCHERONI = 0.5772156649015329;
const MIN_SAMPLE_LENGTH = 10; // below this, no significance claim is made — too few trades to estimate skew/kurtosis meaningfully
const SIGNIFICANCE_THRESHOLD = 0.95; // DSR >= this -> "significant" (one-sided 95% confidence true Sharpe > 0, post-adjustment)

function erf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

/// Acklam's rational approximation to the standard normal inverse CDF
/// (probit). Verified against known reference quantiles before use.
function normalInverseCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

/// Probability the true Sharpe > 0, after correcting for (a) selection
/// bias from testing `trials` candidates and (b) non-normal returns
/// (skew/kurtosis), per Bailey & Lopez de Prado's Deflated Sharpe Ratio.
/// `kurtosis` is the raw (Pearson) kurtosis — normal distribution = 3, not
/// excess kurtosis (which would be 0 for normal).
export function deflatedSharpe(observedSharpe: number, trials: number, sampleLength: number, skew: number, kurtosis: number): number {
  if (sampleLength < 2) return 0; // cannot estimate a standard error at all

  const standardError = Math.sqrt((1 - skew * observedSharpe + ((kurtosis - 1) / 4) * observedSharpe ** 2) / (sampleLength - 1));
  if (!(standardError > 0)) return observedSharpe > 0 ? 1 : 0;

  // Expected maximum Sharpe ratio under `trials` independent draws from a
  // null (no true skill) distribution with this same standard error —
  // extreme-value-theory approximation (Bailey & Lopez de Prado 2014).
  // trials <= 1: nothing to deflate for, no multiple-testing penalty.
  let sr0 = 0;
  if (trials > 1) {
    const probitA = normalInverseCDF(1 - 1 / trials);
    const probitB = normalInverseCDF(1 - 1 / (trials * Math.E));
    sr0 = standardError * ((1 - EULER_MASCHERONI) * probitA + EULER_MASCHERONI * probitB);
  }

  const z = (observedSharpe - sr0) / standardError;
  return normalCDF(z);
}

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: readonly number[], m: number): number {
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

function skewness(values: readonly number[], m: number, sd: number): number {
  if (sd === 0) return 0;
  return values.reduce((s, v) => s + (v - m) ** 3, 0) / values.length / sd ** 3;
}

function kurtosisOf(values: readonly number[], m: number, sd: number): number {
  if (sd === 0) return 3; // degenerate (constant series) — treat as normal's kurtosis, not undefined
  return values.reduce((s, v) => s + (v - m) ** 4, 0) / values.length / sd ** 4;
}

/// Computes Sharpe/skew/kurtosis/sampleLength directly from the
/// candidate's OOS (test) per-trade returns and applies deflatedSharpe.
/// "Significant" requires both a minimum sample size (too few test trades
/// makes skew/kurtosis estimation meaningless, regardless of what the
/// Sharpe number says) and DSR >= SIGNIFICANCE_THRESHOLD.
export function isSignificant(r: RankedStrategy): boolean {
  const returns = r.testReturns;
  if (returns.length < MIN_SAMPLE_LENGTH) return false;

  const m = mean(returns);
  const sd = stdev(returns, m);
  if (!(sd > 0)) return false; // zero-variance returns -> Sharpe undefined, cannot claim significance

  const sharpe = m / sd;
  const skew = skewness(returns, m, sd);
  const kurt = kurtosisOf(returns, m, sd);

  const dsr = deflatedSharpe(sharpe, r.trials, returns.length, skew, kurt);
  return dsr >= SIGNIFICANCE_THRESHOLD;
}
