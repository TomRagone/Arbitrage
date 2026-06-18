import { evaluateBoolExpr, type CompactCandle, type EvalContext, type RawTrade, type StrategyDSL } from "@sol-edge/core";

/// Frictionless physics loop. Walks candles in fixed order, evaluating
/// entry/exit via the single shared core evaluator — no duplicated
/// evaluation logic. A signal decided on close[t] fills at open[t+1]
/// (no same-bar fills). Signals on the final bar are skipped (no t+1 to
/// fill). At most one open position at a time.
export function runAstKernel(
  strategy: StrategyDSL,
  candles: readonly CompactCandle[],
  features: readonly Readonly<Record<string, number>>[],
): readonly RawTrade[] {
  const trades: RawTrade[] = [];

  let entrySignalTime: number | null = null;
  let entryTime: number | null = null;
  let entryPrice: number | null = null;

  for (let t = 0; t < candles.length; t++) {
    const ctx: EvalContext = { candle: candles[t], features: features[t] };

    if (entrySignalTime === null) {
      // Not in a position: only the entry expression is evaluated.
      if (evaluateBoolExpr(strategy.entry, ctx)) {
        if (t + 1 >= candles.length) continue; // no t+1 to fill — skip
        entrySignalTime = t;
        entryTime = t + 1;
        entryPrice = candles[t + 1].open;
      }
      continue;
    }

    // In a position: only the exit expression is evaluated.
    if (evaluateBoolExpr(strategy.exit, ctx)) {
      if (t + 1 >= candles.length) continue; // no t+1 to fill — skip, stay open
      const exitSignalTime = t;
      const exitTime = t + 1;
      const exitPrice = candles[t + 1].open;

      if (!(entryTime! > entrySignalTime!)) {
        throw new Error(`runAstKernel: causal violation — entryTime (${entryTime}) <= signalTime (${entrySignalTime})`);
      }
      if (!(exitTime > exitSignalTime)) {
        throw new Error(`runAstKernel: causal violation — exitTime (${exitTime}) <= exit signal bar (${exitSignalTime})`);
      }

      const rawReturnLong = Math.log(exitPrice / entryPrice!);
      const rawReturnLog = strategy.side === "LONG" ? rawReturnLong : -rawReturnLong;

      trades.push({
        id: `${entrySignalTime}:${exitSignalTime}`,
        signalTime: entrySignalTime!,
        entryTime: entryTime!,
        exitTime,
        entryPrice: entryPrice!,
        exitPrice,
        side: strategy.side,
        rawReturnLog,
      });

      entrySignalTime = null;
      entryTime = null;
      entryPrice = null;
    }
  }

  return trades;
}
