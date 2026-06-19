/**
 * The execution port (Phase 10D.1). PaperVenue (10D.2), the guardrail
 * decorator (10D.3), and LiveVenue (10D.4) all implement this same
 * interface — the only difference between paper and live is which
 * implementation a runtime is constructed against. If a caller needs to
 * branch on which venue it's talking to, that's a sign paper has stopped
 * de-risking live.
 */

/// clientOrderId is the idempotency key: a venue must treat a resubmit
/// with the same id as a no-op (see LiveVenue, 10D.4) rather than placing
/// a duplicate order.
export interface OrderRequest {
  readonly clientOrderId: string;
  readonly side: "BUY" | "SELL";
  readonly qty: number;
  readonly type: "MARKET" | "LIMIT";
  readonly limitPrice?: number;
}

export interface Fill {
  readonly clientOrderId: string;
  readonly qty: number;
  readonly price: number;
  readonly feePaid: number;
  readonly ts: number;
}

export interface VenueState {
  readonly balance: number;
  readonly positionQty: number;
  readonly openOrders: readonly OrderRequest[];
}

/// submit() returns a Fill on success or a tagged rejection — never
/// throws for an ordinary reject (a guardrail breach, insufficient
/// balance, exchange-side rejection). Throwing is reserved for failures
/// the caller cannot reasonably interpret as "this order didn't go
/// through" (e.g. a network error of ambiguous outcome — see LiveVenue's
/// explicit-status-check requirement in 10D.4).
export interface ExecutionVenue {
  getState(): Promise<VenueState>;
  submit(o: OrderRequest): Promise<Fill | { rejected: string }>;
  cancelAll(): Promise<void>;
}
