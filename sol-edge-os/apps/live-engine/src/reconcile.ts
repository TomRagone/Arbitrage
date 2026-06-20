import type { ExecutionVenue } from "./venue/Venue";

/// What the runtime believes its own state is — compared against
/// whatever ExecutionVenue.getState() reports, which is always treated
/// as ground truth. The runtime's view can drift from reality (a missed
/// fill event, a bug in local bookkeeping, a race) and reconciliation
/// exists specifically to catch that drift before it causes a bad order.
export interface RuntimeStateView {
  readonly balance: number;
  readonly positionQty: number;
}

export interface ReconciliationConfig {
  readonly balanceTolerance: number;
  readonly positionTolerance: number;
}

export interface ReconciliationResult {
  readonly ok: boolean;
  readonly mismatches: readonly string[];
}

export class TradingHaltedError extends Error {}

/// On startup and on every fixed-interval check, compares the venue's
/// true state (the exchange, in 10D.4 — but the venue itself is
/// whatever ExecutionVenue this is constructed against, including
/// PaperVenue) against the runtime's own tracked view. Any disagreement
/// beyond tolerance halts trading; there is no automatic un-halt — a
/// SUBSEQUENT reconcile() call must observe agreement before halted
/// flips back to false. The venue is never overridden by the runtime's
/// view — it wins, always, by construction (this class only ever reads
/// from it, never writes the runtime's belief back into it).
export class Reconciler {
  private halted = false;

  constructor(
    private readonly venue: ExecutionVenue,
    private readonly config: ReconciliationConfig,
  ) {}

  isHalted(): boolean {
    return this.halted;
  }

  async reconcile(runtimeView: RuntimeStateView): Promise<ReconciliationResult> {
    const trueState = await this.venue.getState();
    const mismatches: string[] = [];

    const balanceDiff = Math.abs(trueState.balance - runtimeView.balance);
    if (balanceDiff > this.config.balanceTolerance) {
      mismatches.push(
        `balance mismatch: venue=${trueState.balance}, runtime=${runtimeView.balance}, diff=${balanceDiff} exceeds tolerance ${this.config.balanceTolerance}`,
      );
    }

    const positionDiff = Math.abs(trueState.positionQty - runtimeView.positionQty);
    if (positionDiff > this.config.positionTolerance) {
      mismatches.push(
        `position mismatch: venue=${trueState.positionQty}, runtime=${runtimeView.positionQty}, diff=${positionDiff} exceeds tolerance ${this.config.positionTolerance}`,
      );
    }

    if (mismatches.length > 0) {
      this.halted = true;
      return { ok: false, mismatches };
    }

    this.halted = false; // a clean reconcile is the only thing that clears a prior halt
    return { ok: true, mismatches: [] };
  }

  /// Callers on the order-submission path should call this before doing
  /// anything order-related — throws if a mismatch is currently
  /// unresolved, refusing to trade until reconcile() observes agreement.
  assertNotHalted(): void {
    if (this.halted) {
      throw new TradingHaltedError(
        "Trading halted: local/exchange state mismatch unresolved. Call reconcile() again and confirm agreement before resuming.",
      );
    }
  }
}
