import { evaluateBoolExpr, validateStrategy, type EvalContext, type StrategyDSL } from "@sol-edge/core";

/**
 * Sterile JSON-consuming runtime. Imports core only — no kernel, no sim,
 * no research. Holds no position state: each tick mechanically evaluates
 * the entry/exit expressions against the given context and emits a raw
 * instruction. A stateful caller elsewhere is responsible for tracking
 * whether a position is actually open and deciding whether to act on a
 * given signal (e.g. ignore a BUY while already long) — DumbExecutor
 * itself does not know or care.
 *
 * Action mapping (exit takes priority over entry if both fire on the same
 * tick — closing risk before opening new risk):
 *   LONG strategy:  entry -> BUY,  exit -> SELL
 *   SHORT strategy: entry -> SELL, exit -> BUY
 */
export class DumbExecutor {
  private readonly strategy: StrategyDSL;

  constructor(strategyJsonString: string) {
    this.strategy = JSON.parse(strategyJsonString);
    validateStrategy(this.strategy); // safety reachable in production — throws at deploy time, not on the first live tick
  }

  public evaluateTick(ctx: EvalContext): "BUY" | "SELL" | "HOLD" {
    const exitFires = evaluateBoolExpr(this.strategy.exit, ctx);
    if (exitFires) return this.strategy.side === "LONG" ? "SELL" : "BUY";

    const entryFires = evaluateBoolExpr(this.strategy.entry, ctx);
    if (entryFires) return this.strategy.side === "LONG" ? "BUY" : "SELL";

    return "HOLD";
  }
}
