/**
 * The missing discriminator: for each trade, compare WHEN the best
 * favorable move occurred (MFE peak time) against WHEN the baseline
 * structure actually exited. Classifies each resolved trade into:
 *
 *   Case 1: MFE peak occurs strictly before the final exit
 *           -> entry/exit timing problem (we were still in the trade
 *              when the best point passed, but didn't capture it optimally)
 *   Case 2: MFE peak occurs strictly after the final exit (or the trade
 *           never closes within the reference window)
 *           -> exit is cutting winners short / closing too early
 *   Case 3: MFE never reaches a meaningful threshold (1R) within the
 *           reference window at all, regardless of timing
 *           -> signal quality problem (there was nothing real to capture)
 *
 * Read-only analysis; no strategy/filter changes.
 */
import { checkFill, type PositionState, type FillEvent } from "@sol-edge/analytics";
import { loadHistoricalSignals } from "./historicalSignals";
import type { Candle } from "@sol-edge/exchanges";

const REFERENCE_WINDOW = 80; // 20h at 15m bars — same bounded window as mfe-analysis.ts
const NO_EXPANSION_THRESHOLD_R = 1.0;

interface TimedFillEvent extends FillEvent {
  time: number;
}

/// Walks the real checkFill engine over actual subsequent candles,
/// capturing the TIME of each fill event (lifecycle.ts itself is
/// intentionally time-agnostic for live use; this wraps it for analysis).
function simulateWithTimes(
  signal: { direction: "LONG" | "SHORT"; entryPrice: number; atrValue: number },
  candlesAfter: Candle[],
): TimedFillEvent[] {
  const initialStop = signal.direction === "LONG" ? signal.entryPrice - signal.atrValue : signal.entryPrice + signal.atrValue;
  let state: PositionState = {
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    riskPerUnit: signal.atrValue,
    filledKinds: [],
    currentStop: initialStop,
  };
  const events: TimedFillEvent[] = [];
  for (const c of candlesAfter) {
    const event = checkFill({ high: c.high, low: c.low }, state);
    if (!event) continue;
    events.push({ ...event, time: c.time });
    if (event.kind === "SL") break;
    state = {
      ...state,
      filledKinds: [...state.filledKinds, event.kind as "TP1" | "TP2" | "TP3"],
      currentStop: event.movesStopToBreakeven ? state.entryPrice : state.currentStop,
    };
    if (state.filledKinds.length === 3) break;
  }
  return events;
}

/// Tracks the running MFE high-water-mark and the time it was last set,
/// over a bounded reference window (independent of the actual exit).
function mfePeak(
  signal: { direction: "LONG" | "SHORT"; entryPrice: number; atrValue: number },
  window: Candle[],
): { peakR: number; peakTime: number | null } {
  let best = 0;
  let peakTime: number | null = null;
  for (const c of window) {
    const excursion =
      signal.direction === "LONG" ? (c.high - signal.entryPrice) / signal.atrValue : (signal.entryPrice - c.low) / signal.atrValue;
    if (excursion > best) {
      best = excursion;
      peakTime = c.time;
    }
  }
  return { peakR: best, peakTime };
}

async function main() {
  const { signals, completedLowerTf } = await loadHistoricalSignals();

  const counts = { case1: 0, case2: 0, case3: 0 };
  const details: Array<{ time: number; case: string; peakR: number; peakTime: number | null; exitTime: number | null; finalKind: string | null }> = [];

  for (const { time, index, signal } of signals) {
    const candlesAfter = completedLowerTf.slice(index + 1);
    const referenceWindow = candlesAfter.slice(0, REFERENCE_WINDOW);
    const { peakR, peakTime } = mfePeak(signal, referenceWindow);

    const events = simulateWithTimes(signal, candlesAfter);
    const closed = events.length > 0 && (events[events.length - 1].kind === "SL" || events.some((e) => e.kind === "TP3"));
    const exitTime = closed ? events[events.length - 1].time : null;
    const finalKind = closed ? events[events.length - 1].kind : null;

    let caseLabel: string;
    if (peakR < NO_EXPANSION_THRESHOLD_R) {
      caseLabel = "Case 3 (signal quality)";
      counts.case3++;
    } else if (exitTime === null || (peakTime !== null && peakTime > exitTime)) {
      caseLabel = "Case 2 (exit cuts winners)";
      counts.case2++;
    } else {
      caseLabel = "Case 1 (entry/exit timing)";
      counts.case1++;
    }

    details.push({ time, case: caseLabel, peakR, peakTime, exitTime, finalKind });
  }

  console.log(`${signals.length} signals classified (reference window: ${REFERENCE_WINDOW} candles / 20h, no-expansion threshold: ${NO_EXPANSION_THRESHOLD_R}R).\n`);
  console.log(`Case 1 (MFE before exit -> entry/exit timing problem):  ${counts.case1}/${signals.length} (${((counts.case1 / signals.length) * 100).toFixed(1)}%)`);
  console.log(`Case 2 (MFE after exit -> exit cuts winners short):     ${counts.case2}/${signals.length} (${((counts.case2 / signals.length) * 100).toFixed(1)}%)`);
  console.log(`Case 3 (MFE never reaches ${NO_EXPANSION_THRESHOLD_R}R -> signal quality problem): ${counts.case3}/${signals.length} (${((counts.case3 / signals.length) * 100).toFixed(1)}%)`);

  console.log("\nPer-signal detail:");
  for (const d of details) {
    const peakStr = d.peakTime ? new Date(d.peakTime * 1000).toISOString() : "n/a";
    const exitStr = d.exitTime ? new Date(d.exitTime * 1000).toISOString() : "NEVER CLOSED";
    console.log(`  ${new Date(d.time * 1000).toISOString()}  ${d.case.padEnd(28)} peakR=${d.peakR.toFixed(2).padEnd(6)} peakAt=${peakStr}  exitAt=${exitStr}  (${d.finalKind ?? "n/a"})`);
  }
}

main();
