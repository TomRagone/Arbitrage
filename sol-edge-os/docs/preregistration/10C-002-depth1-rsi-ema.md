# Pre-Registration Record — 10C-002

## PRE (commit before the run)
- Run ID: 10C-002
- Committed-search # on this question: 2 (per §5 — committed-search #1, 10C-001, returned null because the data-availability setup precondition was unmet, not because the question was answered; this run repairs that precondition, it is not a re-roll of any multiplicity knob)
- Question / hypothesis: unchanged from 10C-001 — does any depth-1 rule on `rsi_14` or `ema_ratio_20` (close/EMA20), evaluated on Kraken SOL/USDT 1h, show statistically significant out-of-sample edge after real calibrated friction (`config/frictionCalibration.json`, Phase 10B)?

- Setup precondition repaired (§2, not multiplicity-bearing): 10C-001's binding constraint was data depth — the direct OHLC endpoint caps real history at ~745 bars, leaving too few OOS bars to clear the significance floor. Phase 10C.1 (trades-resampled ingestion, independently verified by execution before this record) replaces that source with `ohlcv_candles WHERE source = 'trades_resampled'`: 10,795 bars, 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z. `source = 'ohlc'` rows are excluded entirely from this run (they overlap the most recent month of trades-resampled data and would create duplicate/conflicting candles if mixed in).
- Data integrity (10A.2, re-verified by execution against this exact filtered series before this record): zero hard violations (no non-positive prices, OHLC sanity breaks, duplicate/out-of-order timestamps, or invalid volume). 2 spacing gaps found: 2025-08-28T08:00:00Z→10:00:00Z (1 missing bar), 2025-11-01T15:00:00Z→21:00:00Z (5 missing bars) — 6 missing hours total out of 10,795.
- Gap policy (10A.3, re-verified by execution against both real gaps before this record): `markTradeable` with lookback=20 confirmed to mark every bar in the 20-bar window following each gap as non-tradeable, with no forward-fill; the window only re-validates once 20 consecutive gap-free bars have re-accumulated. Effect on this run's fold structure (computed, not estimated): the 90-day-train/30-day-test/30-day-step walk-forward below has 8 folds; the two gaps reduce the tradeable-bar count in affected folds by at most 38 of 2160 train bars (fold 5, 1.8%) and 19 of 720 test bars (folds 2 and 4, 2.6%) — no fold is materially compromised, and the 2,160-bar holdout (the most recent data) is entirely gap-free (0 untradeable bars from gaps).

- Holdout: the most recent 2,160 bars (90 days) are carved out FIRST, before any fold is constructed — `candles.slice(candles.length - 2160)`. This is the dedicated, touch-once holdout. Walk-forward folds are built only from the remaining 8,635 bars; the holdout is never part of any fold's train or test.
- Walk-forward (on the 8,635-bar remainder): trainBars = 2160 (90 days), testBars = 720 (30 days), step = 720 (30 days) → 8 folds. (A 715-bar tail of the walk-forward pool is left over after the 8th fold's test window — unused, not the holdout, just leftover walk-forward-pool bars too short to form a 9th fold.)
- Significance-bearing evaluation: each candidate's out-of-sample (test) returns are pooled across all 8 folds (concatenated in chronological fold order — folds are non-overlapping and time-ordered, so this preserves a single chronological OOS return series per candidate) and ranked by pooled OOS expectancy. This replaces 10C-001's separate single 60/20/20 split, which this design has no equivalent of — every fold's test segment now contributes to both the per-fold diagnostic and the significance-bearing pooled ranking.

- Search space (identical to 10C-001):
    features: `rsi_14` (25 thresholds, linear grid 20–80, step 2.5), `ema_ratio_20` (41 thresholds, linear grid 0.980–1.020, step 0.001) — `ema_ratio_20` confirmed (by reading `FeatureEngine`) to be a real, wired computation (`close / ema(close, 20)`), not a registry stub; called directly, not computed ad hoc in the script.
    ops: gt, lt (both, per feature/threshold)
    depth: 1 (single comparison, no and/or combinators)
    exit searched? N — fixed rule: mechanical negation of the entry comparison on the same feature/threshold. Adds zero extra searched parameters.
    sides: LONG, SHORT (both, per feature/threshold/op)
  → |space| = (25 + 41) thresholds × 2 ops × 2 sides = **264**
- Decision: [X] ENUMERATE (trials = |space| = 264) — unchanged from 10C-001.
- Objective function: pooled out-of-sample (test, across all 8 folds) mean net log return per trade (`simulatedExpectancy`-equivalent computed from the pooled return array), after `applyFriction` with the Phase 10B calibrated `SimConfig`/`FrictionParams`.
- Significance: DSR threshold = 0.95, `packages/research/src/significance.ts` (Bailey & López de Prado), minimum 10 pooled OOS trades before any significance claim is attempted — unchanged from 10C-001.
- Holdout rule (§6, unchanged): evaluated exactly once, only if the top-ranked candidate clears significance, using `evaluateHoldoutOnce`. If no candidate clears significance, the holdout is not touched.

## RESULT (fill after; do not edit the PRE block)

**Data used:** 10,795 bars (trades_resampled), 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z. Integrity (10A.2): 0 hard violations, 2 spacing gaps (1 + 5 missing bars, 6 total) — matches the PRE block exactly.

**Holdout:** 2,160 bars, 2026-03-21T15:00:00Z .. 2026-06-19T14:00:00Z. Carved first, before any fold. Walk-forward pool (remainder): 8,635 bars → 8 folds (2160h train / 720h test / 720h step), 715-bar unused tail (too short for a 9th fold, not the holdout).

### Per-fold results

| Fold | OOS Expectancy (bps/trade) | Trades | Rule |
|---|---|---|---|
| 0 | 451.25 | 5  | LONG rsi_14>20/<20 |
| 1 | 41.81  | 6  | SHORT rsi_14>20/<20 |
| 2 | 112.04 | 9  | LONG rsi_14<80/>80 |
| 3 | 109.45 | 10 | SHORT rsi_14>20/<20 |
| 4 | 245.03 | 10 | SHORT rsi_14>20/<20 |
| 5 | 2.62   | 12 | SHORT ema_ratio_20<0.98/>0.98 |
| 6 | 331.64 | 4  | LONG rsi_14<80/>80 |
| 7 | 791.50 | 5  | SHORT rsi_14<80/>80 |

Per-fold "best" varies fold to fold (classic walk-forward instability at this per-fold sample size) — this is exactly why the significance claim below is made on the pooled series, not any single fold's best.

**Pooled top candidate:** SHORT, enter when `rsi_14 > 20`, exit when `rsi_14 < 20`
**Pooled OOS expectancy:** 27.75bps/trade
**Pooled OOS trades:** 66
**Pooled OOS max drawdown:** 38.71%
**Trials (committed N):** 264
**DSR verdict:** Significant: No (DSR < 0.95; 66 trades clears the 10-trade minimum, but the DSR itself falls below 0.95 — high return variance/drawdown relative to the small positive mean doesn't survive the 264-trial multiple-testing deflation)
**Holdout status:** Untouched — per the pre-registered rule, the holdout is touched only if a candidate clears significance. None did, so it remains untouched and available for a future committed search on this question.

**Conclusion:** Null result at the committed budget, on ~14.5x the real history 10C-001 had. This is a meaningfully stronger null than 10C-001's (which failed on a data-volume technicality before significance was even testable) — here the search had enough pooled trades (66, vs. 10C-001's 2) to make a real significance call, and it still didn't clear. The setup precondition (data depth) is no longer the binding constraint; the depth-1 `rsi_14`/`ema_ratio_20` hypothesis itself, at this resolution and friction model, is the answer for this budget — not a cue to re-roll. A third committed search on this exact question would need a different search space (depth, features, or combinators), not more data, and would be logged as committed-search #3 per §5.
