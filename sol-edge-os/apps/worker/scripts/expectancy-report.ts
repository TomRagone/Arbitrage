/**
 * Expectancy report over completed (CLOSED) trades.
 *
 * Cost model caveat, stated plainly: fees are computed from the real
 * configured Settings.takerFeeBps (round-trip: entry notional + each exit
 * leg's notional). Slippage is NOT modeled anywhere in this paper system —
 * fills are assumed exact at the computed price — so slippageR is always 0
 * here. Net R therefore only accounts for fees, not slippage; treat it as
 * an optimistic upper bound versus a live-execution outcome.
 *
 * Trades tagged as manual test fixtures (approvedReason starting with
 * "TEST:") are excluded — they're lifecycle-wiring fixtures, not real
 * strategy signals, and would corrupt these numbers if included.
 */
import { getAllTradesWithHistory, getSettings } from "@sol-edge/db";

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  const settings = await getSettings();
  const takerFeeRate = Number(settings.takerFeeBps) / 10000;

  const allTrades = await getAllTradesWithHistory();
  const closed = allTrades.filter((t) => t.status === "CLOSED" && !t.approvedReason?.startsWith("TEST:"));
  const excludedTestCount = allTrades.filter((t) => t.approvedReason?.startsWith("TEST:")).length;

  console.log(`${allTrades.length} total trades, ${excludedTestCount} test fixtures excluded, ${closed.length} real closed trades analyzed.\n`);

  if (closed.length === 0) {
    console.log("No real closed trades yet — nothing to report.");
    return;
  }

  interface Row {
    id: string;
    grossR: number;
    feesR: number;
    slippageR: number;
    netR: number;
    durationMs: number;
    exitPath: string;
  }

  const rows: Row[] = closed.map((t) => {
    const size = Number(t.size);
    const entryPrice = Number(t.entryPrice);
    const riskAmount = Number(t.riskPerUnit) * size; // the immutable 1R dollar anchor

    const exits = [...t.exits].sort((a, b) => a.at.getTime() - b.at.getTime());
    const grossR = exits.reduce((sum, e) => sum + Number(e.sizePortion) * Number(e.rMultiple), 0);

    const entryFee = takerFeeRate * size * entryPrice;
    const exitFees = exits.reduce((sum, e) => sum + takerFeeRate * (Number(e.sizePortion) * size) * Number(e.price), 0);
    const feesR = riskAmount > 0 ? (entryFee + exitFees) / riskAmount : 0;

    const slippageR = 0; // not modeled — see header caveat

    const lastExitAt = exits.length > 0 ? exits[exits.length - 1].at : t.createdAt;
    const durationMs = lastExitAt.getTime() - t.createdAt.getTime();

    return {
      id: t.id,
      grossR,
      feesR,
      slippageR,
      netR: grossR - feesR - slippageR,
      durationMs,
      exitPath: exits.map((e) => e.kind).join("->"),
    };
  });

  console.log("Per-trade detail:");
  for (const r of rows) {
    const minutes = (r.durationMs / 60000).toFixed(1);
    console.log(
      `  ${r.id}  grossR=${r.grossR.toFixed(4)}  feesR=${r.feesR.toFixed(4)}  slippageR=${r.slippageR}  netR=${r.netR.toFixed(4)}  duration=${minutes}min  exitPath=${r.exitPath}`,
    );
  }

  const wins = rows.filter((r) => r.netR > 0);
  const losses = rows.filter((r) => r.netR < 0);
  const winRate = wins.length / rows.length;
  const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r.netR, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, r) => s + r.netR, 0) / losses.length : 0;
  const expectancy = rows.reduce((s, r) => s + r.netR, 0) / rows.length;
  const grossWinR = wins.reduce((s, r) => s + r.netR, 0);
  const grossLossR = Math.abs(losses.reduce((s, r) => s + r.netR, 0));
  const profitFactor = grossLossR > 0 ? grossWinR / grossLossR : Infinity;
  const medianHoldMinutes = median(rows.map((r) => r.durationMs / 60000));

  console.log("\nAggregate (R-multiples, fees-adjusted; slippage not modeled):");
  console.log(`  trades:          ${rows.length}`);
  console.log(`  win rate:        ${(winRate * 100).toFixed(1)}%`);
  console.log(`  avg win:         ${avgWin.toFixed(4)}R`);
  console.log(`  avg loss:        ${avgLoss.toFixed(4)}R`);
  console.log(`  expectancy:      ${expectancy.toFixed(4)}R per trade`);
  console.log(`  profit factor:   ${profitFactor === Infinity ? "∞ (no losses)" : profitFactor.toFixed(2)}`);
  console.log(`  median hold:     ${medianHoldMinutes.toFixed(1)} min`);
}

main();
