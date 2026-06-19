/**
 * EXPLORATORY. NON-EQUIVALENT. NOT FOR SEARCH OR SIGNIFICANCE USE.
 *
 * This file is a partial, best-effort translation of the LONG-side entry
 * logic in `packages/analytics/src/strategyEngine.ts` into the kernel's
 * `StrategyDSL` grammar. It is NOT behaviorally equivalent to
 * strategyEngine.ts and must not be fed into `runSearch`, `evaluateHoldoutOnce`,
 * deflated-Sharpe significance testing, or any pre-registration ledger.
 * It exists only to record what a same-series, single-timeframe, no-lag
 * approximation of the entry signal looks like as a `BoolExpr` tree, and
 * to validate that the new registry entries below resolve through
 * `validateStrategy` with zero violations.
 *
 * Known, deliberate deviations from strategyEngine.ts (full detail in
 * RESEARCH_LOG.md, "AST-kernel DSL translation — structural gaps"):
 *   1. Anti-chase (`isFirstOccurrence`) is DROPPED — BoolExpr has no
 *      prior-bar / lag operator.
 *   2. The trend-bias EMA is approximated on the SAME series as the
 *      breakout/ATR features (15m), not strategyEngine.ts's actual
 *      separate 1H trend timeframe — EvalContext is single-series only.
 *   3. The volume filter is OMITTED — CompactCandle has no volume field.
 *   4. `exit` below is a PLACEHOLDER, not a translation. strategyEngine.ts
 *      has no exit function; the real exit/TP ladder lives in
 *      `packages/analytics/src/lifecycle.ts` (multi-leg, intrabar,
 *      stateful) and cannot be expressed as a single per-bar BoolExpr.
 *   5. Portfolio-level caps and position sizing are OUT OF SCOPE for
 *      BoolExpr (no portfolio state in EvalContext) and are not present
 *      here at all.
 *
 * Registry entries `ema_50`, `atr_14`, `atr_sma_20`
 * (packages/core/src/registry.ts) are registered but have NO computation
 * wired in `FeatureEngine` (packages/database/src/features.ts). Any
 * attempt to actually evaluate this strategy will still throw loudly on
 * one of those — both `FeatureEngine.getFeatureSlice`
 * (unimplemented-feature branch) and `evaluateBoolExpr`/`resolveValue`
 * (missing-key-in-context branch) fail closed rather than silently
 * returning a wrong number. UPDATE (Phase 10C-004): `breakout_high_20`
 * and `breakout_low_20` are no longer in this category — they were
 * implemented for real as part of the unrelated 10C-004 breakout-momentum
 * search and now compute actual values. This does not make the strategy
 * below evaluable end-to-end (ema_50/atr_14 still throw first) and does
 * not change this file's EXPLORATORY/NON-EQUIVALENT status — deviations
 * 1, 2, 3, 4, 5 above are unaffected.
 */
import type { StrategyDSL } from "@sol-edge/core";

/** LONG side. Mirror (SHORT) is the structural negation noted in the report; not included here since it was not independently validated. */
export const EXPLORATORY_LONG_TRANSLATION: StrategyDSL = {
  entry: {
    type: "and",
    left: {
      type: "and",
      left: { type: "gt", left: { type: "price", field: "close" }, right: { type: "feature", name: "ema_50" } },
      right: {
        type: "gt",
        left: { type: "price", field: "close" },
        right: { type: "feature", name: "breakout_high_20" },
      },
    },
    right: { type: "gt", left: { type: "feature", name: "atr_14" }, right: { type: "feature", name: "atr_sma_20" } },
  },
  exit: {
    // PLACEHOLDER ONLY — see deviation (4) above. Not derived from strategyEngine.ts.
    type: "lt",
    left: { type: "price", field: "close" },
    right: { type: "feature", name: "ema_50" },
  },
  side: "LONG",
};
