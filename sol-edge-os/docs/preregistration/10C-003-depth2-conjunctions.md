# Pre-Registration Record — 10C-003

## PRE (commit before the run)
- Run ID: 10C-003
- Committed-search # on this question: 3 (per §5 — extends the hypothesis class beyond depth-1; not a re-roll of 10C-002's null, which stands as the answer for the depth-1 question at its budget)
- Question / hypothesis: does a depth-2 conjunction of `rsi_14` and `ema_ratio_20` — a trend-context condition (`ema_ratio_20`) confirming a mean-reversion trigger (`rsi_14`), or vice versa — show statistically significant out-of-sample edge on Kraken SOL/USDT 1h after real calibrated friction, where the corresponding depth-1 single-condition rules (10C-001, 10C-002) did not?

- Setup preconditions (§2, not multiplicity-bearing, unchanged from 10C-002): data source is `ohlcv_candles WHERE source = 'trades_resampled'` only (10,795 bars, 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z); `source = 'ohlc'` rows excluded (overlap/duplicate risk with the most recent month). Data integrity (10A.2) and gap policy (10A.3) were independently verified by execution for this exact series in 10C-002's record and are unchanged here — not re-verified line-by-line in this record, since no new ingestion happened between 10C-002 and this run.
- Holdout: the most recent 2,160 bars (90 days) carved out FIRST, before any fold is constructed — identical mechanism to 10C-002. Walk-forward folds are built only from the remaining 8,635 bars; the holdout is never part of any fold's train or test.
- Walk-forward (on the 8,635-bar remainder): trainBars = 2160 (90 days), testBars = 720 (30 days), step = 720 (30 days) → 8 folds, identical to 10C-002.
- Significance-bearing evaluation: identical to 10C-002 — each candidate's OOS (test) returns pooled across all 8 folds (chronologically concatenated) and ranked by pooled OOS expectancy.

- Search space:
    leaf pool: `rsi_14` — 25 thresholds (linear grid 20–80, step 2.5) × {gt,lt} = 50 leaves. `ema_ratio_20` — 41 thresholds (linear grid 0.980–1.020, step 0.001) × {gt,lt} = 82 leaves.
    entry: depth-2 conjunction (AND) of exactly one `rsi_14` leaf and one `ema_ratio_20` leaf — cross-feature pairs only. Same-feature pairs (e.g. two `rsi_14` thresholds forming a band) are explicitly EXCLUDED from this search space — they test a different hypothesis (a band/range condition, not a trend-confirms-trigger conjunction) and are not pre-registered here.
    exit: De Morgan's negation of the entry — `NOT(A) OR NOT(B)`, expressed directly as `{type: "or", left: negate(A), right: negate(B)}` in the existing `BoolExpr` grammar (negate flips gt<->lt on the same feature/threshold leaf). Adds zero new searched parameters — same philosophy as 10C-001/002's depth-1 mechanical negation.
    sides: LONG, SHORT (both, per leaf-pair)
  → |space| = 50 (`rsi_14` leaves) × 82 (`ema_ratio_20` leaves) × 2 (sides) = **8,200**
- Decision: [X] ENUMERATE (trials = |space| = 8,200) — within single-run budget (10C-002's 264×8=2,112 evaluations ran in seconds; 8,200×8=65,600 evaluations is ~31x that, still a single-run job, not a sampling situation per §3).
- Objective function: pooled out-of-sample (test, across all 8 folds) mean net log return per trade, after `applyFriction` with the Phase 10B calibrated `SimConfig`/`FrictionParams` — identical to 10C-002.
- Significance: DSR threshold = 0.95, minimum 10 pooled OOS trades — unchanged from 10C-001/002.
- Holdout rule (§6, unchanged): evaluated exactly once, only if the top-ranked candidate clears significance. If no candidate clears significance, the holdout is not touched.
- Sanity check before the full run (not itself a result): generate all 8,200 candidates, run `validateStrategy` on each, confirm the surviving count is exactly 8,200, and print 2–3 example candidates (at least one LONG, one SHORT) to visually confirm the AND-entry/De-Morgan-OR-exit construction before trusting the full run. If the count does not match exactly, stop and report rather than proceeding.

## RESULT (fill after; do not edit the PRE block)

**Data used:** 10,795 bars (trades_resampled), 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z. Integrity (10A.2): 0 hard violations, 2 spacing gaps (1 + 5 missing bars, 6 total) — same series as 10C-002, unchanged.

**Holdout:** 2,160 bars, 2026-03-21T15:00:00Z .. 2026-06-19T14:00:00Z. Carved first, before any fold. Walk-forward pool (remainder): 8,635 bars → 8 folds (2160h train / 720h test / 720h step), 715-bar unused tail (too short for a 9th fold, not the holdout).

**Sanity check (pre-run, per the PRE block):** generated and validated all candidates — count was exactly 8,200, confirmed before proceeding. Example candidates visually confirmed correct AND-entry / De Morgan OR-exit construction, e.g. LONG: `(rsi_14 > 20 AND ema_ratio_20 > 0.98)` → exit `(rsi_14 < 20 OR ema_ratio_20 < 0.98)`.

### Per-fold results

| Fold | OOS Expectancy (bps/trade) | Trades | Rule |
|---|---|---|---|
| 0 | 281.99 | 8  | LONG (rsi_14>20 AND ema_ratio_20>0.98) |
| 1 | 175.51 | 1  | SHORT (rsi_14<60 AND ema_ratio_20>1.018) |
| 2 | 243.37 | 1  | LONG (rsi_14>52.5 AND ema_ratio_20<0.985) |
| 3 | 158.59 | 1  | SHORT (rsi_14>52.5 AND ema_ratio_20<0.985) |
| 4 | 501.81 | 1  | SHORT (rsi_14<20 AND ema_ratio_20>0.986) |
| 5 | 179.06 | 1  | LONG (rsi_14<55 AND ema_ratio_20>1.02) |
| 6 | 184.57 | 2  | SHORT (rsi_14>20 AND ema_ratio_20<0.98) |
| 7 | 193.95 | 16 | SHORT (rsi_14<80 AND ema_ratio_20<1.015) |

Note (real finding, not noise): unlike 10C-002's depth-1 folds (4-12 trades per fold), 7 of 8 depth-2 folds have 1-2 trades for their per-fold "best." The AND conjunction is materially more restrictive than a single condition — requiring both `rsi_14` and `ema_ratio_20` to clear their thresholds simultaneously fires far less often. Fold 7 (16 trades, wide thresholds rsi_14<80/ema_ratio_20<1.015) and fold 0 (8 trades) are the exceptions, both using looser threshold combinations.

**Pooled top candidate:** SHORT, enter when `(rsi_14 > 75 AND ema_ratio_20 < 0.993)`, exit when `(rsi_14 < 75 OR ema_ratio_20 > 0.993)`
**Pooled OOS expectancy:** 117.47bps/trade
**Pooled OOS trades:** 1
**Pooled OOS max drawdown:** 0.00%
**Trials (committed N):** 8200
**DSR verdict:** Significant: No (DSR not meaningfully computable — 1 pooled OOS trade is far below the 10-trade `MIN_SAMPLE_LENGTH` floor, so `isSignificant` short-circuits to false before a DSR value is even computed)
**Holdout status:** Untouched — per the pre-registered rule, the holdout is touched only if a candidate clears significance. None did.

**Conclusion:** Null result at the committed budget (8,200 candidates, exhaustive, run in ~8 seconds). The binding constraint here is structural, not data volume (unlike 10C-001): conjoining two independent conditions is restrictive enough that the pooled top-ranked-by-raw-expectancy candidate has only 1 OOS trade — a single high-return fluke, not a tradeable rule, and the significance gate catches it correctly rather than letting trade-count-1 noise pass as a finding. This is a meaningful negative result for the depth-2 cross-feature-conjunction hypothesis at this resolution: trend-confirms-trigger conjunctions of `rsi_14`/`ema_ratio_20`, ranked by raw pooled expectancy, are dominated by sparse-signal overfitting rather than producing a real, sufficiently-sampled edge. A fourth committed search on a related question (e.g. ranking by a trade-count-aware objective, or a different feature pair/combinator) would need its own pre-registration and would be logged as committed-search #4 per §5. The 2,160-bar holdout remains untouched and available.
