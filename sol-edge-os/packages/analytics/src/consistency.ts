/**
 * Lifecycle consistency checker — pure, no I/O. Checks a single trade's
 * exit/stop-move history against the locked lifecycle invariants. Used by
 * the nightly integrity audit; could equally be run against a backtest's
 * simulated history.
 */
const EPSILON = 1e-6;
const TP_ORDER = ["TP1", "TP2", "TP3"] as const;

export interface ConsistencyExit {
  kind: string;
  sizePortion: number;
  at: Date;
}

export interface ConsistencyStopMove {
  at: Date;
}

export interface ConsistencyTrade {
  id: string;
  status: "OPEN" | "CLOSED";
  exits: ConsistencyExit[];
  stopMoves: ConsistencyStopMove[];
}

export interface Violation {
  tradeId: string;
  rule: string;
  detail: string;
}

export function checkTradeConsistency(trade: ConsistencyTrade): Violation[] {
  const violations: Violation[] = [];
  const exits = [...trade.exits].sort((a, b) => a.at.getTime() - b.at.getTime());
  const totalPortion = exits.reduce((sum, e) => sum + e.sizePortion, 0);

  // Remaining position can never go negative, i.e. total filled can never
  // exceed 1.0 — applies to OPEN trades too, not just CLOSED ones.
  if (totalPortion > 1 + EPSILON) {
    violations.push({
      tradeId: trade.id,
      rule: "remaining_negative",
      detail: `size portions sum to ${totalPortion}, exceeding 1.0 (remaining would be negative)`,
    });
  }

  // Size portions must sum to exactly 1.0 — but only once CLOSED. An OPEN
  // trade legitimately has a partial sum (e.g. 0.5 after just TP1).
  if (trade.status === "CLOSED" && Math.abs(totalPortion - 1) > EPSILON) {
    violations.push({
      tradeId: trade.id,
      rule: "size_portions_not_one",
      detail: `closed trade's size portions sum to ${totalPortion}, expected exactly 1.0`,
    });
  }

  // TP order must be TP1 -> TP2 -> TP3: the chronological sequence of TP
  // exits must be an exact, non-repeating prefix of [TP1, TP2, TP3].
  const tpSequence = exits.map((e) => e.kind).filter((k) => (TP_ORDER as readonly string[]).includes(k));
  const expectedPrefix = TP_ORDER.slice(0, tpSequence.length);
  if (tpSequence.join(",") !== expectedPrefix.join(",")) {
    violations.push({
      tradeId: trade.id,
      rule: "tp_order_violated",
      detail: `TP exit sequence was [${tpSequence.join(",")}], expected a prefix of [${TP_ORDER.join(",")}]`,
    });
  }

  // Stop move cannot exist before TP1 (the only stop move in v1 is the
  // breakeven move triggered by TP1 filling).
  if (trade.stopMoves.length > 0) {
    const firstTp1 = exits.find((e) => e.kind === "TP1");
    const firstStopMove = trade.stopMoves[0];
    if (!firstTp1 || firstStopMove.at.getTime() < firstTp1.at.getTime()) {
      violations.push({
        tradeId: trade.id,
        rule: "stop_move_before_tp1",
        detail: firstTp1
          ? `stop move at ${firstStopMove.at.toISOString()} precedes TP1 fill at ${firstTp1.at.toISOString()}`
          : `stop move recorded but no TP1 fill exists for this trade`,
      });
    }
    // Not explicitly requested, but directly checks the approved design
    // rule that the stop moves exactly once (no further trailing in v1).
    if (trade.stopMoves.length > 1) {
      violations.push({
        tradeId: trade.id,
        rule: "multiple_stop_moves",
        detail: `${trade.stopMoves.length} stop moves recorded, expected at most 1 (breakeven-after-TP1 only)`,
      });
    }
  }

  // Closed trade cannot have later events: once cumulative size reaches
  // 1.0, no further exit should exist after that point in time.
  if (trade.status === "CLOSED" && exits.length > 0) {
    let cumulative = 0;
    let closedAt: Date | null = null;
    for (const exit of exits) {
      if (closedAt) {
        violations.push({
          tradeId: trade.id,
          rule: "events_after_closure",
          detail: `exit ${exit.kind} at ${exit.at.toISOString()} occurs after the trade was already fully closed at ${closedAt.toISOString()}`,
        });
        continue;
      }
      cumulative += exit.sizePortion;
      if (cumulative >= 1 - EPSILON) closedAt = exit.at;
    }
  }

  return violations;
}

/// Adapter from Prisma's shape (Decimal fields, relations) to the plain
/// numbers checkTradeConsistency expects. Decimal objects coerce to
/// strings under `+`/`-` (not numbers) — passing them through unconverted
/// silently breaks every sum-based check here without throwing.
export function toConsistencyTrade(trade: {
  id: string;
  status: "OPEN" | "CLOSED";
  exits: Array<{ kind: string; sizePortion: unknown; at: Date }>;
  stopMoves: Array<{ at: Date }>;
}): ConsistencyTrade {
  return {
    id: trade.id,
    status: trade.status,
    exits: trade.exits.map((e) => ({ kind: e.kind, sizePortion: Number(e.sizePortion), at: e.at })),
    stopMoves: trade.stopMoves.map((m) => ({ at: m.at })),
  };
}
