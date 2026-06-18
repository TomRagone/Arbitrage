/**
 * Trade cost model — pure, no I/O. Models fees per fill (not per trade):
 * one entry fill on the full size, plus one exit fill per recorded exit
 * event (TP1/TP2/TP3/SL, each on its own sizePortion of the original
 * size). Slippage applies to the entry fill and to stop-loss exits only
 * (TP exits are treated as fills at/near a known target, not urgent
 * reactive exits) — this matches the originally confirmed cost-function
 * design. Costs are returned in R terms (divided by the trade's immutable
 * 1R risk amount), so they can be subtracted directly from gross R.
 */
export interface CostRates {
  feeRateEntry: number; // decimal, e.g. 0.0016 for 16bps
  feeRateExit: number;
  slippageRate: number;
}

export interface CostFill {
  kind: string; // "SL" triggers the slippage rule; any other label is a target/trend-style exit
  sizePortion: number;
  price: number;
}

export interface TradeCosts {
  feesR: number;
  slippageR: number;
  totalCostR: number;
}

export function estimateTradeCosts(
  entryPrice: number,
  size: number,
  exits: CostFill[],
  riskAmount: number,
  rates: CostRates,
): TradeCosts {
  if (!(riskAmount > 0)) return { feesR: 0, slippageR: 0, totalCostR: 0 };

  const entryNotional = size * entryPrice;
  const entryFee = rates.feeRateEntry * entryNotional;
  const entrySlippage = rates.slippageRate * entryNotional;

  let exitFees = 0;
  let exitSlippage = 0;
  for (const exit of exits) {
    const notional = exit.sizePortion * size * exit.price;
    exitFees += rates.feeRateExit * notional;
    if (exit.kind === "SL") exitSlippage += rates.slippageRate * notional; // slippage: entry + stop exits only
  }

  const totalFees = entryFee + exitFees;
  const totalSlippage = entrySlippage + exitSlippage;

  return {
    feesR: totalFees / riskAmount,
    slippageR: totalSlippage / riskAmount,
    totalCostR: (totalFees + totalSlippage) / riskAmount,
  };
}
