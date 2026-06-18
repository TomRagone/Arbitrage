# Step 4 — EMA Trend Breakout System v1 (Locked Strategy Spec)

Directional breakout, trend-confirmed, ATR-based 1R. Paper/validation only —
this defines what to test, not a claim that it has an edge. Once locked, do
not tweak any parameter mid-sample without an explicit addendum (see below).

## Data inputs

- Entry/breakout timeframe candles (originally 5m; relocked to **15m** after
  the cost diagnostic showed 5m's round-trip fee drag exceeded 1R).
- Trend-filter candles (originally locked to 1H; see **Addendum 1** below —
  this is now scaled to the entry timeframe, not fixed).
- Compute every indicator on completed candles only (exclude the
  still-forming candle) to avoid repainting.

## Indicators

- EMA50 of trend-timeframe closes.
- ATR14 on the entry timeframe — Wilder's smoothing.
- SMA20(ATR14) — volatility filter.
- SMA20(volume) — mean of entry-timeframe volume over the prior 20
  completed candles.
- Rolling highest-high / lowest-low over the 20 completed entry-timeframe
  candles immediately before the candle being evaluated.

## SIGNAL — evaluated on each newly completed entry-timeframe candle C

`bias = LONG` if the most recent completed trend-timeframe candle's close >
EMA50; `SHORT` if <; else `NONE` → no trade.

Emit a signal only if:
- LONG: `bias == LONG AND C.close > H20`
- SHORT: `bias == SHORT AND C.close < L20`

Entry price = `C.close` (market-on-close, paper). Breakout is close-based,
not an intrabar touch.

## VALIDATE — reject unless all pass (log the failing rule)

1. Trend aligned (enforced in SIGNAL).
2. Volatility: ATR14 > SMA20(ATR14).
3. Volume: C.volume > SMA20(volume) over the 20 candles before C.
4. Freshness / anti-chase: C is the first completed candle to break the
   level — the candle before C did not already satisfy the breakout against
   its own prior-20.
5. Risk caps: open positions < maxOpenPositions (1) and today's trades <
   maxTradesPerDay (3), read from Settings.

Pass → TRADE_APPROVED; otherwise TRADE_REJECTED with the failing rule.

## SIZING / 1R

- `riskAmount = riskPctPerTrade% × accountSize` (from Settings).
- `stopDistance = 1 × ATR14`.
- `size = riskAmount / stopDistance`.
- ⇒ `initialRiskAmount (1R) = stopDistance × size = riskAmount` exactly.
  Stored as the immutable anchor (`trades.initialStop`), never mutated.
- Stop: LONG `entry − ATR`, SHORT `entry + ATR`.

## TARGETS + STOP MOVEMENT (Step 5)

- TP1 = entry ± 1·ATR → close 50%.
- TP2 = entry ± 2·ATR → close 30%.
- TP3 = entry ± 3·ATR → close 20%.
- After TP1 fills → move stop to breakeven (entry). Original stop stays the
  1R anchor; the move is a separate append-only `trade_stop_moves` row.
- Trade closes when fully scaled out (100%) or stopped.
- Conservative tie-break: if a candle's range spans both the stop and an
  unfilled TP, the stop wins.
- At most one fill event is recorded per candle evaluation.

## Locked anti-chase rule

Strict first-candle breakout only: a signal triggers only on the first
candle that closes beyond the breakout level. The candle immediately
before it must not have already satisfied the breakout against its own
prior-20.

## Cost model (Step 5)

- Fees modeled per fill (entry + each partial exit), using
  `SystemConfiguration.feeRateEntryBps` / `feeRateExitBps`.
- Slippage applies to the entry fill and stop-loss exits only (not TP
  exits), using `SystemConfiguration.slippageBps` — an assumed figure, not
  empirically measured.
- Net R = (gross PnL − fees − slippage) ÷ initialRiskAmount.

---

## Addendum 1 — Trend timeframe scaled to entry timeframe (2026-06-17)

**Status:** Locked. This is a real strategy-logic change, documented here
explicitly rather than as a silent code tweak, per the same discipline as
the original Step 4 lock.

### Problem this fixes

The timeframe sweep (15m / 1H / 4H / 1D entry timeframes) held the trend
filter fixed at 1H for every entry timeframe tested. Two problems:

1. **Logical incoherence at the high end.** A 1H trend filter gating 4H or
   1D entries uses a *faster, noisier* signal to judge the *slower* one —
   backwards from the intent of a trend filter.
2. **Hidden sample-size collapse.** Every interval's usable backtest window
   was capped by the 1H trend data's own depth (~30 days, Kraken's public
   OHLC endpoint limit — confirmed empirically earlier in this project),
   regardless of how much raw history the entry timeframe itself had
   available. The 1D sweep reported a 720-day candle span but only 28 bars
   ever had sufficient 1H trend visibility to be evaluated at all — the
   apparent "long history" was an illusion.

### Decision

Trend timeframe is no longer fixed at 1H. It scales with the entry
timeframe, locked to this explicit table — not a formula, because Kraken's
OHLC endpoint only supports a fixed interval grid (`1, 5, 15, 30, 60, 240,
1440, 10080, 21600` minutes; confirmed `90` is rejected outright with
`EGeneral:Invalid arguments`), so an arbitrary multiplier would frequently
land on an unsupported interval:

| Entry timeframe | Trend timeframe | Ratio |
|---|---|---|
| 15m | 1H | 4× (the original, already-validated relationship) |
| 1H | 4H | 4× |
| 4H | 1D | 6× |
| 1D | 1W | 7× |

**Rule, stated explicitly so it's not re-derived ad hoc later:** trend
timeframe = the next interval on Kraken's supported grid that is at least
4× the entry interval. EMA period for the trend filter stays 50,
unchanged — only which candles it's computed from changes.

### What this does NOT change

- TP structure (1R/2R/3R, 50/30/20).
- Risk model, sizing formula, cost model.
- The lifecycle/exit engine (`checkFill`/`simulateExits`).
- The entry/breakout logic itself (close-based, anti-chase, ATR/volume
  filters) — only the trend filter's data source scales.

### Why this unlocks more history, not just coherence

Kraken returns ~720 candles per interval regardless of which interval is
requested. 720 candles at 1D = ~2 years; at 1W = ~5 years. Scaling the
trend timeframe up means the trend filter's own depth scales with it,
instead of staying capped at 1H's ~30 days — so a 4H or 1D sweep run under
this addendum can actually test a multi-month or multi-year window, not
the same ~30-day slice as every other interval.
