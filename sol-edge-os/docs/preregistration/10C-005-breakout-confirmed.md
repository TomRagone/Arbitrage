# Pre-Registration Record — 10C-005

## PRE (commit before the run)
- Run ID: 10C-005
- Committed-search # on this question: 1 (a new, narrower hypothesis derived directly from 10C-004's post-hoc diagnostic — not a re-roll of 10C-004's null, and not an extension of 10C-001/002/003's pure mean-reversion question. Tests whether a confirmation filter removes the whipsaw-churn failure mode observed in 10C-004, not whether momentum exists in general.)
- Question / hypothesis: does requiring a breakout (10C-004's `close > breakout_high_N` / `close < breakout_low_N`, any N ∈ {10,14,20,30,50,75,100}) to be simultaneously confirmed by an `rsi_14` or `ema_ratio_20` condition remove the immediate-reversal whipsaw churn observed in 10C-004 (median holding period 1 bar) and produce a significant out-of-sample edge?

- Setup preconditions (§2, not multiplicity-bearing, unchanged from 10C-002/003/004): data source is `ohlcv_candles WHERE source = 'trades_resampled'` only (10,795 bars, 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z); `source = 'ohlc'` rows excluded. Data integrity (10A.2) and gap policy (10A.3) unchanged — not re-verified line-by-line here since no new ingestion happened. All 14 `breakout_high_N`/`breakout_low_N` features and `rsi_14`/`ema_ratio_20` are already real, implemented features (10C-002, 10C-004) — no new feature implementation needed for this run.
- Holdout: the most recent 2,160 bars (90 days) carved out FIRST, before any fold is constructed — identical mechanism to 10C-002/003/004. Walk-forward folds are built only from the remaining 8,635 bars.
- Walk-forward (on the 8,635-bar remainder): trainBars = 2160 (90 days), testBars = 720 (30 days), step = 720 (30 days) → 8 folds, identical to 10C-002/003/004.
- Significance-bearing evaluation: identical to prior runs — each candidate's OOS (test) returns pooled across all 8 folds (chronologically concatenated) and ranked by pooled OOS expectancy.

- Search space (depth-2 conjunction, cross-feature-class by construction — breakout and oscillator features are disjoint, so unlike 10C-003 there is no same-feature-pair redundancy question to resolve):
    breakout leaves: 14 — for each N ∈ {10,14,20,30,50,75,100}: `close > breakout_high_N` (side LONG) and `close < breakout_low_N` (side SHORT). Identical to 10C-004's 14 candidates, now used as entry LEGS rather than standalone entries.
    confirmation leaves: 132 — same pool as 10C-003: `rsi_14` (25 thresholds × {gt,lt} = 50) + `ema_ratio_20` (41 thresholds × {gt,lt} = 82).
    entry: AND(breakout leaf, confirmation leaf) — every breakout leaf paired with every confirmation leaf, both directions of the confirmation leaf included (no pre-judging which RSI/EMA-ratio direction "should" confirm a breakout; the walk-forward ranking decides, not a prior assumption).
    exit: De Morgan's negation of the entry — `NOT(breakout leaf) OR NOT(confirmation leaf)`, same zero-new-parameters mechanical rule as 10C-003/004.
    side: determined by the breakout leaf (LONG for `breakout_high`, SHORT for `breakout_low`) — not a separately searched dimension.
  → |space| = 14 (breakout leaves) × 132 (confirmation leaves) = **1,848**
- Decision: [X] ENUMERATE (trials = |space| = 1,848) — well within single-run budget (10C-003's 8,200 × 8 folds ran in ~8 seconds; 1,848 × 8 is smaller still).
- Objective function: pooled out-of-sample (test, across all 8 folds) mean net log return per trade, after `applyFriction` with the Phase 10B calibrated `SimConfig`/`FrictionParams` — identical to prior runs.
- Significance: DSR threshold = 0.95, minimum 10 pooled OOS trades — unchanged.
- Holdout rule (§6, unchanged): evaluated exactly once, only if the top-ranked candidate clears significance. If no candidate clears significance, the holdout is not touched.
- Sanity check before the full run: generate and validate all candidates, confirm the surviving count is exactly 1,848, print 2-3 example candidates (at least one LONG, one SHORT) to visually confirm the AND-entry/De-Morgan-OR-exit construction. Stop and report if the count doesn't match exactly.
- Diagnostic planned regardless of outcome (same discipline as 10C-004): if the top-ranked candidate(s) show a meaningfully longer holding period than 10C-004's ~1.5-bar median, that's the direct evidence the confirmation filter is doing its job (whether or not the result clears significance). If holding periods are still ~1 bar, the filter isn't fixing the mechanism and a different approach (not more confirmation features) would be needed.

## RESULT (fill after; do not edit the PRE block)

**Data used:** 10,795 bars (trades_resampled), 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z. Integrity (10A.2): 0 hard violations, 2 spacing gaps (1 + 5 missing bars, 6 total) — same series as 10C-002/003/004, unchanged.

**Holdout:** 2,160 bars, 2026-03-21T15:00:00Z .. 2026-06-19T14:00:00Z. Carved first, before any fold. Walk-forward pool (remainder): 8,635 bars → 8 folds (2160h train / 720h test / 720h step), 715-bar unused tail.

**Sanity check (pre-run):** generated and validated all candidates — count was exactly 1,848, confirmed before proceeding. Example candidates visually confirmed correct construction, e.g. LONG: `(close > breakout_high_10 AND rsi_14 > 20)` → exit `(close < breakout_high_10 OR rsi_14 < 20)`.

### Per-fold results

| Fold | OOS Expectancy (bps/trade) | Trades | Rule |
|---|---|---|---|
| 0 | 82.40  | 1 | LONG (close>breakout_high_30 AND rsi_14<57.5) |
| 1 | 23.53  | 1 | LONG (close>breakout_high_75 AND ema_ratio_20<1.018) |
| 2 | 142.80 | 2 | SHORT (close<breakout_low_50 AND rsi_14<20) |
| 3 | 104.80 | 3 | SHORT (close<breakout_low_10 AND rsi_14>55) |
| 4 | 64.97  | 1 | LONG (close>breakout_high_14 AND ema_ratio_20<1.002) |
| 5 | 208.02 | 1 | LONG (close>breakout_high_75 AND rsi_14<60) |
| 6 | 119.28 | 3 | SHORT (close<breakout_low_10 AND ema_ratio_20<0.98) |
| 7 | 74.38  | 1 | SHORT (close<breakout_low_75 AND rsi_14>35) |

Note: every per-fold "best" has 1-3 trades — same sparsity signature as 10C-003's depth-2 conjunctions, here from combining an already-restrictive breakout condition with a second AND leg.

**Pooled top candidate:** LONG, enter when `(close > breakout_high_30 AND ema_ratio_20 < 1.006)`, exit when `(close < breakout_high_30 OR ema_ratio_20 > 1.006)`
**Pooled OOS expectancy:** 85.01bps/trade
**Pooled OOS trades:** 1
**Pooled OOS max drawdown:** 0.00%
**Trials (committed N):** 1848
**DSR verdict:** Significant: No (1 pooled OOS trade, far below the 10-trade floor — `isSignificant` short-circuits before a DSR is computed)
**Holdout status:** Untouched — per the pre-registered rule, the holdout is touched only if a candidate clears significance. None did.

**Honesty check — best among adequately-sampled candidates (not just the noise-dominated raw top-10):** 1,193 of 1,848 candidates (65%) have fewer than 10 pooled trades and are not meaningfully evaluable at all. Among the 1,193 candidates that DO have ≥10 trades, the best by pooled expectancy is LONG `(close > breakout_high_50 AND rsi_14 < 60)` — **+22.19bps/trade, 12 trades, max drawdown 1.11%**. Still far too few trades for any significance claim, but notably: every candidate in this ≥10-trade subset has a small max drawdown (1.11%-3.93% across the top 5), dramatically lower than 10C-004's unfiltered breakout candidates (33-86% max drawdown). The confirmation filter clearly does reduce trade frequency and loss severity.

**Holding-period diagnostic on that best ≥10-trade candidate** (the one diagnostic that actually answers the mechanism question — the raw top-3 are 1-2 trade flukes and uninformative here): LONG `(close>breakout_high_50 AND rsi_14<60)`, 12 trades — **mean 1.25 bars, median 1 bar, 83.3% held exactly 1 bar**, full distribution `[1,1,1,1,1,1,1,1,1,1,2,3]`. This is statistically indistinguishable from 10C-004's unfiltered whipsaw signature (median 1 bar, ~65% one-bar holds).

**Conclusion:** Null, and more specifically: **the confirmation filter does NOT fix the whipsaw mechanism** — it was hypothesized to. It does measurably reduce trade frequency (fewer entries clear both conditions) and loss severity (much smaller drawdowns among the ≥10-trade subset than 10C-004's unfiltered breakout), but the core failure mode — entering on a level cross, reversing out almost immediately — persists essentially unchanged even when the entry additionally requires an RSI/EMA-ratio condition. The "AND a confirmation" requirement filters *which* breakouts fire, not *what happens after* one fires. This is a real, useful negative result, not an inconclusive one: it rules out "missing confirmation" as the mechanism behind 10C-004's churn and points instead at something about the exit/holding-period design itself (mechanical negation re-fires the exit the instant the breakout level is recrossed, which is exactly when whipsaw happens, confirmed or not). Three tested hypothesis classes now stand empty on this question (pure mean-reversion: 10C-001/002; conjunctive mean-reversion: 10C-003; naive and confirmed momentum: 10C-004/005) — per the user's own framing, this is a legitimate point to consolidate rather than keep generating new feature combinations in this universe. The 2,160-bar holdout remains untouched and available.
