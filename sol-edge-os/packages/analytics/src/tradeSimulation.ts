/**
 * Baseline (locked-structure) per-signal trade simulation + cost
 * application. Used by every diagnostic that needs "what would this
 * signal have done under the actual locked exit structure" — cost
 * reports, outcome breakdowns, MFE/MAE analysis — so they can't drift
 * from the same computation.
 */
import type { Direction } from "@sol-edge/db";
import { simulateExits, type PositionState, type FillEvent } from "./lifecycle";
import { estimateTradeCosts, type CostRates } from "./costs";

export interface TradeResult {
  events: FillEvent[];
  grossR: number;
  feesR: number;
  slippageR: number;
  netR: number;
}

export function simulateTrade(
  signal: { direction: Direction; entryPrice: number; atrValue: number },
  candlesAfter: Array<{ high: number; low: number }>,
  riskAmount: number,
  rates: CostRates,
): TradeResult | null {
  const initialStop = signal.direction === "LONG" ? signal.entryPrice - signal.atrValue : signal.entryPrice + signal.atrValue;
  const state: PositionState = {
    direction: signal.direction,
    entryPrice: signal.entryPrice,
    riskPerUnit: signal.atrValue,
    filledKinds: [],
    currentStop: initialStop,
  };
  const events = simulateExits(state, candlesAfter);
  const resolved = events.some((e) => e.kind === "SL") || events.some((e) => e.kind === "TP3");
  if (!resolved) return null;

  const size = riskAmount / signal.atrValue; // same formula as decideTrade
  const grossR = events.reduce((sum, e) => sum + e.sizePortion * e.rMultiple, 0);
  const costs = estimateTradeCosts(signal.entryPrice, size, events, riskAmount, rates);

  return { events, grossR, feesR: costs.feesR, slippageR: costs.slippageR, netR: grossR - costs.totalCostR };
}

/// Categorizes a resolved trade by its exit path. The locked TP structure
/// means these four categories are exhaustive for any resolved trade.
export function categorizeOutcome(events: FillEvent[]): string {
  const kinds = events.map((e) => e.kind);
  if (kinds[0] === "SL") return "SL before TP1";
  if (kinds.includes("TP3")) return "TP3 full winner";
  if (kinds.includes("TP2")) return "TP1 + TP2 then BE";
  return "TP1 then BE";
}
