/**
 * SOL EDGE OS — Worker: clean paper / dry-run directional orchestration.
 *
 * Path 1 (trust the DB layer). Every domain operation goes through the
 * @sol-edge/db wrappers — no raw Prisma model access, no HTTP surface, no
 * arbitrage, no execution. The only non-wrapper call is prisma.$disconnect()
 * at shutdown (connection lifecycle, not a domain write).
 *
 * One tick:  Signal -> Validate -> Log -> Resolve   (nothing is ever executed)
 */
import { isTradingAllowed, writeAudit, engageKillSwitch, prisma } from "@sol-edge/db";

const TICK_MS = Number(process.env.WORKER_TICK_SECONDS ?? "5") * 1000; // default 5s
const ACTOR = "worker";
const MODE = "PAPER" as const;

// Placeholder risk geometry — replaced by the strategy/risk engine later.
const RISK_FRACTION = 0.015; // 1R = 1.5% of entry
const TP_R_MULTIPLE = 2; // take-profit at 2R
const PLACEHOLDER_SIZE = 1; // real position sizing is a later milestone

let running = true;
const round = (n: number, dp = 4): number => Number(n.toFixed(dp));

// ───────────────────────────── types ─────────────────────────────

type Direction = "LONG" | "SHORT";

interface DirectionalSignal {
  pair: string;
  direction: Direction;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskPerUnit: number;
  rMultipleTarget: number;
}

interface ValidationResult {
  approved: boolean;
  size: number;
  reason: string;
}

// ─────────────────────────── 1. SIGNAL ───────────────────────────

function generateSignal(): DirectionalSignal {
  const direction: Direction = Math.random() < 0.5 ? "LONG" : "SHORT";
  const entryPrice = round(150 * (1 + (Math.random() - 0.5) * 0.06)); // ~150 ±3%
  const riskPerUnit = round(entryPrice * RISK_FRACTION);
  const dir = direction === "LONG" ? 1 : -1;
  return {
    pair: "SOL/USDC",
    direction,
    entryPrice,
    stopLoss: round(entryPrice - dir * riskPerUnit), // 1R from entry
    takeProfit: round(entryPrice + dir * riskPerUnit * TP_R_MULTIPLE), // 2R from entry
    riskPerUnit,
    rMultipleTarget: TP_R_MULTIPLE,
  };
}

// ────────────────────────── 2. VALIDATE ──────────────────────────

type RiskRule = (signal: DirectionalSignal) => { ok: boolean; reason?: string };

// Empty by design; future deterministic rules (min R:R, session, cooldown,
// max trades/day, regime) drop in here unchanged.
const RISK_RULES: RiskRule[] = [];

function validateSignal(signal: DirectionalSignal): ValidationResult {
  for (const rule of RISK_RULES) {
    const result = rule(signal);
    if (!result.ok) return { approved: false, size: 0, reason: result.reason ?? "vetoed by risk rule" };
  }
  return { approved: true, size: PLACEHOLDER_SIZE, reason: "no risk rules configured (dry-run scaffold)" };
}

// ──────────── lifecycle: Signal -> Validate -> Log -> Resolve ────────────

async function runCycle(): Promise<void> {
  // The wrapper encapsulates the config read + kill-switch + maintenance logic,
  // so the worker never re-derives trading-allowed state itself.
  if (!(await isTradingAllowed())) {
    console.log("[cycle] trading disabled — skipping");
    return;
  }

  // 1. Signal
  const signal = generateSignal();
  await writeAudit({ actor: ACTOR, action: "TRADE_SIGNAL", entity: "signal", data: { mode: MODE, ...signal } });

  // 2. Validate
  const decision = validateSignal(signal);

  // 3. Log
  if (!decision.approved) {
    await writeAudit({ actor: ACTOR, action: "TRADE_REJECTED", entity: "signal", data: { mode: MODE, pair: signal.pair, reason: decision.reason } });
    console.log(`[rejected] ${decision.reason}`);
    return;
  }
  await writeAudit({
    actor: ACTOR,
    action: "TRADE_APPROVED",
    entity: "signal",
    data: { mode: MODE, pair: signal.pair, direction: signal.direction, size: decision.size, reason: decision.reason },
  });

  // 4. Resolve (dry-run): nothing is sent to any exchange.
  await writeAudit({ actor: ACTOR, action: "TRADE_RESOLVED", entity: "signal", data: { mode: MODE, pair: signal.pair, outcome: "dry-run; no execution" } });
  console.log(`[resolved] ${signal.direction} ${signal.pair} @ ${signal.entryPrice} (SL ${signal.stopLoss} / TP ${signal.takeProfit}) — dry-run`);
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
  console.log(`[worker] paper/dry-run directional engine started; tick every ${TICK_MS}ms`);

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