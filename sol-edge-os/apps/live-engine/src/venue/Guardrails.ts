import type { ExecutionVenue, OrderRequest, Fill, VenueState } from "./Venue";

export interface GuardrailConfig {
  readonly maxOrderNotional: number;
  readonly maxTotalExposure: number; // max abs(positionQty * referencePrice) allowed AFTER the order
  readonly maxPositionQtyPerPair: number; // max abs(positionQty) allowed after the order
  readonly maxOrdersPerInterval: number; // rolling-window order cap, catches runaway loops
  readonly intervalMs: number;
  readonly minOrderQty: number; // exchange minimum
  readonly priceSanityBandPct: number; // e.g. 0.05 = reject a LIMIT order whose price deviates >5% from reference
  readonly getReferencePrice: () => number;
}

export interface RejectionLogEntry {
  readonly ts: number;
  readonly order: OrderRequest;
  readonly reason: string;
}

/// Decorates any ExecutionVenue with pre-trade caps. Every rejection is a
/// `{ rejected: string }` with the SPECIFIC reason that fired — never a
/// silent clamp (e.g. shrinking an oversized order down to the cap),
/// because a clamp hides the fact that something upstream asked for more
/// risk than is allowed, which is exactly the signal you want surfaced,
/// not smoothed over. `onRejection` is called for every reject, including
/// ones the caller doesn't otherwise see the return value of, so
/// rejections are always logged regardless of what the caller does with
/// the result.
export function withGuardrails(inner: ExecutionVenue, caps: GuardrailConfig, onRejection?: (entry: RejectionLogEntry) => void): ExecutionVenue {
  // Rolling window of timestamps for every submit() ATTEMPT (not just
  // fills) -- a runaway loop hammering submit() is the failure mode this
  // guards against, so every attempt counts against the budget regardless
  // of whether it would otherwise have been accepted.
  const attemptTimestamps: number[] = [];

  function reject(order: OrderRequest, reason: string): { rejected: string } {
    onRejection?.({ ts: Date.now(), order, reason });
    return { rejected: reason };
  }

  return {
    async getState(): Promise<VenueState> {
      return inner.getState();
    },

    async submit(o: OrderRequest): Promise<Fill | { rejected: string }> {
      const now = Date.now();
      while (attemptTimestamps.length > 0 && now - attemptTimestamps[0] > caps.intervalMs) {
        attemptTimestamps.shift();
      }
      attemptTimestamps.push(now);
      if (attemptTimestamps.length > caps.maxOrdersPerInterval) {
        return reject(o, `rate limit exceeded: ${attemptTimestamps.length} order attempt(s) in the last ${caps.intervalMs}ms (cap ${caps.maxOrdersPerInterval})`);
      }

      if (o.qty < caps.minOrderQty) {
        return reject(o, `qty ${o.qty} is below exchange minimum ${caps.minOrderQty}`);
      }

      const referencePrice = caps.getReferencePrice();
      const effectivePrice = o.type === "LIMIT" && o.limitPrice !== undefined ? o.limitPrice : referencePrice;

      const orderNotional = effectivePrice * o.qty;
      if (orderNotional > caps.maxOrderNotional) {
        return reject(o, `order notional ${orderNotional.toFixed(2)} exceeds max order notional ${caps.maxOrderNotional}`);
      }

      if (o.type === "LIMIT" && o.limitPrice !== undefined) {
        const deviation = Math.abs(o.limitPrice - referencePrice) / referencePrice;
        if (deviation > caps.priceSanityBandPct) {
          return reject(
            o,
            `limit price ${o.limitPrice} deviates ${(deviation * 100).toFixed(2)}% from reference ${referencePrice} — exceeds the ${(caps.priceSanityBandPct * 100).toFixed(2)}% price-sanity band (fat-finger / stale-price guard)`,
          );
        }
      }

      const state = await inner.getState();

      const projectedQty = o.side === "BUY" ? state.positionQty + o.qty : state.positionQty - o.qty;
      if (Math.abs(projectedQty) > caps.maxPositionQtyPerPair) {
        return reject(o, `projected position ${projectedQty} would exceed max position per pair ${caps.maxPositionQtyPerPair}`);
      }

      const projectedExposure = Math.abs(projectedQty) * referencePrice;
      if (projectedExposure > caps.maxTotalExposure) {
        return reject(o, `projected exposure ${projectedExposure.toFixed(2)} would exceed max total exposure ${caps.maxTotalExposure}`);
      }

      // Coarse pre-check using the reference/limit price, not the venue's
      // actual fill price (which includes slippage the guardrail layer
      // has no visibility into before submission) — the inner venue
      // remains authoritative on the real fill and can still reject for
      // balance on its own terms; this just catches the obviously-too-big
      // case before bothering the inner venue at all.
      if (o.side === "BUY") {
        const approxCost = effectivePrice * o.qty;
        if (approxCost > state.balance) {
          return reject(o, `insufficient balance (guardrail pre-check): need ~${approxCost.toFixed(2)}, have ${state.balance.toFixed(2)}`);
        }
      }

      return inner.submit(o);
    },

    async cancelAll(): Promise<void> {
      return inner.cancelAll();
    },
  };
}
