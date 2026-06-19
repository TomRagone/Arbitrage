export interface FeatureDefinition {
  readonly name: string;
  readonly lookbackPeriods: number; // for IIR features (e.g. EMA) this is the span, not a hard window
  readonly alignment: "strict-left";
}

export const FEATURE_REGISTRY: Readonly<Record<string, FeatureDefinition>> = Object.freeze({
  rsi_14: { name: "rsi_14", lookbackPeriods: 14, alignment: "strict-left" },
  ema_20: { name: "ema_20", lookbackPeriods: 20, alignment: "strict-left" },
  // --- EXPLORATORY. NON-EQUIVALENT. NOT FOR SEARCH OR SIGNIFICANCE USE. ---
  // The five entries below were registered for a best-effort, partial
  // translation of strategyEngine.ts's entry logic into a StrategyDSL
  // (see packages/research/src/strategyEngineDslTranslation.ts and
  // RESEARCH_LOG.md, "AST-kernel DSL translation — structural gaps").
  // They are registered (so validateStrategy/evaluator can name-check
  // them) but have NO computation wired in FeatureEngine
  // (packages/database/src/features.ts) — any real evaluation attempt
  // throws loudly rather than silently returning a wrong value. Do not
  // treat their presence here as "this feature is usable."
  // EMA-50, same IIR semantics as ema_20 (lookbackPeriods is the smoothing
  // span, not a hard window — recurses over the full causal history).
  // Added for the strategyEngine.ts trend-bias translation (EMA_PERIOD=50
  // in packages/analytics/src/strategyEngine.ts). CAVEAT: strategyEngine.ts
  // computes this EMA50 on the separate trend timeframe (1H) series, not
  // the same series the entry/breakout features below are computed on
  // (15m). The kernel/FeatureEngine have no multi-timeframe context, so
  // this registration is a same-series approximation only — see report.
  ema_50: { name: "ema_50", lookbackPeriods: 50, alignment: "strict-left" },
  // Breakout level = rollingHigh(highs, 20)[i-1] (prior 20 COMPLETED bars,
  // excluding the current bar) — strict-left by construction, matching
  // packages/strategy/src/breakout.ts's breakoutHigh(). lookbackPeriods is
  // the hard window width (20), not counting the 1-bar shift.
  breakout_high_20: { name: "breakout_high_20", lookbackPeriods: 20, alignment: "strict-left" },
  // Mirror of breakout_high_20 — rollingLow(lows, 20)[i-1].
  breakout_low_20: { name: "breakout_low_20", lookbackPeriods: 20, alignment: "strict-left" },
  // Wilder's ATR-14, same fixed-window convention as rsi_14 (the window
  // INCLUDES the current bar's own true range — ATR at bar i is "known" as
  // of bar i's close, same causal convention FeatureEngine already applies
  // to rsi_14/ema_20).
  atr_14: { name: "atr_14", lookbackPeriods: 14, alignment: "strict-left" },
  // SMA-20 of atr_14 (composed feature, same volatility filter
  // strategyEngine.ts's decideTrade applies: ATR14 > SMA20(ATR14)).
  atr_sma_20: { name: "atr_sma_20", lookbackPeriods: 20, alignment: "strict-left" },
});
