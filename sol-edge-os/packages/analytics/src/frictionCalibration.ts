/**
 * Phase 10B — derives @sol-edge/sim's SimConfig/FrictionParams from real,
 * measurable data at the locked venue (config/market.json), instead of
 * the round-number placeholders @sol-edge/research's search.ts shipped
 * with. Pure, no I/O — the calling script supplies the already-fetched
 * candles/ticker/fee-tier.
 *
 * What's actually measured vs. assumed (see STEP4_STRATEGY_SPEC.md's
 * slippageBps note for the precedent on flagging unmeasured figures):
 *   - alpha (half-spread) and fixedFeeRate (taker fee) are REAL — read
 *     from a live ticker snapshot and the pre-registered fee schedule.
 *   - sigma_t (per-bar volatility) and ADV are REAL — computed from the
 *     ingested OHLCV series itself.
 *   - beta and kappaImpact are NOT empirically fittable: Kraken's public
 *     API has no historical order-book or fill/slippage data to regress
 *     against. They're derived via a documented spread-relative
 *     heuristic instead (see deriveCalibratedFriction below) — an
 *     assumption, not a measurement.
 *   - gammaPanic has no real-data anchor at all (not even a spread
 *     proxy) and is left as the prior placeholder, unchanged.
 */
import type { FrictionParams, SimConfig } from "@sol-edge/sim";
import { median } from "./stats";

export interface OhlcvPoint {
  readonly timestamp: number; // unix seconds, bar open
  readonly close: number;
  readonly volume: number; // base-asset units
}

/// Close-to-close log returns. One fewer element than `bars` — no return
/// is defined for the first bar.
export function estimateBarLogReturns(bars: readonly OhlcvPoint[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    returns.push(Math.log(bars[i].close / bars[i - 1].close));
  }
  return returns;
}

/// Average daily base-asset volume — groups bars by UTC day and averages
/// across however many distinct days the ingested series covers. Bars are
/// assumed already filtered to one (exchange, pair, resolution) series.
export function estimateAverageDailyVolume(bars: readonly OhlcvPoint[]): number {
  if (bars.length === 0) return NaN;
  const byDay = new Map<number, number>();
  for (const bar of bars) {
    const day = Math.floor(bar.timestamp / 86400);
    byDay.set(day, (byDay.get(day) ?? 0) + bar.volume);
  }
  const dailyTotals = [...byDay.values()];
  return dailyTotals.reduce((sum, v) => sum + v, 0) / dailyTotals.length;
}

export interface CalibrationInputs {
  readonly takerFeeBps: number; // config/market.json feeTier.takerFeeBps
  readonly bidPrice: number; // live ticker bid
  readonly askPrice: number; // live ticker ask
  readonly sigmaSeries: readonly number[]; // estimateBarLogReturns output
  readonly adv: number; // estimateAverageDailyVolume output
  readonly referenceImpactRatio: number; // assumed Q/ADV reference point, e.g. 0.01 = 1%
  readonly gammaPanic: number; // carried through unchanged — no real-data anchor exists for this one
}

export interface CalibrationResult {
  readonly simConfig: SimConfig;
  readonly frictionParams: FrictionParams;
  readonly measured: {
    readonly spreadFraction: number;
    readonly medianSigma: number;
    readonly adv: number;
    readonly fixedFeeRate: number;
  };
  readonly assumed: {
    readonly referenceImpactRatio: number;
    readonly gammaPanic: number;
  };
}

/// Derives a venue-calibrated SimConfig/FrictionParams pair.
///   alpha          = spreadFraction / 2                   (REAL: half the live spread)
///   fixedFeeRate   = takerFeeBps / 10000                   (REAL: pre-registered fee tier)
///   beta           = alpha / median(sigmaSeries)           (ASSUMED heuristic: volatility-driven
///                                                            slippage is the same order of
///                                                            magnitude as spread-driven slippage
///                                                            at typical volatility)
///   kappaImpact    = alpha / sqrt(referenceImpactRatio)    (ASSUMED heuristic: sized so the
///                                                            impact term equals exactly 1x the
///                                                            spread at quantity/adv = referenceImpactRatio)
///   quantity       = adv * referenceImpactRatio            (kept self-consistent with kappaImpact's
///                                                            own reference point, by construction)
export function deriveCalibratedFriction(inputs: CalibrationInputs): CalibrationResult {
  if (!(inputs.askPrice > inputs.bidPrice)) {
    throw new Error(`deriveCalibratedFriction: askPrice (${inputs.askPrice}) must be > bidPrice (${inputs.bidPrice})`);
  }
  if (inputs.sigmaSeries.length === 0) {
    throw new Error("deriveCalibratedFriction: sigmaSeries must not be empty");
  }
  if (!(inputs.adv > 0)) {
    throw new Error(`deriveCalibratedFriction: adv must be > 0, got ${inputs.adv}`);
  }
  if (!(inputs.referenceImpactRatio > 0)) {
    throw new Error(`deriveCalibratedFriction: referenceImpactRatio must be > 0, got ${inputs.referenceImpactRatio}`);
  }

  const midPrice = (inputs.bidPrice + inputs.askPrice) / 2;
  const spreadFraction = (inputs.askPrice - inputs.bidPrice) / midPrice;
  const alpha = spreadFraction / 2;
  const fixedFeeRate = inputs.takerFeeBps / 10000;

  const medianSigma = median([...inputs.sigmaSeries].map(Math.abs));
  const beta = alpha / medianSigma;
  const kappaImpact = alpha / Math.sqrt(inputs.referenceImpactRatio);

  const simConfig: SimConfig = {
    alpha,
    beta,
    gammaPanic: inputs.gammaPanic,
    kappaImpact,
    fixedFeeRate,
  };
  const frictionParams: FrictionParams = {
    sigmaEntry: medianSigma,
    sigmaExit: medianSigma,
    quantity: inputs.adv * inputs.referenceImpactRatio,
    adv: inputs.adv,
  };

  return {
    simConfig,
    frictionParams,
    measured: { spreadFraction, medianSigma, adv: inputs.adv, fixedFeeRate },
    assumed: { referenceImpactRatio: inputs.referenceImpactRatio, gammaPanic: inputs.gammaPanic },
  };
}
