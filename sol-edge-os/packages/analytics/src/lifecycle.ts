/**
 * Trade lifecycle — pure position-management functions, no I/O. Reusable by
 * both live paper trading (called with the single latest completed candle)
 * and future historical backtests (called with a full candle sequence).
 *
 * Locked rules (approved design):
 *   - TP1 = entry ± 1R closes 50%; TP2 = ±2R closes 30%; TP3 = ±3R closes 20%.
 *   - Stop moves to breakeven (entry) once, after TP1. No further trailing.
 *   - Conservative tie-break: if a candle's range spans both the current
 *     stop and the next unfilled TP, the stop wins.
 *   - At most one fill event is recorded per candle evaluation (sequential,
 *     no skipping ahead to a further TP within the same candle).
 *   - trades.initialStop is never touched here — "current stop" is tracked
 *     in PositionState and persisted via append-only trade_stop_moves rows
 *     by the caller, never by mutating the anchor.
 */
import type { Direction } from "@sol-edge/db";

export type TpKind = "TP1" | "TP2" | "TP3";
export type ExitKind = TpKind | "SL";

const TP_ORDER: TpKind[] = ["TP1", "TP2", "TP3"];
const TP_SIZE_PORTIONS: Record<TpKind, number> = { TP1: 0.5, TP2: 0.3, TP3: 0.2 };
const TP_R_MULTIPLES: Record<TpKind, number> = { TP1: 1, TP2: 2, TP3: 3 };

export interface PositionState {
  direction: Direction;
  entryPrice: number;
  riskPerUnit: number; // 1R distance, from the immutable anchor
  filledKinds: TpKind[]; // TPs already filled, in order
  currentStop: number; // initialStop until TP1 fills, then entryPrice
}

export interface FillEvent {
  kind: ExitKind;
  price: number;
  sizePortion: number;
  rMultiple: number;
  movesStopToBreakeven: boolean; // true only for a TP1 fill
}

function tpPrice(state: PositionState, kind: TpKind): number {
  const multiple = TP_R_MULTIPLES[kind];
  return state.direction === "LONG"
    ? state.entryPrice + multiple * state.riskPerUnit
    : state.entryPrice - multiple * state.riskPerUnit;
}

function stopRMultiple(state: PositionState): number {
  return state.direction === "LONG"
    ? (state.currentStop - state.entryPrice) / state.riskPerUnit
    : (state.entryPrice - state.currentStop) / state.riskPerUnit;
}

function remainingSizePortion(state: PositionState): number {
  const filled = state.filledKinds.reduce((sum, k) => sum + TP_SIZE_PORTIONS[k], 0);
  return Number((1 - filled).toFixed(8)); // avoid float noise like 0.19999999999999996
}

/// Single-candle, single-decision check. Returns null if neither the
/// current stop nor the next unfilled TP is touched this candle.
export function checkFill(candle: { high: number; low: number }, state: PositionState): FillEvent | null {
  const nextTp = TP_ORDER.find((k) => !state.filledKinds.includes(k));
  if (!nextTp) return null; // already fully filled

  const stopHit =
    state.direction === "LONG" ? candle.low <= state.currentStop : candle.high >= state.currentStop;

  if (stopHit) {
    // Conservative tie-break: stop wins even if the TP was also touched.
    return {
      kind: "SL",
      price: state.currentStop,
      sizePortion: remainingSizePortion(state),
      rMultiple: stopRMultiple(state),
      movesStopToBreakeven: false,
    };
  }

  const target = tpPrice(state, nextTp);
  const tpHit = state.direction === "LONG" ? candle.high >= target : candle.low <= target;
  if (!tpHit) return null;

  return {
    kind: nextTp,
    price: target,
    sizePortion: TP_SIZE_PORTIONS[nextTp],
    rMultiple: TP_R_MULTIPLES[nextTp],
    movesStopToBreakeven: nextTp === "TP1",
  };
}

/// Folds checkFill over a candle sequence, applying each event to the
/// running state, until the position fully closes (an SL fill, or TP3) or
/// the candles run out. Pure — the caller persists events.
export function simulateExits(initialState: PositionState, candles: Array<{ high: number; low: number }>): FillEvent[] {
  let state: PositionState = { ...initialState, filledKinds: [...initialState.filledKinds] };
  const events: FillEvent[] = [];

  for (const candle of candles) {
    const event = checkFill(candle, state);
    if (!event) continue;

    events.push(event);
    if (event.kind === "SL") break; // fully closed

    state = {
      ...state,
      filledKinds: [...state.filledKinds, event.kind],
      currentStop: event.movesStopToBreakeven ? state.entryPrice : state.currentStop,
    };
    if (state.filledKinds.length === TP_ORDER.length) break; // TP3 filled, fully closed
  }

  return events;
}
