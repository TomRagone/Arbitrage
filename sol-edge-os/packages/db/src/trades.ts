import { prisma } from "./client";
import type { Direction } from "@prisma/client";

export type OpenPaperTradeInput = {
  pair: string;
  direction: Direction;
  entryPrice: number;
  initialStop: number;
  takeProfit: number;
  riskPerUnit: number;
  rMultipleTarget: number;
  size: number;
  approvedReason?: string;
};

/// Create a paper (dry-run) trade row. initialStop is written once here and
/// is never updated afterward — enforced in the DB by a trigger
/// (prisma/sql/trade_immutability.sql), not just by app discipline.
export async function openPaperTrade(input: OpenPaperTradeInput) {
  return prisma.trade.create({
    data: {
      mode: "PAPER",
      pair: input.pair,
      direction: input.direction,
      entryPrice: input.entryPrice,
      initialStop: input.initialStop,
      takeProfit: input.takeProfit,
      riskPerUnit: input.riskPerUnit,
      rMultipleTarget: input.rMultipleTarget,
      size: input.size,
      approvedReason: input.approvedReason,
    },
  });
}

/// Risk cap input: how many trades are currently OPEN.
export async function countOpenTrades(): Promise<number> {
  return prisma.trade.count({ where: { status: "OPEN" } });
}

/// Risk cap input: how many trades were created today (UTC day boundary).
export async function countTradesToday(): Promise<number> {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  return prisma.trade.count({ where: { createdAt: { gte: startOfDayUtc } } });
}

/// All trades still open — what the worker checks for fills each tick.
export async function getOpenTrades() {
  return prisma.trade.findMany({ where: { status: "OPEN" } });
}

/// A trade's exit history, oldest first — used to derive which TP levels
/// have already filled.
export async function getTradeExits(tradeId: string) {
  return prisma.tradeExit.findMany({ where: { tradeId }, orderBy: { at: "asc" } });
}

/// The most recent stop move for a trade, if any. The current effective
/// stop is this row's toPrice, or the trade's immutable initialStop if
/// there isn't one yet.
export async function getLatestStopMove(tradeId: string) {
  return prisma.tradeStopMove.findFirst({ where: { tradeId }, orderBy: { at: "desc" } });
}

export type RecordPartialExitInput = {
  tradeId: string;
  kind: string; // "TP1" | "TP2" | "TP3" | "SL"
  price: number;
  sizePortion: number;
  rMultiple: number;
};

/// Append a partial (or full) exit event. Never updated or deleted —
/// enforced by a DB trigger (prisma/sql/trade_immutability.sql).
export async function recordPartialExit(input: RecordPartialExitInput) {
  return prisma.tradeExit.create({
    data: {
      tradeId: input.tradeId,
      kind: input.kind,
      price: input.price,
      sizePortion: input.sizePortion,
      rMultiple: input.rMultiple,
    },
  });
}

export type RecordStopMoveInput = {
  tradeId: string;
  fromPrice: number;
  toPrice: number;
  reason: string;
};

/// Append a stop-move event (e.g. to breakeven after TP1). trades.initial_stop
/// is never touched — this is how the "current stop" changes without ever
/// mutating the immutable 1R anchor.
export async function recordStopMove(input: RecordStopMoveInput) {
  return prisma.tradeStopMove.create({
    data: {
      tradeId: input.tradeId,
      fromPrice: input.fromPrice,
      toPrice: input.toPrice,
      reason: input.reason,
    },
  });
}

/// Mark a trade fully closed. Only the status field changes — initialStop
/// remains the permanent anchor, enforced by the same DB trigger.
export async function closeTrade(tradeId: string) {
  return prisma.trade.update({ where: { id: tradeId }, data: { status: "CLOSED" } });
}

/// Every trade with its full exit/stop-move history, oldest first — for
/// integrity audits and expectancy reporting (not the live tick path).
export async function getAllTradesWithHistory() {
  return prisma.trade.findMany({
    include: {
      exits: { orderBy: { at: "asc" } },
      stopMoves: { orderBy: { at: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
}
