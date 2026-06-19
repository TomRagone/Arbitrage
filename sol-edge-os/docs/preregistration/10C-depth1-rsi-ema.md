# Pre-Registration Record — 10C-001

## PRE (commit before the run)
- Run ID: 10C-001
- Date / git commit: 2026-06-19 / (pre-run; HEAD at time of writing — see RESEARCH_LOG.md entry for the actual commit this ran against)
- Committed-search # on this question: 1 (first and, per §5, the only committed search for this question — a null result is the answer at this budget, not a cue to re-roll)
- Question / hypothesis: Does any depth-1 rule on `rsi_14` or `ema_ratio_20` (close/EMA20), evaluated on Kraken SOL/USDT 1h, show statistically significant out-of-sample edge after real calibrated friction (`config/frictionCalibration.json`, Phase 10B)?

- Data source & date range: ccxt/kraken, SOL/USDT, 1h. Kraken's API returns at most ~720 bars of 1h history for this pair regardless of how far back `since` is requested (same limitation independently confirmed in `STEP4_STRATEGY_SPEC.md` Addendum 1) — this is a hard data-availability ceiling, not a chosen window. All bars Kraken returns are ingested; the longest internally gap-free segment (via `findGapIndices`/`segmentAtGaps`, Phase 10A.3) is used. Exact boundary timestamps and segment length recorded in the RESULT section below (filled after ingestion, before any candidate is scored — fixing data availability is a §2 setup precondition, not a multiplicity knob).
- Split: train 60% | test 20% | holdout 20%, chronological, on the selected gap-free segment (absolute boundary timestamps recorded in RESULT).
- Setup preconditions fixed (and why — §2): (1) gap-free segment selection — a bar whose lookback window spans a discontinuity has untrustworthy features (10A.3's non-leaking gap policy); (2) minimum-bars check before any candidate is scored. Neither depends on any candidate's outcome.

- Search space:
    features: `rsi_14` (25 thresholds, linear grid 20–80), `ema_ratio_20` (41 thresholds, linear grid 0.98–1.02)
    ops: gt, lt (both, per feature/threshold)
    depth: 1 (single comparison, no and/or combinators)
    exit searched? N — fixed rule: mechanical negation of the entry comparison on the same feature/threshold (e.g. entry `rsi_14 < 30` → exit `rsi_14 > 30`). Adds zero extra searched parameters.
    sides: LONG, SHORT (both, per feature/threshold/op)
    threshold range & grid step: rsi_14 — [20, 80], step 2.5 (25 values); ema_ratio_20 — [0.98, 1.02], step 0.001 (41 values)
  → |space| = (25 + 41) thresholds × 2 ops × 2 sides = **264**

- Decision: [X] ENUMERATE (trials = |space| = 264) — small enough to test exhaustively, no sampling, no count to second-guess after the fact.
- Objective function: out-of-sample (test-segment) mean net log return per trade (`simulatedExpectancy`, after `applyFriction` with the Phase 10B calibrated `SimConfig`/`FrictionParams`) — same ranking objective `runSearch`/`rankCandidates` already use.
- Significance: DSR threshold = 0.95, using the empirical-variance-based Deflated Sharpe Ratio already implemented in `packages/research/src/significance.ts` (Bailey & López de Prado), not a closed-form √(2·ln N) plug-in. Minimum 10 out-of-sample trades required before any significance claim is attempted (`MIN_SAMPLE_LENGTH` in that same file — pre-existing, not introduced for this run).

## RESULT (fill after; do not edit the PRE block)

**Data used:** 745 bars (ohlc), 2026-05-19T13:00:00Z .. 2026-06-19T13:00:00Z (the one gap-free segment — confirms the PRE block's ~720-bar ceiling note). Integrity (10A.2): 0 hard violations, 0 gaps. Split: train=447 / test=149 / holdout=149 bars.

**Holdout:** 149 bars (the chronological-split tail, not a separately-carved holdout — this run predates the dedicated-holdout-before-folds design introduced in 10C-002).

### Per-fold results

Structural note: this run's walk-forward (480h train / 120h test / 120h step) was a diagnostic only, separate from the significance-bearing evaluation below (a single 60/20/20 chronological split) — 10C-002 later unified these into one pooled-across-folds design. Only 2 real folds fit in 745 bars; single-trade "best of 264" per fold is noise, not a finding.

| Fold | OOS Expectancy (bps/trade) | Trades | Rule |
|---|---|---|---|
| 0 | 434.65 | 1 | (best-of-264, not individually recorded) |
| 1 | 450.35 | 1 | (best-of-264, not individually recorded) |

**Pooled top candidate:** SHORT, enter when `ema_ratio_20 > 0.98`, exit when `ema_ratio_20 < 0.98` (ranked on the single 60/20/20 split's test segment, not pooled across folds — see structural note above)
**Pooled OOS expectancy:** 92.84bps/trade
**Pooled OOS trades:** 2
**Pooled OOS max drawdown:** 1.10%
**Trials (committed N):** 264
**DSR verdict:** Significant: No (DSR not meaningfully computable — 2 test trades is below the 10-trade `MIN_SAMPLE_LENGTH` floor, so `isSignificant` short-circuits to false before a DSR value is even computed)
**Holdout status:** Untouched — per the pre-registered rule, the holdout is touched only if a candidate clears significance. None did.

**Conclusion:** Null result at the committed budget. The binding constraint is data volume, not the search space or the friction model: 745 bars split 60/20/20 leaves only ~149 OOS bars, too few for any depth-1 rule (mean-reversion entries on a 1h RSI/EMA-ratio threshold) to produce enough trades to clear the 10-trade significance floor. This is the answer for this question at this budget, not a cue to re-roll with a different N, grid, or split — a second committed search on this question would need to repair the underlying data-availability precondition (e.g. a different/longer-history pair or resolution), and would itself be logged as committed-search #2 per §5.
