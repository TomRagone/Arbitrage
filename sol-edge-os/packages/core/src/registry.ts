export interface FeatureDefinition {
  readonly name: string;
  readonly lookbackPeriods: number; // for IIR features (e.g. EMA) this is the span, not a hard window
  readonly alignment: "strict-left";
}

export const FEATURE_REGISTRY: Readonly<Record<string, FeatureDefinition>> = Object.freeze({
  rsi_14: { name: "rsi_14", lookbackPeriods: 14, alignment: "strict-left" },
  ema_20: { name: "ema_20", lookbackPeriods: 20, alignment: "strict-left" },
});
