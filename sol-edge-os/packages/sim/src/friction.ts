import type { RawTrade } from "@sol-edge/core";

export interface SimConfig {
  readonly alpha: number; // base spread cost
  readonly beta: number; // volatility amplification
  readonly gammaPanic: number; // exit-under-toxic-flow multiplier
  readonly kappaImpact: number; // market-impact coefficient
  readonly fixedFeeRate: number; // exchange fee tier, applied per fill (entry and exit each pay it once)
}

/// Slip_entry = alpha + beta*sigma + kappa*sqrt(Q/ADV)
export function computeEntrySlippage(config: SimConfig, sigma: number, quantity: number, adv: number): number {
  return config.alpha + config.beta * sigma + config.kappaImpact * Math.sqrt(quantity / adv);
}

/// Slip_exit = alpha + beta*gammaPanic*sigma + kappa*sqrt(Q/ADV)
export function computeExitSlippage(config: SimConfig, sigma: number, quantity: number, adv: number): number {
  return config.alpha + config.beta * config.gammaPanic * sigma + config.kappaImpact * Math.sqrt(quantity / adv);
}

export interface FrictionParams {
  readonly sigmaEntry: number; // volatility at entry fill time
  readonly sigmaExit: number; // volatility at exit fill time
  readonly quantity: number; // Q — trade size
  readonly adv: number; // average daily volume (liquidity denominator)
}

export interface FrictionResult {
  readonly netReturnLog: number;
  readonly entrySlippage: number;
  readonly exitSlippage: number;
  readonly totalFees: number;
}

/// Applies the full friction model to a kernel-produced RawTrade. Slippage
/// and fees are subtracted directly from the log return (small-cost linear
/// approximation — the same convention real-trading cost models in this
/// project already use elsewhere). Fees are per fill: entry and exit each
/// pay fixedFeeRate once, not once per round trip.
export function applyFriction(trade: RawTrade, config: SimConfig, params: FrictionParams): FrictionResult {
  const entrySlippage = computeEntrySlippage(config, params.sigmaEntry, params.quantity, params.adv);
  const exitSlippage = computeExitSlippage(config, params.sigmaExit, params.quantity, params.adv);
  const totalFees = config.fixedFeeRate * 2; // one fee per fill: entry + exit

  const netReturnLog = trade.rawReturnLog - entrySlippage - exitSlippage - totalFees;

  return { netReturnLog, entrySlippage, exitSlippage, totalFees };
}
