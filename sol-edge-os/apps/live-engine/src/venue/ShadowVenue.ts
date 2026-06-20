import type { ExecutionVenue, Fill, OrderRequest, VenueState } from "./Venue";

export interface IntendedOrder {
  readonly order: OrderRequest;
  readonly ts: number;
}

/// Wraps a venue (or a state-only stand-in for one) so getState() and
/// cancelAll() pass through normally, but submit() NEVER reaches the
/// inner venue — it logs what would have been submitted and returns
/// immediately. Intended to sit INSIDE withGuardrails (i.e.
/// withGuardrails(withShadowMode(inner, log), caps)), so guardrail
/// rejections are still real and still happen first — only an order
/// that guardrails would actually approve ever reaches this wrapper's
/// submit(), which is exactly "the orders it would have sent" the
/// shadow-mode brief describes. Because inner.submit() is never called,
/// there is no network call, no fill, no balance/position mutation —
/// zero submits occur, by construction, not by convention.
export function withShadowMode(inner: ExecutionVenue, onIntendedOrder: (intended: IntendedOrder) => void): ExecutionVenue {
  return {
    async getState(): Promise<VenueState> {
      return inner.getState();
    },

    async submit(o: OrderRequest): Promise<Fill | { rejected: string }> {
      onIntendedOrder({ order: o, ts: Date.now() });
      return { rejected: "SHADOW MODE: order computed and guardrail-checked, intentionally NOT submitted (dry run)" };
    },

    async cancelAll(): Promise<void> {
      return inner.cancelAll();
    },
  };
}
