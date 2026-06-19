# Pre-Registration Record — 10C-004

## PRE (commit before the run)
- Run ID: 10C-004
- Committed-search # on this question: 1 (genuinely new hypothesis — breakout/momentum continuation, not mean-reversion; not a re-roll or extension of 10C-001/002/003, which tested rsi_14/ema_ratio_20 mean-reversion conditions and are independent prior null results on a different question)
- Question / hypothesis: does price breaking above its own recent N-bar high (or below its recent N-bar low) show statistically significant out-of-sample momentum-continuation edge on Kraken SOL/USDT 1h after real calibrated friction, for any N in {10, 14, 20, 30, 50, 75, 100}?

- New real features implemented (not stubs) before this run: `breakout_high_N` / `breakout_low_N` for N ∈ {10, 14, 20, 30, 50, 75, 100} — 14 total (7 high, 7 low). Computation: `max(high[t-N..t-1])` / `min(low[t-N..t-1])`, strictly excluding the current bar, strict-left aligned (`packages/database/src/features.ts`, `computeBreakoutExtreme`). Independently sanity-checked by execution before this record: confirmed the current-bar exclusion (a bar's own high/low is never part of its own breakout level), the exact-N-bar boundary (computes once exactly N prior bars exist), and warmup NaN (fewer than N prior bars). `breakout_high_20`/`breakout_low_20` reuse two registry entries that previously existed as registered-but-unimplemented stubs (from the unrelated `strategyEngineDslTranslation.ts` exploratory work) — now real for this run; that file's documentation was updated to stop claiming they're unimplemented, but its own EXPLORATORY/NON-EQUIVALENT status is otherwise unaffected (other deviations remain).
- Setup preconditions (§2, not multiplicity-bearing, unchanged from 10C-002/003): data source is `ohlcv_candles WHERE source = 'trades_resampled'` only (10,795 bars, 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z); `source = 'ohlc'` rows excluded. Data integrity (10A.2) and gap policy (10A.3) unchanged from 10C-002/003 — not re-verified line-by-line here since no new ingestion happened.
- Holdout: the most recent 2,160 bars (90 days) carved out FIRST, before any fold is constructed — identical mechanism to 10C-002/003. Walk-forward folds are built only from the remaining 8,635 bars.
- Walk-forward (on the 8,635-bar remainder): trainBars = 2160 (90 days), testBars = 720 (30 days), step = 720 (30 days) → 8 folds, identical to 10C-002/003.
- Significance-bearing evaluation: identical to 10C-002/003 — each candidate's OOS (test) returns pooled across all 8 folds (chronologically concatenated) and ranked by pooled OOS expectancy.

- Search space (depth-1 only — deliberately simpler than 10C-003's depth-2):
    For each N ∈ {10, 14, 20, 30, 50, 75, 100}: LONG entry = `close > breakout_high_N`; SHORT entry = `close < breakout_low_N`.
    7 N values × 2 sides = **14 candidates** total. No threshold grid (the breakout level itself is the threshold, computed per-bar from real OHLC — not a free parameter being searched).
    exit: mechanical negation — LONG exits when `close < breakout_high_N`; SHORT exits when `close > breakout_low_N`. Zero new searched parameters, same philosophy as 10C-001/002's depth-1 negation.
  → |space| = 7 × 2 = **14**
- Decision: [X] ENUMERATE (trials = |space| = 14) — trivially small, exhaustive by inspection, no sampling question.
- Objective function: pooled out-of-sample (test, across all 8 folds) mean net log return per trade, after `applyFriction` with the Phase 10B calibrated `SimConfig`/`FrictionParams` — identical to 10C-002/003.
- Significance: DSR threshold = 0.95, minimum 10 pooled OOS trades — unchanged from prior runs.
- Holdout rule (§6, unchanged): evaluated exactly once, only if the top-ranked candidate clears significance. If no candidate clears significance, the holdout is not touched.
- Reporting note (given the small space): all 14 candidates' individual pooled trade count and expectancy are reported directly, not just the top-ranked one — at N=14 there's no statistical reason to hide behind "top candidate only."

## RESULT (fill after; do not edit the PRE block)

**Data used:** 10,795 bars (trades_resampled), 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z. Integrity (10A.2): 0 hard violations, 2 spacing gaps (1 + 5 missing bars, 6 total) — same series as 10C-002/003, unchanged.

**Holdout:** 2,160 bars, 2026-03-21T15:00:00Z .. 2026-06-19T14:00:00Z. Carved first, before any fold. Walk-forward pool (remainder): 8,635 bars → 8 folds (2160h train / 720h test / 720h step), 715-bar unused tail.

**New feature implementation, independently verified by execution before this run:** `breakout_high_N`/`breakout_low_N` for N ∈ {10,14,20,30,50,75,100} (14 real features, `packages/database/src/features.ts`). Confirmed: current-bar exclusion (a bar's own high/low never enters its own breakout level — bar 19's high=120 was excluded, max of prior 10 bars=119 returned correctly), exact-N-bar boundary (computes once exactly N prior bars exist), warmup NaN (fewer than N prior bars).

### Per-fold results

| Fold | OOS Expectancy (bps/trade) | Trades | Rule |
|---|---|---|---|
| 0 | -43.73 | 29 | LONG close>breakout_high_30 |
| 1 | -47.57 | 36 | SHORT close<breakout_low_10 |
| 2 | -49.52 | 15 | LONG close>breakout_high_75 |
| 3 | -33.12 | 19 | SHORT close<breakout_low_20 |
| 4 | -31.19 | 20 | SHORT close<breakout_low_30 |
| 5 | -12.42 | 18 | LONG close>breakout_high_20 |
| 6 | -1.13  | 6  | SHORT close<breakout_low_100 |
| 7 | -46.60 | 20 | SHORT close<breakout_low_75 |

Note: every single fold's "best" candidate is still net negative — there is no fold where naive breakout/momentum continuation worked, even before friction-adjusted ranking across the full space.

**All 14 candidates** (not just the top — small space, full transparency per the pre-registered reporting note), ranked by pooled OOS expectancy:

| Rank | Expectancy (bps/trade) | Trades | Max DD | Rule |
|---|---|---|---|---|
| 1  | -52.11 | 198 | 64.36% | SHORT close<breakout_low_20 |
| 2  | -53.46 | 154 | 56.10% | SHORT close<breakout_low_30 |
| 3  | -53.96 | 73  | 32.56% | SHORT close<breakout_low_100 |
| 4  | -57.27 | 321 | 84.09% | SHORT close<breakout_low_10 |
| 5  | -58.31 | 220 | 72.28% | LONG close>breakout_high_20 |
| 6  | -58.39 | 260 | 78.09% | SHORT close<breakout_low_14 |
| 7  | -58.73 | 329 | 85.52% | LONG close>breakout_high_10 |
| 8  | -59.21 | 88  | 40.61% | SHORT close<breakout_low_75 |
| 9  | -59.99 | 274 | 80.68% | LONG close>breakout_high_14 |
| 10 | -61.89 | 111 | 49.69% | SHORT close<breakout_low_50 |
| 11 | -65.04 | 134 | 58.17% | LONG close>breakout_high_50 |
| 12 | -65.39 | 181 | 69.38% | LONG close>breakout_high_30 |
| 13 | -66.13 | 104 | 49.73% | LONG close>breakout_high_75 |
| 14 | -66.76 | 95  | 46.97% | LONG close>breakout_high_100 |

**Pooled top candidate:** SHORT, enter when `close < breakout_low_20`, exit when `close > breakout_low_20`
**Pooled OOS expectancy:** -52.11bps/trade
**Pooled OOS trades:** 198
**Pooled OOS max drawdown:** 64.36%
**Trials (committed N):** 14
**DSR verdict:** Significant: No (negative expectancy on the rank-1 candidate — DSR is moot; a negative-mean candidate cannot show a significant *positive* edge regardless of trial count or sample size)
**Holdout status:** Untouched — per the pre-registered rule, the holdout is touched only if a candidate clears significance. None did (none were even directionally positive).

**Post-hoc diagnostic (not a new committed search — explains the mechanism behind this result before it's written up, doesn't change the result itself):** average holding period across the top-ranked candidates, computed directly from `runAstKernel`'s raw trades (entryTime/exitTime, in bars) on the same folds:

| Candidate | Trades | Mean hold (bars) | Median | Max | Held exactly 1 bar |
|---|---|---|---|---|---|
| #1 SHORT close<breakout_low_20 | 198 | 1.47 | 1 | 4 | 64.1% |
| #2 SHORT close<breakout_low_30 | 154 | 1.47 | 1 | 4 | 66.2% |
| #3 SHORT close<breakout_low_100 | 73  | 1.45 | 1 | 3 | 65.8% |
| #5 LONG close>breakout_high_20 | 220 | 1.49 | 1 | 8 | 65.5% |

Median holding period is **1 bar** for every candidate checked; roughly two-thirds of all trades exit on the very next bar after entry. This is unambiguous: these are not trades that ran and failed to capture a real move — they are immediate reversals. Combined with the trade-count pattern in the per-candidate table above (shorter, noisier lookbacks like N=10/14/20 produce far more trades than longer ones like N=75/100 — exactly what whipsaw frequency scaling with level noise predicts, not what a deeper market-structure signal would predict), this points specifically at **whipsaw churn**, not at an absence of momentum in this market.

**Conclusion:** A clean, well-powered, uniformly negative result for *this specific construction* — not a sparsity/data-volume problem like 10C-001 or 10C-003 (every candidate has 73-329 pooled OOS trades). But the claim this result actually supports is narrower than "this market doesn't trend": this construction has no anti-chase filter and no confirmation gate — exactly the two safeguards the original hand-built `strategyEngine.ts` included for this same reason (volume confirmation, `isFirstOccurrence`). The holding-period diagnostic confirms why: price crosses the level, the position enters, price falls back across the same barely-moved level one bar later, and the position exits — then often re-enters the same fakeout. That is a structurally narrower failure mode ("unfiltered momentum entries churn on noise at this resolution") than a verdict on momentum as a category. Not a cue to re-roll lookback periods — the uniformity across all 7 N values reflects this same churn mechanism at every scale, not 7 independent failures. The well-motivated next step is a confirmation-filtered construction (depth-2: breakout AND a trend/momentum-confirming condition on `rsi_14` or `ema_ratio_20`), which would be a genuinely new test of whether filtering removes the churn — logged as committed-search #5 per §5 if run. The 2,160-bar holdout remains untouched and available.
