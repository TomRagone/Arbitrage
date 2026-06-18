/**
 * Verifies whether backtest.ts's risk-cap rejections are real or an
 * artifact of never simulating exits. backtest.ts only ever does
 * `state.openPositions++` on approval — it never checks whether that
 * trade would have actually closed via the real lifecycle engine before
 * later signals arrive. This script re-runs the same signal walk, but
 * uses the real checkFill (src/lifecycle.ts) against the actual
 * subsequent candles to find each approved trade's true close time, then
 * asks: at each risk-cap rejection, was a trade genuinely still open?
 */
import { decideTrade, type RiskSettings, type RiskState } from "../src/engine";
import { checkFill, type PositionState } from "@sol-edge/analytics";
import { loadHistoricalSignals, utcDay } from "./historicalSignals";

interface SimulatedTrade {
  id: string;
  openedAt: number;
  closedAt: number | null; // null = never closed within available data
}

/// Walks the real subsequent candles with the real checkFill to find when
/// (if ever) this trade actually closes. Same control flow as
/// simulateExits in lifecycle.ts, just also captures the closing candle's
/// time, which simulateExits doesn't expose.
function findCloseTime(initialState: PositionState, candlesAfterEntry: Array<{ time: number; high: number; low: number }>): number | null {
  let state = initialState;
  for (const c of candlesAfterEntry) {
    const event = checkFill({ high: c.high, low: c.low }, state);
    if (!event) continue;
    if (event.kind === "SL") return c.time;
    state = {
      ...state,
      filledKinds: [...state.filledKinds, event.kind],
      currentStop: event.movesStopToBreakeven ? state.entryPrice : state.currentStop,
    };
    if (state.filledKinds.length === 3) return c.time; // TP3 closes it
  }
  return null;
}

async function main() {
  const { signals, completedLowerTf } = await loadHistoricalSignals();

  const settings: RiskSettings = { riskPctPerTrade: 0.5, accountSize: 10000, maxOpenPositions: 1, maxTradesPerDay: 3 };
  const openTrades: SimulatedTrade[] = [];
  let tradesToday = 0;
  let currentDay = signals.length > 0 ? utcDay(signals[0].time) : 0;
  let nextId = 1;

  interface Row {
    time: number;
    approved: boolean;
    reason: string;
    openCountAtThatMoment: number;
    causingTradeIds: string;
  }
  const rows: Row[] = [];

  for (const { time, index, signal } of signals) {
    const day = utcDay(time);
    if (day !== currentDay) {
      currentDay = day;
      tradesToday = 0;
    }

    // "Open as of this moment" per the REAL simulated close times, not the
    // artificial ever-incrementing counter the original backtest used.
    const genuinelyOpen = openTrades.filter((t) => t.closedAt === null || t.closedAt > time);
    const decision = decideTrade(signal, settings, { openPositions: genuinelyOpen.length, tradesToday });

    rows.push({
      time,
      approved: decision.approved,
      reason: decision.reason,
      openCountAtThatMoment: genuinelyOpen.length,
      causingTradeIds: genuinelyOpen.map((t) => t.id).join(","),
    });

    if (decision.approved) {
      tradesToday++;
      const id = `T${nextId++}`;
      const state: PositionState = {
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        riskPerUnit: signal.atrValue,
        filledKinds: [],
        currentStop: decision.initialStop!,
      };
      const candlesAfter = completedLowerTf.slice(index + 1);
      const closedAt = findCloseTime(state, candlesAfter);
      openTrades.push({ id, openedAt: time, closedAt });
    }
  }

  console.log("Q1: Was the original open trade ever simulated through TP/SL resolution before later signals were evaluated?");
  console.log("    NO — backtest.ts only does `state.openPositions++` on approval and never checks for a close.\n");

  console.log("Q2/Q3: Full signal table (* = risk-cap rejection)\n");
  console.log("time                      approved  reason                                          openCount  causingTradeIds");
  for (const r of rows) {
    const marker = r.reason.startsWith("risk cap: open positions") ? "*" : " ";
    console.log(
      `${marker} ${new Date(r.time * 1000).toISOString()}  ${String(r.approved).padEnd(8)}  ${r.reason.slice(0, 46).padEnd(46)}  ${String(r.openCountAtThatMoment).padEnd(9)}  ${r.causingTradeIds}`,
    );
  }

  console.log("\nSimulated trades and their real close times:");
  for (const t of openTrades) {
    console.log(`  ${t.id}: opened ${new Date(t.openedAt * 1000).toISOString()}  closed ${t.closedAt ? new Date(t.closedAt * 1000).toISOString() : "NEVER (still open at end of available data)"}`);
  }

  const riskCapRejections = rows.filter((r) => r.reason.startsWith("risk cap: open positions"));
  console.log(`\n${riskCapRejections.length} risk-cap rejections in this real-lifecycle simulation (vs the original backtest's artifact-based count).`);
}

main();
