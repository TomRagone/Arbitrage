import { FEATURE_REGISTRY, type CompactCandle } from "@sol-edge/core";

/**
 * Causal feature storage. Hard temporal block: computation may only ever
 * read historicalSeries elements with timestamp <= targetTime. There is
 * no code path here that indexes past the causal boundary — the boundary
 * index is found once, up front, and every loop below is bounded by it.
 *
 * EMA (IIR) uses its lookbackPeriods as a smoothing span, not a hard
 * window — it recurses over the FULL causal history available, per
 * FeatureDefinition.lookbackPeriods' documented IIR semantics (core/registry.ts).
 * RSI (Wilder's) uses lookbackPeriods as a literal fixed window.
 */
export class FeatureEngine {
  public static getFeatureSlice(featureName: string, targetTime: number, historicalSeries: readonly CompactCandle[]): number {
    const definition = FEATURE_REGISTRY[featureName];
    if (!definition) {
      throw new Error(`FeatureEngine: unknown feature "${featureName}" — not present in FEATURE_REGISTRY`);
    }

    // Find the causal boundary: the last index whose timestamp <= targetTime.
    // historicalSeries is assumed sorted ascending by timestamp.
    let boundaryIndex = -1;
    for (let i = 0; i < historicalSeries.length; i++) {
      if (historicalSeries[i].timestamp <= targetTime) {
        boundaryIndex = i;
      } else {
        break;
      }
    }

    if (boundaryIndex === -1) {
      throw new Error(
        `FeatureEngine: temporal violation — no data with timestamp <= ${targetTime} exists; computing "${featureName}" would require reading a future index`,
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
