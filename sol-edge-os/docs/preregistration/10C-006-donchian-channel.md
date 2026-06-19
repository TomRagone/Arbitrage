# Pre-Registration Record — 10C-006

## PRE (commit before the run)
- Run ID: 10C-006
- Committed-search # on this question: 1 (a structurally distinct hypothesis from 10C-004/005 — not another feature pairing on the same mechanism, but a fix to the mechanism itself that 10C-005's diagnostic identified. Tests whether decoupling entry/exit reference levels removes the whipsaw, where adding a confirmation feature did not.)
- Question / hypothesis: 10C-005's diagnostic showed that confirmation does not fix 10C-004's whipsaw because mechanical negation exits the instant the SAME noisy level that triggered entry gets recrossed — by construction, that's exactly when whipsaw happens. Does decoupling entry and exit to use independent reference levels (a classic Donchian-channel construction: enter breaking the N-bar high, exit breaking the N-bar low — not the same level reversed) produce a significant out-of-sample edge, for any N ∈ {10, 14, 20, 30, 50, 75, 100}?

- Setup preconditions (§2, not multiplicity-bearing, unchanged from 10C-002/003/004/005): data source is `ohlcv_candles WHERE source = 'trades_resampled'` only (10,795 bars, 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z); `source = 'ohlc'` rows excluded. Data integrity (10A.2) and gap policy (10A.3) unchanged — not re-verified line-by-line here since no new ingestion happened. `breakout_high_N`/`breakout_low_N` for all 7 N values already exist as real, implemented features (10C-004) — no new feature implementation needed. No kernel change needed: `StrategyDSL` has no coupling requirement between entry and exit `BoolExpr` trees; they reference whichever features they reference, independently.
- Holdout: the most recent 2,160 bars (90 days) carved out FIRST, before any fold is constructed — identical mechanism to every prior 10C run. Walk-forward folds are built only from the remaining 8,635 bars.
- Walk-forward (on the 8,635-bar remainder): trainBars = 2160 (90 days), testBars = 720 (30 days), step = 720 (30 days) → 8 folds, identical to prior runs.
- Significance-bearing evaluation: identical to prior runs — each candidate's OOS (test) returns pooled across all 8 folds (chronologically concatenated) and ranked by pooled OOS expectancy.

- Search space (depth-1, decoupled entry/exit — NOT mechanical negation, the key structural difference from every prior 10C run):
    For each N ∈ {10, 14, 20, 30, 50, 75, 100}:
      LONG: entry = `close > breakout_high_N`; exit = `close < breakout_low_N` (the OPPOSITE channel boundary, same N — not a negation of the entry condition).
      SHORT: entry = `close < breakout_low_N`; exit = `close > breakout_high_N` (mirror).
    7 N values × 2 sides = **14 candidates** total. No threshold grid (same as 10C-004 — the channel boundaries are computed per-bar from real OHLC, not a free parameter being searched).
  → |space| = 7 × 2 = **14**
- Decision: [X] ENUMERATE (trials = |space| = 14) — trivially small, exhaustive by inspection.
- Objective function: pooled out-of-sample (test, across all 8 folds) mean net log return per trade, after `applyFriction` with the Phase 10B calibrated `SimConfig`/`FrictionParams` — identical to prior runs.
- Significance: DSR threshold = 0.95, minimum 10 pooled OOS trades — unchanged.
- Holdout rule (§6, unchanged): evaluated exactly once, only if the top-ranked candidate clears significance. If no candidate clears significance, the holdout is not touched.
- Standing diagnostic (kept from 10C-004/005, now a permanent check for any breakout-family search): run the holding-period diagnostic on whatever candidate(s) clear the ≥10-trade floor, regardless of significance outcome — directly tests whether decoupling actually lengthens holds versus the ~1-1.5-bar whipsaw signature observed in 10C-004/005.
- Decision rule going in (stated before results, not after): if this nulls, that closes this hypothesis-generation thread per the user's own framing — five structurally distinct hypothesis classes (mean-reversion, conjunctive mean-reversion, naive momentum, confirmed momentum, channel-exit momentum) will have come back empty, and the next move is to consolidate findings rather than pursue a #7 pairing more features onto a mechanism already shown not to be the fix.

## RESULT (fill after; do not edit the PRE block)

**Data used:** 10,795 bars (trades_resampled), 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z. Integrity (10A.2): 0 hard violations, 2 spacing gaps (1 + 5 missing bars, 6 total) — same series as every prior 10C run.

**Holdout:** 2,160 bars, 2026-03-21T15:00:00Z .. 2026-06-19T14:00:00Z. Carved first, before any fold. Walk-forward pool (remainder): 8,635 bars → 8 folds (2160h train / 720h test / 720h step), 715-bar unused tail.

**Sanity check (pre-run):** generated and validated all candidates — count was exactly 14, confirmed before proceeding. Construction confirmed decoupled (not negation): `LONG: enter close>breakout_high_10, exit close<breakout_low_10` — entry and exit reference different features (`breakout_high_10` vs `breakout_low_10`), not the same level reversed.

### Per-fold results

| Fold | OOS Expectancy (bps/trade) | Trades | Rule |
|---|---|---|---|
| 0 | 637.61  | 1 | LONG enter>high_100, exit<low_100 |
| 1 | 36.67   | 8 | LONG enter>high_20, exit<low_20 |
| 2 | 154.86  | 2 | LONG enter>high_100, exit<low_100 |
| 3 | 496.36  | 2 | SHORT enter<low_100, exit>high_100 |
| 4 | 574.12  | 3 | SHORT enter<low_50, exit>high_50 |
| 5 | -80.95  | 5 | SHORT enter<low_30, exit>high_30 |
| 6 | 1191.98 | 1 | LONG enter>high_50, exit<low_50 |
| 7 | 1844.72 | 2 | SHORT enter<low_50, exit>high_50 |

Note: per-fold trade counts (1-8) are much lower than 10C-004's (15-329) because trades now run for many bars instead of 1 — fewer round-trips fit in a 720-bar test window when each one takes tens to hundreds of bars to resolve. This is itself confirmation the mechanical fix changed behavior, not just an artifact.

**All 14 candidates**, ranked by pooled OOS expectancy:

| Rank | Expectancy (bps/trade) | Trades | Max DD | Rule |
|---|---|---|---|---|
| 1  | 37.94   | 23  | 37.72% | SHORT enter<low_50, exit>high_50 |
| 2  | -4.54   | 15  | 24.67% | SHORT enter<low_100, exit>high_100 |
| 3  | -19.57  | 61  | 42.00% | SHORT enter<low_20, exit>high_20 |
| 4  | -59.96  | 46  | 45.84% | SHORT enter<low_30, exit>high_30 |
| 5  | -75.25  | 62  | 53.37% | LONG enter>high_20, exit<low_20 |
| 6  | -79.97  | 133 | 74.51% | SHORT enter<low_10, exit>high_10 |
| 7  | -87.33  | 99  | 69.91% | SHORT enter<low_14, exit>high_14 |
| 8  | -103.90 | 135 | 78.82% | LONG enter>high_10, exit<low_10 |
| 9  | -107.71 | 24  | 31.42% | LONG enter>high_50, exit<low_50 |
| 10 | -118.17 | 47  | 46.21% | LONG enter>high_30, exit<low_30 |
| 11 | -120.64 | 101 | 77.01% | LONG enter>high_14, exit<low_14 |
| 12 | -181.78 | 21  | 51.27% | SHORT enter<low_75, exit>high_75 |
| 13 | -355.13 | 15  | 47.51% | LONG enter>high_100, exit<low_100 |
| 14 | -367.19 | 22  | 55.42% | LONG enter>high_75, exit<low_75 |

**Pooled top candidate:** SHORT, enter when `close < breakout_low_50`, exit when `close > breakout_high_50`
**Pooled OOS expectancy:** 37.94bps/trade
**Pooled OOS trades:** 23
**Pooled OOS max drawdown:** 37.72%
**Trials (committed N):** 14
**DSR verdict:** Significant: No (positive mean, 23 trades clears the 10-trade floor, but DSR falls below 0.95 — the return variance/drawdown relative to the small positive mean doesn't survive deflation)
**Holdout status:** Untouched — per the pre-registered rule, the holdout is touched only if a candidate clears significance. None did.

**Standing holding-period diagnostic (all 14 candidates clear the ≥10-trade floor this time):** the mechanical fix worked exactly as predicted. Median holding periods range 13-143 bars across all 14 candidates (vs. 10C-004/005's median of 1 bar). Fraction held exactly 1 bar is 0.0% for 13 of 14 candidates and 1.5% for the 14th — essentially zero immediate reversals, a complete elimination of the whipsaw signature. Full per-candidate detail in the run log.

**Conclusion:** The mechanism fix worked precisely as the diagnostic predicted — decoupling entry/exit reference levels eliminated the whipsaw (median holds now 13-143 bars vs. 1 bar previously, 0-1.5% one-bar exits vs. 65-83% before). This confirms 10C-005's diagnosis was correct: mechanical negation, not absence of momentum or insufficient confirmation, was the proximate cause of 10C-004/005's churn. But fixing the mechanism did not produce a significant edge: results are mixed (one weakly positive top candidate at +37.94bps/23 trades, but not significant; 13 of 14 candidates net negative, several heavily so, down to -367bps). This is the most complete test in this entire question to date — real trade counts (15-135), real holding periods, no churn artifact — and it still nulls. Per the user's own stated decision rule (locked before this ran): five structurally distinct hypothesis classes have now come back empty — pure mean-reversion (10C-001/002), conjunctive mean-reversion (10C-003), naive momentum (10C-004), confirmed momentum (10C-005), and channel-exit momentum (10C-006). This is the stopping point for this hypothesis-generation thread on `rsi_14`/`ema_ratio_20`/breakout features at 1h resolution on this venue/pair. The 2,160-bar holdout remains untouched and available across all six searches to date. The honest, complete finding from this entire thread: no tested construction in this feature universe shows a real, adequately-sampled, statistically significant edge — not a failure of search effort (8,200 + 1,848 candidates tested across #3 and #5 alone), but a real negative result about this specific hypothesis space.
