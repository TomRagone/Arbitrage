import { computeEntrySlippage, type SimConfig } from "@sol-edge/sim";
import type { ExecutionVenue, Fill, OrderRequest, VenueState } from "./Venue";

/// What PaperVenue needs from the outside world each time it fills an
/// order — a reference price and the volatility input the calibrated
/// slippage formula expects. Injected rather than fetched internally so
/// PaperVenue stays a pure simulator with no network/IO of its own.
export interface MarketSnapshot {
  readonly referencePrice: number;
  readonly sigma: number;
}

export type MarketSnapshotProvider = () => MarketSnapshot;

export interface PaperVenueConfig {
  readonly initialBalance: number;
  /// Same SimConfig (alpha/beta/gammaPanic/kappaImpact/fixedFeeRate) the
  /// Phase 10B calibration produced and Phase 10C's backtests assumed —
  /// using it here is the whole point: paper P&L reflects the same
  /// reality gap the research already accounted for, not a fresh guess.
  readonly simConfig: SimConfig;
  /// Average daily volume — the liquidity denominator in the slippage
  /// formula. Order qty (not a fixed config value) is the numerator, so
  /// larger orders see more modeled impact, same as the backtest.
  readonly adv: number;
  /// Same seed -> same fill sequence, every run (the only randomness is
  /// a small jitter around the modeled slippage band — see submit()).
  readonly seed: number;
}

/// Mulberry32 — small, dependency-free, deterministic PRNG. Not
/// cryptographic; doesn't need to be, this is simulation jitter, not a
/// security boundary.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/// Implements ExecutionVenue against a virtual balance — no network, no
/// real exchange. Fills are computed through the same calibrated
/// friction model the research backtests used (computeEntrySlippage),
/// not a placeholder. LIMIT orders that aren't immediately marketable
/// are rejected outright rather than queued as resting orders — this
/// venue does not simulate an order book, and pretending to support
/// resting orders without actually filling them later would be a worse
/// lie than just rejecting honestly. openOrders is therefore always
/// empty and cancelAll() has nothing to cancel; both remain real,
/// callable methods (not stubs) because every later layer — guardrails,
/// reconciliation, kill switch — depends on calling them uniformly
/// across whichever ExecutionVenue it's wrapping.
export class PaperVenue implements ExecutionVenue {
  private balance: number;
  private positionQty = 0;
  private readonly rng: () => number;

  constructor(
    private readonly config: PaperVenueConfig,
    private readonly getMarketSnapshot: MarketSnapshotProvider,
  ) {
    this.balance = config.initialBalance;
    this.rng = mulberry32(config.seed);
  }

  async getState(): Promise<VenueState> {
    return { balance: this.balance, positionQty: this.positionQty, openOrders: [] };
  }

  async submit(o: OrderRequest): Promise<Fill | { rejected: string }> {
    if (!(o.qty > 0)) {
      return { rejected: `qty must be > 0, got ${o.qty}` };
    }

    const snapshot = this.getMarketSnapshot();

    if (o.type === "LIMIT") {
      if (o.limitPrice === undefined) {
        return { rejected: "LIMIT order missing limitPrice" };
      }
      const marketable = o.side === "BUY" ? o.limitPrice >= snapshot.referencePrice : o.limitPrice <= snapshot.referencePrice;
      if (!marketable) {
        return { rejected: "LIMIT order not immediately marketable — PaperVenue does not simulate resting orders" };
      }
    }

    // Same formula the backtests assumed. "Entry" slippage is used for
    // every fill regardless of side — the venue layer has no concept of
    // position-entry vs position-exit, only "a fill is happening now".
    const baseSlippage = computeEntrySlippage(this.config.simConfig, snapshot.sigma, o.qty, this.config.adv);
    // Deterministic jitter within +/-20% of the modeled slippage band —
    // same seed produces the same fill sequence every run.
    const jitter = (this.rng() * 2 - 1) * 0.2 * baseSlippage;
    const slippage = baseSlippage + jitter;

    const signedSlippage = o.side === "BUY" ? slippage : -slippage; // BUY pays up, SELL receives down
    const fillPrice = snapshot.referencePrice * (1 + signedSlippage);
    const feePaid = fillPrice * o.qty * this.config.simConfig.fixedFeeRate;

    if (o.side === "BUY") {
      const cost = fillPrice * o.qty + feePaid;
      if (cost > this.balance) {
        return { rejected: `insufficient balance: need ${cost.toFixed(2)}, have ${this.balance.toFixed(2)}` };
      }
      this.balance -= cost;
      this.positionQty += o.qty;
    } else {
      const proceeds = fillPrice * o.qty - feePaid;
      this.balance += proceeds;
      this.positionQty -= o.qty;
    }

    return { clientOrderId: o.clientOrderId, qty: o.qty, price: fillPrice, feePaid, ts: Date.now() };
  }

  async cancelAll(): Promise<void> {
    // No resting orders in this model — nothing to cancel. See class doc.
  }
}
