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
