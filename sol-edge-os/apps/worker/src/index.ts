/**
 * SOL EDGE OS — Worker: EMA Trend Breakout System v1 (paper/dry-run).
 *
 * Path 1 (trust the DB layer). Every domain operation goes through the
 * @sol-edge/db wrappers — no raw Prisma model access, no HTTP surface, no
 * arbitrage, no execution. The only non-wrapper call is prisma.$disconnect()
 * at shutdown (connection lifecycle, not a domain write).
 *
 * Each tick does two independent things:
 *   1. Manage existing OPEN trades (lifecycle.ts: check the latest 15m
 *      candle against each trade's current stop/next TP). Runs even if
 *      trading is disabled — the kill switch stops new risk, not
 *      resolution of existing risk.
 *   2. Signal -> Validate -> Log -> Resolve for a possible new trade.
 *      Signal/validate logic lives in ./engine.ts (locked strategy).
 *
 * Base timeframe is 15m, not 5m — moved per the cost diagnostic (5m's
 * round-trip fee drag exceeded 1R; see engine.ts for detail).
 */
import {
  isTradingAllowed,
  writeAudit,
  engageKillSwitch,
  openPaperTrade,
  getOpenTrades,
  getTradeExits,
  getLatestStopMove,
  recordPartialExit,
  recordStopMove,
  closeTrade,
  prisma,
} from "@sol-edge/db";
import { getOHLC } from "@sol-edge/exchanges";
import { computeSignal, validateSignal, PAIR, LOWER_TF_INTERVAL_MINUTES } from "./engine";
import { checkFill, type PositionState, type TpKind } from "@sol-edge/analytics";

const TICK_MS = Number(process.env.WORKER_TICK_SECONDS ?? "5") * 1000; // default 5s
const ACTOR = "worker";
const MODE = "PAPER" as const;

let running = true;

// ──────────── 1. manage existing open trades (lifecycle) ────────────

async function managePositions(): Promise<void> {
  const candlesLower = await getOHLC(PAIR, LOWER_TF_INTERVAL_MINUTES);
  const completedLowerTf = candlesLower.slice(0, -1); // exclude still-forming candle
  if (completedLowerTf.length === 0) return;
  const latestCandle = completedLowerTf[completedLowerTf.length - 1];

  const openTrades = await getOpenTrades();
  for (const trade of openTrades) {
    const exits = await getTradeExits(trade.id);
    // Deduplicated defensively: each TP kind should only ever be recorded
    // once per trade, but this guards state reconstruction against any
    // duplicate rows (e.g. from a prior bug, or any future double-write)
    // rather than letting them silently corrupt the size-portion math.
    const filledKinds = [
      ...new Set(
        exits.map((e) => e.kind).filter((k): k is TpKind => k === "TP1" || k === "TP2" || k === "TP3"),
      ),
    ];
    const latestStopMove = await getLatestStopMove(trade.id);
    const currentStop = latestStopMove ? Number(latestStopMove.toPrice) : Number(trade.initialStop);

    const state: PositionState = {
      direction: trade.direction,
      entryPrice: Number(trade.entryPrice),
      riskPerUnit: Number(trade.riskPerUnit),
      filledKinds,
      currentStop,
    };

    const event = checkFill({ high: latestCandle.high, low: latestCandle.low }, state);
    if (!event) continue;

    await recordPartialExit({
      tradeId: trade.id,
      kind: event.kind,
      price: event.price,
      sizePortion: event.sizePortion,
      rMultiple: event.rMultiple,
    });
    const fillAction = event.kind === "SL" ? "TRADE_STOPPED" : `TRADE_${event.kind}_FILLED`;
    await writeAudit({
      actor: ACTOR,
      action: fillAction,
      entity: "trade",
      entityId: trade.id,
      data: { mode: MODE, pair: PAIR, kind: event.kind, price: event.price, sizePortion: event.sizePortion, rMultiple: event.rMultiple },
    });
    console.log(`[lifecycle] ${trade.id} ${event.kind} @ ${event.price} (${(event.sizePortion * 100).toFixed(0)}%, ${event.rMultiple}R)`);

    if (event.movesStopToBreakeven) {
      const breakeven = Number(trade.entryPrice);
      await recordStopMove({ tradeId: trade.id, fromPrice: currentStop, toPrice: breakeven, reason: "TP1_BREAKEVEN" });
      await writeAudit({
        actor: ACTOR,
        action: "TRADE_STOP_MOVED_TO_BREAKEVEN",
        entity: "trade",
        entityId: trade.id,
        data: { mode: MODE, pair: PAIR, fromPrice: currentStop, toPrice: breakeven },
      });
      console.log(`[lifecycle] ${trade.id} stop moved to breakeven (${breakeven})`);
    }

    // SL always exits all remaining size; TP3 is the last scale-out leg —
    // both fully close the trade. TP1/TP2 leave it OPEN (partially filled).
    if (event.kind === "SL" || event.kind === "TP3") {
      await closeTrade(trade.id);
      await writeAudit({ actor: ACTOR, action: "TRADE_CLOSED", entity: "trade", entityId: trade.id, data: { mode: MODE, pair: PAIR, finalKind: event.kind } });
      console.log(`[lifecycle] ${trade.id} CLOSED`);
    }
  }
}

// ──────────── 2. Signal -> Validate -> Log -> Resolve (new trade) ────────────

async function runCycle(): Promise<void> {
  await managePositions();

  // The wrapper encapsulates the config read + kill-switch + maintenance logic,
  // so the worker never re-derives trading-allowed state itself.
  if (!(await isTradingAllowed())) {
    console.log("[cycle] trading disabled — skipping new signals");
    return;
  }

  // 1. Signal
  const signal = await computeSignal();
  if (!signal) {
    console.log("[cycle] no signal this tick");
    return;
  }
  await writeAudit({
    actor: ACTOR,
    action: "TRADE_SIGNAL",
    entity: "signal",
    data: { mode: MODE, pair: PAIR, ...signal },
  });

  // 2. Validate
  const decision = await validateSignal(signal);

  // 3. Log
  if (!decision.approved) {
    await writeAudit({ actor: ACTOR, action: "TRADE_REJECTED", entity: "signal", data: { mode: MODE, pair: PAIR, direction: signal.direction, reason: decision.reason } });
    console.log(`[rejected] ${decision.reason}`);
    return;
  }

  // 4. Resolve (paper): create the locked trade row. Lifecycle (TP1/TP2/TP3,
  // stop-to-breakeven) plays out via managePositions() on subsequent ticks.
  const takeProfit1R =
    signal.direction === "LONG" ? signal.entryPrice + signal.atrValue : signal.entryPrice - signal.atrValue;
  const trade = await openPaperTrade({
    pair: PAIR,
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    initialStop: decision.initialStop!,
    takeProfit: takeProfit1R,
    riskPerUnit: signal.atrValue,
    rMultipleTarget: 1,
    size: decision.size!,
    approvedReason: decision.reason,
  });
  await writeAudit({
    actor: ACTOR,
    action: "TRADE_APPROVED",
    entity: "trade",
    entityId: trade.id,
    data: { mode: MODE, pair: PAIR, direction: signal.direction, size: decision.size, riskAmount: decision.riskAmount, reason: decision.reason },
  });
  console.log(
    `[approved] ${signal.direction} ${PAIR} @ ${signal.entryPrice} (stop ${decision.initialStop} / size ${decision.size}) — trade ${trade.id}`,
  );
}

// No silent failure: any unexpected error halts trading via the kill switch.
// Retained intentionally (it uses only the DB layer); say the word to drop it.
async function safeCycle(): Promise<void> {
  try {
    await runCycle();
  } catch (err) {
    console.error("[cycle] unexpected error — engaging kill switch", err);
    await engageKillSwitch(ACTOR, `worker cycle error: ${(err as Error).message}`).catch(() => {});
  }
}

// ──────────────────────────── bootstrap ────────────────────────────

async function main(): Promise<void> {
  await writeAudit({ actor: ACTOR, action: "worker.started", data: { mode: MODE, tickMs: TICK_MS } });
  console.log(`[worker] EMA Trend Breakout System v1 (paper) started; tick every ${TICK_MS}ms`);

  void (async function loop() {
    while (running) {
      await safeCycle();
      await new Promise((resolve) => setTimeout(resolve, TICK_MS));
    }
  })();

  const shutdown = async (signal: string): Promise<void> => {
    if (!running) return;
    running = false;
    console.log(`[worker] ${signal} received — shutting down`);
    await writeAudit({ actor: ACTOR, action: "worker.stopped" }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (err) => {
  console.error("[worker] fatal", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
