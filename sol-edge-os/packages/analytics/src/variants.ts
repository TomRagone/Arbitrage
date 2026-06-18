/**
 * Generalized exit-plan simulator for testing hypothetical TP/payout
 * structures against the SAME locked entries, filters, and initial stop —
 * exploratory backtesting only, does not touch src/lifecycle.ts (the
 * locked production exit logic) or change anything live.
 *
 * Same rules carried over from the locked design: conservative tie-break
 * (stop checked before targets each candle), stop moves to breakeven once
 * after the first leg fills, at most one fill event per candle.
 */
import type { Direction } from "@sol-edge/db";
import type { Bias } from "@sol-edge/strategy";

export interface ExitLeg {
  portion: number;
  rMultiple: number;
}

export interface ExitPlan {
  name: string;
  legs: ExitLeg[]; // fixed-R-target legs, filled in order
  trailRemainder: boolean; // after all legs fill, remaining portion (if any) exits on a trend-bias flip instead of a fixed target
}

export interface VariantFillEvent {
  kind: string; // "LEG1(1R)", "TREND_EXIT", or "SL"
  sizePortion: number;
  rMultiple: number;
  price: number;
}

interface VariantState {
  direction: Direction;
  entryPrice: number;
  riskPerUnit: number;
  currentStop: number;
  filledPortion: number;
  legIndex: number;
  stopMovedToBreakeven: boolean;
}

function round8(n: number): number {
  return Number(n.toFixed(8));
}

/// Returns the full event list if the trade resolves (hits stop, fully
/// fills all legs with no remainder, or the trailing remainder exits on a
/// trend break) within the given candles; null if it never resolves.
export function simulateVariantTrade(
  signal: { direction: Direction; entryPrice: number; atrValue: number; bias: Bias },
  candlesAfter: Array<{ high: number; low: number; close: number }>,
  biasSeriesAfter: Bias[],
  plan: ExitPlan,
): VariantFillEvent[] | null {
  const initialStop = signal.direction === "LONG" ? signal.entryPrice - signal.atrValue : signal.entryPrice + signal.atrValue;
  let state: VariantState = {
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    riskPerUnit: signal.atrValue,
    currentStop: initialStop,
    filledPortion: 0,
    legIndex: 0,
    stopMovedToBreakeven: false,
  };
  const events: VariantFillEvent[] = [];

  for (let i = 0; i < candlesAfter.length; i++) {
    const candle = candlesAfter[i];

    const stopHit = state.direction === "LONG" ? candle.low <= state.currentStop : candle.high >= state.currentStop;
    if (stopHit) {
      const rMultiple =
        state.direction === "LONG"
          ? (state.currentStop - state.entryPrice) / state.riskPerUnit
          : (state.entryPrice - state.currentStop) / state.riskPerUnit;
      events.push({ kind: "SL", sizePortion: round8(1 - state.filledPortion), rMultiple, price: state.currentStop });
      return events;
    }

    if (state.legIndex < plan.legs.length) {
      const leg = plan.legs[state.legIndex];
      const target =
        state.direction === "LONG" ? state.entryPrice + leg.rMultiple * state.riskPerUnit : state.entryPrice - leg.rMultiple * state.riskPerUnit;
      const hit = state.direction === "LONG" ? candle.high >= target : candle.low <= target;
      if (hit) {
        events.push({ kind: `LEG${state.legIndex + 1}(${leg.rMultiple}R)`, sizePortion: leg.portion, rMultiple: leg.rMultiple, price: target });
        state = {
          ...state,
          filledPortion: round8(state.filledPortion + leg.portion),
          legIndex: state.legIndex + 1,
          currentStop: state.stopMovedToBreakeven ? state.currentStop : state.entryPrice,
          stopMovedToBreakeven: true,
        };
        if (state.filledPortion >= 1 - 1e-8) return events; // fully closed, no remainder
        continue;
      }
    }

    if (state.legIndex >= plan.legs.length && plan.trailRemainder && state.filledPortion < 1 - 1e-8) {
      const bias = biasSeriesAfter[i];
      const trendBroke = bias !== "NONE" && bias !== signal.bias;
      if (trendBroke) {
        const exitPrice = candle.close;
        const rMultiple =
          state.direction === "LONG" ? (exitPrice - state.entryPrice) / state.riskPerUnit : (state.entryPrice - exitPrice) / state.riskPerUnit;
        events.push({ kind: "TREND_EXIT", sizePortion: round8(1 - state.filledPortion), rMultiple, price: exitPrice });
        return events;
      }
    }
  }

  return null; // never resolved within available data
}
