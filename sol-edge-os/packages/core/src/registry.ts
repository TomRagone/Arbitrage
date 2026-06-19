export interface FeatureDefinition {
  readonly name: string;
  readonly lookbackPeriods: number; // for IIR features (e.g. EMA) this is the span, not a hard window
  readonly alignment: "strict-left";
}

export const FEATURE_REGISTRY: Readonly<Record<string, FeatureDefinition>> = Object.freeze({
  rsi_14: { name: "rsi_14", lookbackPeriods: 14, alignment: "strict-left" },
  ema_20: { name: "ema_20", lookbackPeriods: 20, alignment: "strict-left" },
  // close / EMA20 — lets a depth-1 gt/lt rule express "price N% above/below
  // its EMA" entirely within the existing ValueExpr vocabulary (const/
  // feature/price only), with no new BoolExpr node type required.
  ema_ratio_20: { name: "ema_ratio_20", lookbackPeriods: 20, alignment: "strict-left" },

  // --- Breakout high/low, real and implemented (Phase 10C-004). ---
  // Rolling max(high)/min(low) over the preceding N bars, STRICTLY
  // EXCLUDING the current bar — max(high[t-N..t-1]) / min(low[t-N..t-1]).
  // strict-left by construction (matches packages/strategy/src/breakout.ts's
  // breakoutHigh() convention, and the same convention noted for these two
  // names back when they were registered-but-unimplemented stubs for the
  // strategyEngine.ts translation work). lookbackPeriods is the hard window
  // width N, not counting the 1-bar exclusion shift. N=20 reuses the two
  // names from that earlier stub registration — now real, not stubs.
  breakout_high_10: { name: "breakout_high_10", lookbackPeriods: 10, alignment: "strict-left" },
  breakout_low_10: { name: "breakout_low_10", lookbackPeriods: 10, alignment: "strict-left" },
  breakout_high_14: { name: "breakout_high_14", lookbackPeriods: 14, alignment: "strict-left" },
  breakout_low_14: { name: "breakout_low_14", lookbackPeriods: 14, alignment: "strict-left" },
  breakout_high_20: { name: "breakout_high_20", lookbackPeriods: 20, alignment: "strict-left" },
  breakout_low_20: { name: "breakout_low_20", lookbackPeriods: 20, alignment: "strict-left" },
  breakout_high_30: { name: "breakout_high_30", lookbackPeriods: 30, alignment: "strict-left" },
  breakout_low_30: { name: "breakout_low_30", lookbackPeriods: 30, alignment: "strict-left" },
  breakout_high_50: { name: "breakout_high_50", lookbackPeriods: 50, alignment: "strict-left" },
  breakout_low_50: { name: "breakout_low_50", lookbackPeriods: 50, alignment: "strict-left" },
  breakout_high_75: { name: "breakout_high_75", lookbackPeriods: 75, alignment: "strict-left" },
  breakout_low_75: { name: "breakout_low_75", lookbackPeriods: 75, alignment: "strict-left" },
  breakout_high_100: { name: "breakout_high_100", lookbackPeriods: 100, alignment: "strict-left" },
  breakout_low_100: { name: "breakout_low_100", lookbackPeriods: 100, alignment: "strict-left" },

  // --- EXPLORATORY. NON-EQUIVALENT. NOT FOR SEARCH OR SIGNIFICANCE USE. ---
  // The three entries below were registered for a best-effort, partial
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
  // Wilder's ATR-14, same fixed-window convention as rsi_14 (the window
  // INCLUDES the current bar's own true range — ATR at bar i is "known" as
  // of bar i's close, same causal convention FeatureEngine already applies
  // to rsi_14/ema_20).
  atr_14: { name: "atr_14", lookbackPeriods: 14, alignment: "strict-left" },
  // SMA-20 of atr_14 (composed feature, same volatility filter
  // strategyEngine.ts's decideTrade applies: ATR14 > SMA20(ATR14)).
  atr_sma_20: { name: "atr_sma_20", lookbackPeriods: 20, alignment: "strict-left" },
});
