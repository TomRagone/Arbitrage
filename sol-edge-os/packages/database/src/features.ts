import { FEATURE_REGISTRY, type CompactCandle } from "@sol-edge/core";

/**
 * Causal feature storage. Hard temporal block keyed on AVAILABILITY, not
 * the bar's open timestamp:
 *
 *   availability(bar) = bar.timestamp + barDurationSeconds
 *
 * Exchange OHLCV stamps the bar's OPEN. A bar's close/high/low are not
 * KNOWN until the bar closes, i.e. at open_ts + bar_duration. Keying the
 * block on the open timestamp would let a bar be used a full bar-duration
 * before its data actually exists — the data-layer twin of the same-bar
 * fill leak. So a bar may be used only when availability(bar) <= targetTime.
 *
 * Caller convention: to compute features "as of the close of bar t" (the
 * moment the signal is decided), request targetTime = availability(t) =
 * t.timestamp + barDurationSeconds — which includes bar t (equality) but
 * NOT bar t+1. A request even one tick earlier than bar t's close excludes
 * bar t entirely.
 *
 * EMA (IIR) uses its lookbackPeriods as a smoothing span, not a hard
 * window — it recurses over the FULL causal history available, per
 * FeatureDefinition.lookbackPeriods' documented IIR semantics (core/registry.ts).
 * RSI (Wilder's) uses lookbackPeriods as a literal fixed window.
 */
export class FeatureEngine {
  public static getFeatureSlice(
    featureName: string,
    targetTime: number,
    historicalSeries: readonly CompactCandle[],
    barDurationSeconds: number,
  ): number {
    const definition = FEATURE_REGISTRY[featureName];
    if (!definition) {
      throw new Error(`FeatureEngine: unknown feature "${featureName}" — not present in FEATURE_REGISTRY`);
    }
    if (!(barDurationSeconds > 0)) {
      throw new Error(`FeatureEngine: barDurationSeconds must be > 0, got ${barDurationSeconds}`);
    }

    // Find the causal boundary: the last index whose AVAILABILITY (open
    // timestamp + bar duration) is <= targetTime. historicalSeries is
    // assumed sorted ascending by timestamp.
    let boundaryIndex = -1;
    for (let i = 0; i < historicalSeries.length; i++) {
      const availability = historicalSeries[i].timestamp + barDurationSeconds;
      if (availability <= targetTime) {
        boundaryIndex = i;
      } else {
        break;
      }
    }

    if (boundaryIndex === -1) {
      throw new Error(
        `FeatureEngine: temporal violation — no bar is available (closed) by targetTime ${targetTime}; computing "${featureName}" would require a bar whose close is still in the future`,
      );
    }

    // Every read below is bounded to [0, boundaryIndex] — never past targetTime.
    const causalCloses: number[] = [];
    for (let i = 0; i <= boundaryIndex; i++) causalCloses.push(historicalSeries[i].close);

    switch (featureName) {
      case "ema_20":
      case "ema":
        return computeEma(causalCloses, definition.lookbackPeriods);
      case "rsi_14":
      case "rsi":
        return computeRsi(causalCloses, definition.lookbackPeriods);
      case "ema_ratio_20":
        return causalCloses[causalCloses.length - 1] / computeEma(causalCloses, definition.lookbackPeriods);
      default:
        throw new Error(`FeatureEngine: feature "${featureName}" is registered but has no computation implemented`);
    }
  }
}

/// IIR: recurses over the full causal series, no hard window — span only.
function computeEma(closes: number[], span: number): number {
  const alpha = 2 / (span + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * alpha + ema * (1 - alpha);
  }
  return ema;
}

/// Wilder's RSI, fixed window = period. NaN if insufficient causal history
/// (warmup, not a causal violation — same convention as @sol-edge/strategy).
function computeRsi(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;

  const window = closes.slice(closes.length - (period + 1));
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < window.length; i++) {
    const delta = window[i] - window[i - 1];
    if (delta > 0) avgGain += delta;
    else avgLoss += -delta;
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
