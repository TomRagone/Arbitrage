# SOL EDGE OS — Build Plan

Private, single-user systematic trading OS. Paper/validation only — proving
positive expectancy before any real money is at risk. See
`STEP4_STRATEGY_SPEC.md` for the locked strategy definition.

## Milestones

- **M0 — DB layer.** `packages/db`: Prisma schema, `writeAudit`,
  `getSystemConfiguration`/`getSettings`, `isTradingAllowed`,
  `engageKillSwitch`. Append-only `audit_logs` (DB-trigger enforced).
  **Done.**
- **Step 4 — Strategy engine.** EMA Trend Breakout System v1: trend filter,
  close-based breakout, ATR/volume filters, strict anti-chase, risk caps,
  ATR-based 1R sizing. Locked in `STEP4_STRATEGY_SPEC.md`. **Done**, base
  timeframe 15m (moved from 5m after the cost-drag diagnostic).
- **Step 5 — Trade lifecycle.** `trades`/`trade_exits`/`trade_stop_moves`
  (all DB-trigger-enforced immutable/append-only). TP1/TP2/TP3 scale-outs,
  breakeven stop move, pure `checkFill`/`simulateExits` engine reused by
  both live operation and backtesting. **Done.**
- **Step 5 — Cost model.** `estimateTradeCosts`: per-fill fees + slippage
  (entry + stop-loss fills only), `SystemConfiguration.feeRateEntryBps` /
  `feeRateExitBps` / `slippageBps`. Net R = (gross − fees − slippage) ÷
  initialRiskAmount. **Done.**
- **Step 6 — Analytics.** `packages/analytics`: every diagnostic function
  (cost model, lifecycle consistency checker, outcome categorization,
  MFE/MAE, the generalized `runDiagnostic(interval)` pipeline) lives here
  as pure, hand-traceable, no-I/O functions — the same code the live
  worker and any future reporting layer both import. Diagnostic CLIs in
  `apps/worker/scripts/` are thin callers. **In progress** — package
  scaffolded, all existing diagnostics migrated and re-verified identical.
- **Open question — does this strategy have real net edge?** Current best
  evidence: 15m is decisively net-negative (-0.80R/trade after costs); 1H
  and 4H are negative but improved once the trend-filter timeframe was
  correctly scaled to the entry timeframe; 1D shows positive net
  expectancy (+0.06R/trade, 44 trades, PF net 1.15) — the strongest
  candidate so far, not yet a verdict (single pair, no out-of-sample
  holdout, no walk-forward).

## Architecture

```
apps/worker   — live tick loop (Signal -> Validate -> Log -> Resolve,
                 then position management). Thin I/O wrappers only.
packages/db          — Prisma schema + DB-layer helpers.
packages/exchanges   — Kraken public market-data client (read-only).
packages/strategy    — pure market math (EMA/ATR/SMA/rolling/breakout/trend).
packages/analytics   — pure decision/lifecycle/cost/diagnostic logic +
                        runDiagnostic, shared by live + every diagnostic CLI.
```

## Working agreement

- Any new diagnostic function is written into `packages/analytics` first,
  with the script in `apps/worker/scripts/` as a thin caller — not the
  other way around.
- Real strategy-logic changes (not cost-accounting, not refactors) get an
  explicit addendum in the relevant spec doc (`STEP4_STRATEGY_SPEC.md`),
  not a silent code tweak.
- See `RESEARCH_LOG.md` for the per-diagnostic question/method/
  result/conclusion trail — the audit log for decisions, same instinct as
  the append-only audit log for trades.
