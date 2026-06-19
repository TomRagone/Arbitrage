# Research Log

Append-only audit trail for *decisions*, same instinct as `audit_logs` for
trades. One entry per diagnostic: question, method, result, conclusion.

---

### 5m fee-drag gate
**Q:** Is the 5m/1x-ATR design structurally viable under realistic Kraken fees?
**Method:** Median ATR(14)/price at 5m vs round-trip taker fee.
**Result:** Fee drag = 1.32R — round-trip cost exceeds the entire 1R unit.
**Conclusion:** Not viable. Paused Step 5 cost integration at 5m.

### Lever analysis (timeframe vs ATR multiple vs execution type)
**Q:** Which single change has the highest chance of flipping expectancy?
**Method:** Sensitivity of fee-drag ratio to each lever, using real candle data.
**Result:** 15m → fee drag 0.75R (viable w/ margin); widening the stop or
improving execution type both work mathematically but carry side effects
(win-rate impact unverified; execution-type change conflicts with a
close-confirmed breakout entry, needs unrealistic fee tiers).
**Conclusion:** Move base timeframe 5m → 15m. Locked in `STEP4_STRATEGY_SPEC.md`.

### Cost model applied to real lifecycle outcomes (15m)
**Q:** Does 15m survive realistic costs once actually modeled (not estimated)?
**Method:** `estimateTradeCosts` per fill, applied to all 46-48 signals'
lifecycle-simulated outcomes.
**Result:** Net expectancy -0.84R/trade, PF net 0.17-0.18. Even at zero
trading fees (slippage only), net expectancy stays negative (-0.07R).
**Conclusion:** 15m's gross edge (~0.12-0.16R) is too thin to survive any
realistic friction. Outcome breakdown: the two most common outcomes
(SL-before-TP1, TP1-then-BE — 32/46) are net losers; only TP1+TP2-then-BE
and TP3-full-winner survive costs.

### Exit-structure variants (A/B/C)
**Q:** Is the negative expectancy an exits problem or an entries problem?
**Method:** Same locked entries/filters/stop, three hypothetical payout
structures (25/25/50 at 1/2/4R; single 100%@3R; 50%@1R+trail-to-trend-break).
**Result:** Variant B (cheapest possible exit, 2 fills) still nets -0.84R,
PF net 0.40 — the best of the three, still deeply unprofitable. Variant C
(trend-trailing) performed *worst* (gross edge actually dropped).
**Conclusion:** Entries, not exits, are the binding constraint. No exit
restructuring rescues this entry signal at 15m.

### MFE/MAE excursion analysis
**Q:** Is there real favorable move available that the exit structure is
failing to capture?
**Method:** Truncated-at-actual-exit MFE/MAE (caught and fixed an
unbounded-lookback bug, then a milder bounded-window-but-untruncated bug,
before trusting the number).
**Result:** Mean truncated MFE (1.4682R) − mean cost drag (0.9558R) =
+0.5124R → real headroom exists. Joint MAE/MFE timing: SL-before-TP1
trades show near-zero MFE before failing (median 0.163R) — fast,
directionless losses, not "almost-winners stopped too tight."
**Conclusion:** Leans toward entry-quality, not stop-placement, as the
dominant cause of the loss bucket — consistent with the variant-test result.

### Timeframe sweep — first attempt (trend filter fixed at 1H)
**Q:** Does a higher timeframe fix this structurally (cost drag falls
~5x per timeframe step)?
**Result:** 4H and 1D showed positive net expectancy (+0.08R, +0.80R) —
but `barsEvaluated` revealed both were gated to ~28-30 days of real history
by the fixed 1H trend filter's own data depth, not the entry timeframe's.
4 trades (1D) and 18 trades (4H) — not a real sample.
**Conclusion:** Result not trustworthy as-is. Trend filter must scale with
entry timeframe before this sweep means anything. → Addendum 1.

### Trend-filter timeframe scaling (Addendum 1)
**Q:** Does scaling the trend filter to the entry timeframe both fix the
logical mismatch and unlock real sample sizes?
**Method:** Locked table (15m→1H, 1H→4H, 4H→1D, 1D→1W; "next available
Kraken interval ≥4x entry," since Kraken only supports a fixed interval
grid — confirmed empirically, 90min is rejected outright). Documented in
`STEP4_STRATEGY_SPEC.md` Addendum 1 before implementing.
**Result:** `barsEvaluated` now 667 for every interval (no longer
trend-data-starved). The earlier "4H positive" result reverses to negative
(-0.20R) once the trend filter is coherent. 1D remains positive
(+0.0638R, PF net 1.15) — now backed by 44 trades, not 4.
**Conclusion:** 1D is the strongest candidate in this entire investigation
— real sample size, coherent design, survives costs. Not a verdict yet:
one pair, one historical window, no out-of-sample holdout, no walk-forward.

### Phase 10B — Friction calibration to the locked venue
**Q:** `@sol-edge/sim`'s SimConfig/FrictionParams (the OOS research
apparatus's friction model, separate from Step 5's `estimateTradeCosts`)
were still round-number placeholders (`fixedFeeRate=0.0004` vs. the real
26bps taker fee, `alpha/beta/kappaImpact` never derived from the venue at
all). Does calibrating them from real, measurable data change the
reality gap `trackRealityGap` reports?
**Method:** `apps/worker/scripts/calibrate-friction.ts` ingested a real
60-day trailing window of Kraken SOL/USDT 1h OHLCV (721 bars), computed
median |close-to-close log return| and average daily base-asset volume
from it, and fetched a live ticker spread snapshot. alpha (half-spread)
and fixedFeeRate (real taker fee) are measured directly. beta and
kappaImpact have no real fill/slippage data to fit against (Kraken's
public API has no historical order book), so they're derived via a
documented spread-relative heuristic instead: `beta = alpha /
median(sigma_t)`, `kappaImpact = alpha / sqrt(referenceImpactRatio)` with
`referenceImpactRatio = 0.01` — flagged as an assumption, not a
measurement (see `config/frictionCalibration.json`'s `_methodologyNote`).
`apps/worker/scripts/reality-gap-report.ts` then ran a small fixed,
seeded sample of 5 generated strategies (apparatus exercise, not a
search/discovery claim — no ranking, no selection) over the same real
candles, applying both the old placeholder friction and the new
calibrated friction.
**Result:** Old placeholder: mean reality gap 0.008065 (log-return
terms) per trade, warning not tripped. New calibrated (real costs): mean
reality gap 0.006111 per trade, warning not tripped. The old
`kappaImpact` (0.02) had been an order of magnitude larger than the real
venue's spread-derived value (0.0014) — overstating impact cost more than
the higher real fee rate (26bps vs. the old 4bps placeholder) added back.
**Conclusion:** The apparatus's friction model now reflects this venue's
real fee schedule and measured spread/volatility/ADV, not arbitrary
numbers — `DEFAULT_SIM_CONFIG`/`DEFAULT_FRICTION_PARAMS`
(`packages/research/src/search.ts`) are wired to
`config/frictionCalibration.json`, so every future search/holdout run
through this apparatus inherits it automatically. Not a strategy result:
no edge claim made or implied here, and this doesn't touch the
pre-registration ledger. 10C (the real pre-registered search) is next.

### Phase 10C — Real pre-registered search (depth-1, rsi_14/ema_ratio_20)
**Q:** Does any depth-1 rule on `rsi_14` or `ema_ratio_20`, on Kraken
SOL/USDT 1h with real calibrated friction (Phase 10B), show significant
out-of-sample edge? Full pre-registration record:
`docs/preregistration/10C-depth1-rsi-ema.md`.
**Method:** Exhaustive enumeration (no sampling) of 264 candidates —
`rsi_14` (25 thresholds, 20–80) × `ema_ratio_20` (41 thresholds,
0.98–1.02) × {gt,lt} × {LONG,SHORT}, exit fixed as the mechanical
negation of each entry comparison (zero extra searched parameters). Run
once via `apps/worker/scripts/search-10c.ts` over a 60/20/20 chronological
split, ranked by OOS expectancy, gated by the existing Deflated Sharpe
Ratio significance check (`packages/research/src/significance.ts`,
threshold 0.95, minimum 10 OOS trades). A 480h/120h/120h walk-forward was
also run as a per-fold stability diagnostic, not as the significance
claim itself.
**Result:** Null. Top-ranked candidate (SHORT, `ema_ratio_20 > 0.98` /
`< 0.98`) scored 92.84bps/trade OOS — but on only 2 OOS trades, far below
the 10-trade significance floor, so `isSignificant` returned false before
a DSR was even meaningfully computable. The walk-forward fared worse: only
2 real folds fit, each containing exactly 1 trade for its "best of 264"
candidate — noise, not signal. Holdout was correctly never touched (no
candidate cleared significance). Full PRE/RESULT record in the
pre-registration file above.
**Standing platform constraint (not specific to this run):** Kraken's
public OHLCV endpoint — confirmed via both the native client (`getOHLC`,
`STEP4_STRATEGY_SPEC.md` Addendum 1) and now via ccxt's `fetchOHLCV`
(`ingestOHLCV`) — caps real 1h history for SOL/USDT at roughly 720–750
bars (~30 days), regardless of how far back `since` is requested. This is
a hard ceiling on this venue/pair/resolution, not a fetch-window choice.
It is the binding constraint on every walk-forward/holdout design at 1h
going forward: a 60/20/20 split of ~750 bars leaves only ~150 OOS bars,
too few for most depth-1 rules to clear a 10-trade significance floor,
and a 480h/120h walk-forward barely fits 2 folds. Any future real-data
search at 1h on this pair inherits this ceiling; a higher resolution
(4h/1d) trades it for fewer bars per unit of wall-clock history but a
longer real calendar span per bar (per the same reasoning as
`STEP4_STRATEGY_SPEC.md` Addendum 1's trend-timeframe scaling), so
resolution choice for any future committed search should account for
this explicitly rather than re-discovering it mid-run.
**Conclusion:** Null result accepted at the committed budget (264
trials) — not a cue to re-roll. A second committed search on this
question would need to first repair the data-availability precondition
(longer real history via a different resolution and/or pair), and would
be logged as committed-search #2 per §5 of the pre-registration policy.

### AST-kernel DSL translation — structural gaps
**Q:** Can `strategyEngine.ts`'s entry/exit logic (the analytics-side
trend/breakout strategy) be expressed as a `StrategyDSL` `BoolExpr` tree
and run through `runAstKernel`, the validated causal research engine?
**Method:** Read `strategyEngine.ts` and `lifecycle.ts` in full, enumerated
every entry and exit condition, and attempted to map each one onto the
kernel's existing grammar (`packages/core/src/types.ts`:
`ValueExpr`/`BoolExpr`/`StrategyDSL`) and `EvalContext`
(`packages/core/src/evaluator.ts`).
**Result:** The trend-bias, breakout-level, and ATR-volatility conditions
mapped cleanly onto new registry features (`ema_50`, `breakout_high_20`,
`breakout_low_20`, `atr_14`, `atr_sma_20` — `packages/core/src/registry.ts`)
and a `BoolExpr` tree (see `packages/research/src/strategyEngineDslTranslation.ts`,
itself labeled exploratory/non-equivalent). Five conditions, however, do
not fit the current DSL/kernel grammar at all:
1. **Anti-chase (`isFirstOccurrence`)** — requires "condition true at bar
   `i`, false at bar `i-1`." `BoolExpr`/`ValueExpr` have no lag/shift
   operator and no way to reference a prior bar's evaluated state; every
   node resolves only against the current `EvalContext`. Omitted from the
   translation — a real behavioral deviation, not just an approximation.
2. **Multi-timeframe trend filter** — `strategyEngine.ts` computes its
   EMA50 trend bias on a separate 1H candle series while breakout/ATR run
   on 15m. `EvalContext`/`FeatureEngine`/`CompactCandle[]` are
   single-series only; there is no cross-timeframe context anywhere in
   the kernel. The registered `ema_50` is a same-series (15m)
   approximation, numerically different from the real signal.
3. **Volume filter** (`volume[i] > SMA20(volume)[i]`) — `CompactCandle`
   has only `timestamp/open/high/low/close`; there is no `volume` field
   and `ValueExpr.price.field` only allows `open|high|low|close`. Not
   expressible without a core type change. No volume feature was
   registered (no candle-level volume source exists to compute it from).
4. **Exit/TP ladder** (1R/2R/3R, partial scale-outs, stop-to-breakeven)
   — lives entirely in `lifecycle.ts`, not `strategyEngine.ts`. It is
   intrabar (checks high/low against fixed price levels), multi-leg
   (TP1/TP2 leave the position partially open), and stateful (levels
   fixed at entry). `runAstKernel`'s exit model is a single boolean
   evaluated once per bar close with a binary in/out position state —
   incompatible by construction. No placeholder substitute is a real
   translation of this logic.
5. **Portfolio-level risk caps / position sizing** (`maxOpenPositions`,
   `maxTradesPerDay`, ATR-based stop sizing) — stateful, account-level
   logic with no portfolio context in `EvalContext`. Out of scope for
   `BoolExpr` by design; correctly absent from the translation.
**Conclusion:** A faithful, complete translation of `strategyEngine.ts`
into the current `StrategyDSL` grammar is not possible without extending
the kernel: adding a lag/shift operator, multi-series context, a volume
field, and a richer exit/position model. The partial translation
committed alongside this entry is exploratory only — explicitly labeled
non-equivalent in both `registry.ts` and
`strategyEngineDslTranslation.ts` — and must not be used for search,
holdout evaluation, or significance testing. No kernel-extension work has
been scoped or started; that is a deliberate stopping point, not an
oversight.

### Phase 10C.1 — Trades-resampled ingestion (repairs 10C-001's data ceiling)
**Q:** Can Kraken's real 1h history for SOL/USDT be extended past the
~745-bar OHLC-endpoint ceiling that capped 10C-001's significance test
before it could even run meaningfully?
**Method:** Built `resampleTradesToOHLCV` + `ingestTradesResampled`
(`apps/worker/scripts/ingest-trades-resampled.ts`), which paginates
Kraken's public Trades endpoint (genuine deep pagination, unlike the OHLC
endpoint) and resamples raw trades into 1h bars, stored alongside the
existing `source = 'ohlc'` rows under `source = 'trades_resampled'` in
the same `ohlcv_candles` table. Added `ema_ratio_20` (close/ema20) to
`FeatureEngine`/the registry as a real, wired computation. Before
committing, independently re-verified by execution (not just review):
row count/date range, `validateDataIntegrity` (10A.2) against the
filtered series, `markTradeable` (10A.3) against both real gaps found,
a full workspace typecheck, and that `ema_ratio_20` actually computes
(not a registry stub).
**Result:** 10,795 bars, 2025-03-26T14:00:00Z .. 2026-06-19T14:00:00Z —
~14.5x 10C-001's depth. Zero hard integrity violations. 2 real gaps (1 +
5 missing hourly bars). Gap policy confirmed live: every bar in the
20-bar lookback window after each gap is excluded, no forward-fill,
window re-validates 20 consecutive gap-free bars later. Workspace
typechecks clean.
**Conclusion:** This is a §2 setup-precondition repair, not a re-roll —
10C-001's null was a data-volume technicality, not an answer to the
hypothesis. Committed (this is purely apparatus work, no candidate was
scored). Cleared the way for 10C-002, a second committed search on the
same question per §5.

### Phase 10C-002 — Real pre-registered search #2 (depth-1, rsi_14/ema_ratio_20, repaired data depth)
**Q:** Same question as 10C-001 (does any depth-1 rule on `rsi_14` or
`ema_ratio_20` show significant OOS edge on Kraken SOL/USDT 1h after real
calibrated friction?), now with the data-availability precondition
repaired (Phase 10C.1). Full pre-registration record:
`docs/preregistration/10C-002-depth1-rsi-ema.md`.
**Method:** `apps/worker/scripts/search-10c-2.ts` reads ONLY
`source = 'trades_resampled'` from the local sqlite store via
`@sol-edge/database`'s `readOHLCV` (no live OHLC-endpoint call — that's
exactly what produced 10C-001's ceiling). A 2,160-bar (90-day) holdout is
carved from the most recent data FIRST, before any fold is built. The
remaining 8,635 bars are walk-forwarded (2160h train / 720h test / 720h
step) into 8 folds. Same 264-candidate exhaustive depth-1 grid as
10C-001 (`rsi_14` 25 thresholds, `ema_ratio_20` 41 thresholds, gt/lt,
LONG/SHORT, exit = mechanical negation). Each candidate's OOS (test)
returns are pooled across all 8 folds (chronologically concatenated,
folds are non-overlapping and time-ordered) into one cross-fold OOS
series — this pooled series, not any single fold or a separate split, is
what `isSignificant`/DSR is computed against.
**Result:** Per-fold best candidate varies fold to fold (range
2.62-791.50bps/trade, 4-12 trades) — classic walk-forward instability at
this per-fold sample size, reported as a diagnostic only. Top-ranked by
pooled OOS expectancy: SHORT, `rsi_14 > 20` / `< 20` — 27.75bps/trade,
**66 pooled trades**, max drawdown 38.71%. 66 trades clears the 10-trade
significance floor (unlike 10C-001's 2), but DSR falls below 0.95 — the
positive mean return doesn't survive the 264-trial multiple-testing
deflation given the return variance/drawdown. Holdout (2026-03-21 ..
2026-06-19, 2,160 bars) **not evaluated** — no candidate cleared
significance, so per the pre-registered rule it stays untouched.
**Conclusion:** Null result, but a structurally stronger null than
10C-001's — this time the search had enough real OOS trades to make an
actual significance call, and it still didn't clear. Data depth is no
longer the binding constraint; the depth-1 `rsi_14`/`ema_ratio_20`
hypothesis itself, at 1h resolution with real calibrated friction, is the
answer at this budget. Not a cue to re-roll with more data — a third
committed search on this question would need a different search space
(depth, features, or combinators), and would be logged as
committed-search #3 per §5. The 2,160-bar holdout remains untouched and
available for that future search.

### Phase 10C-003 — Real pre-registered search #3 (depth-2 cross-feature conjunctions, rsi_14 AND ema_ratio_20)
**Q:** Does a depth-2 conjunction of `rsi_14` and `ema_ratio_20` — a
trend-context condition confirming a mean-reversion trigger, or vice
versa — show significant OOS edge where the corresponding depth-1
single-condition rules (10C-001, 10C-002) did not? Full pre-registration
record: `docs/preregistration/10C-003-depth2-conjunctions.md`.
**Method:** `apps/worker/scripts/search-10c-3.ts`, same process as
10C-002 (same `trades_resampled` series, same 2,160-bar pre-carved
holdout, same 8-fold walk-forward, same pooled-OOS significance design).
New: a depth-2 generator
(`generateDepth2CrossFeatureStrategies`, `packages/research/src/exhaustiveGenerator.ts`)
enumerating cross-feature-only leaf pairs (one `rsi_14` leaf AND one
`ema_ratio_20` leaf — same-feature pairs explicitly excluded) — 50 × 82 ×
2 sides = 8,200 candidates. Exit is the De Morgan negation of the entry
(`NOT(A) OR NOT(B)`), expressed directly via the existing `or` BoolExpr
node, zero new searched parameters. Pre-run sanity check (generate +
validate all candidates, confirm count == 8,200 exactly, visually
inspect example LONG/SHORT candidates) passed before the full run.
**Result:** Null. Full run completed in ~8 seconds. Per-fold "best"
candidates cluster around 1-2 trades for 7 of 8 folds (fold 0: 8 trades,
fold 7: 16 trades, the two exceptions, both using looser thresholds) —
the AND conjunction is materially more restrictive than any depth-1
condition, firing far less often. Top-ranked by pooled OOS expectancy:
SHORT, `(rsi_14 > 75 AND ema_ratio_20 < 0.993)` — 117.47bps/trade on
**1 pooled trade**. `isSignificant` correctly short-circuits to false
(1 trade, far below the 10-trade floor) before a DSR value is even
computed. Holdout **not evaluated** — no candidate cleared significance.
**Conclusion:** A real, structural null — not a data-volume problem
(same 10,795-bar series as 10C-002) and not a significance-gate failure
either; the gate worked exactly as designed, catching a 1-trade outlier
before it could masquerade as a finding. The depth-2 cross-feature
conjunction hypothesis, ranked by raw pooled expectancy, is dominated by
sparse-signal overfitting rather than producing a real, adequately-
sampled edge. A fourth committed search on a related question (e.g. a
trade-count-aware ranking objective, or a different feature pair/
combinator) would need its own pre-registration and would be logged as
committed-search #4 per §5. The 2,160-bar holdout remains untouched and
available.

### Phase 10C-004 — Real pre-registered search #4 (breakout/momentum continuation, new feature class)
**Q:** Does price breaking above/below its own recent N-bar high/low show
significant OOS momentum-continuation edge, for N ∈ {10,14,20,30,50,75,100}
— a genuinely different hypothesis from 10C-001/002/003's mean-reversion
conditions, not an extension or re-roll of any of them? Full
pre-registration record: `docs/preregistration/10C-004-breakout-momentum.md`.
**Method:** Implemented 14 new real features first — `breakout_high_N`/
`breakout_low_N` (`max(high[t-N..t-1])`/`min(low[t-N..t-1])`, strictly
excluding the current bar, `packages/database/src/features.ts`) —
independently sanity-checked by execution (current-bar exclusion,
exact-N-bar boundary, warmup NaN) before the run. `breakout_high_20`/
`breakout_low_20` reuse two registry entries that previously existed as
unimplemented stubs from the unrelated `strategyEngineDslTranslation.ts`
work; that file's docs were corrected, its EXPLORATORY/NON-EQUIVALENT
status otherwise unaffected. `apps/worker/scripts/search-10c-4.ts`: same
process as 10C-002/003 (same series, same pre-carved holdout, same
8-fold walk-forward, same pooled-OOS ranking), but depth-1 only — LONG
`close > breakout_high_N`, SHORT `close < breakout_low_N`, mechanical
negation exit, 7 N × 2 sides = 14 candidates, exhaustive. Given the small
space, all 14 candidates' pooled stats are reported individually, not
just the top.
**Result:** **All 14 candidates show negative pooled OOS expectancy**
(-52.11 to -66.76bps/trade), each on substantial trade counts (73-329
trades — an order of magnitude more than 10C-003's sparse depth-2
conjunctions) and large max drawdowns (33-86%). Every single fold's
"best" candidate is also net negative — no fold, no lookback period, no
side produced a positive result anywhere in this space. Top-ranked: SHORT
`close < breakout_low_20`, -52.11bps/trade, 198 trades, 64.36% max
drawdown. DSR is moot (negative mean can't show positive significance).
Holdout **not evaluated** — nothing cleared significance, nothing was
even directionally positive.
**Post-hoc diagnostic (mechanism, not a new search):** holding-period
check on the top 4 candidates, computed directly from `runAstKernel`'s
raw entry/exit bar indices. Median holding period is **1 bar** for every
one of them (means 1.45-1.49 bars), ~65% of all trades exit on the very
next bar after entry, max holding period 3-8 bars across the board.
Combined with the trade-count pattern (shorter/noisier lookbacks like
N=10/14/20 produce far more trades than N=75/100 — whipsaw frequency
scaling with level noise, not a deeper signal), this is unambiguous
whipsaw churn, not absence of momentum.
**Conclusion:** A clean, well-powered, uniformly negative result for
*this specific construction* — but the claim it actually supports is
narrower than "this market doesn't trend." This construction has no
anti-chase filter and no confirmation gate — exactly the two safeguards
the original hand-built `strategyEngine.ts` included for this same
reason (volume confirmation, `isFirstOccurrence`). The holding-period
diagnostic confirms why: price crosses the level, enters, falls back
across the same barely-moved level one bar later, exits — then often
re-enters the same fakeout. That's "unfiltered momentum entries churn on
noise at this resolution," a structurally narrower failure mode than a
verdict on momentum as a category. Not a cue to re-roll lookback periods
— the uniformity across all 7 N values reflects the same churn mechanism
at every scale, not 7 independent failures. The well-motivated next step
is a confirmation-filtered construction (depth-2: breakout AND a
trend/momentum-confirming condition on `rsi_14` or `ema_ratio_20`),
which would directly test whether filtering removes the churn — logged
as committed-search #5 per §5 if run. The 2,160-bar holdout remains
untouched and available.
