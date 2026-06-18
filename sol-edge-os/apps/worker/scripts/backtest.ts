/**
 * Backtest of the EXACT engine (evaluateSignal + decideTrade from
 * src/engine.ts) over whatever historical window Kraken's public OHLC
 * endpoint currently exposes (~180h of 15m data, the bottleneck timeframe).
 *
 * This validates signal generation + rule-pass/reject behavior only — there
 * is no fill/exit simulation yet (Step 5), so this cannot report win rate
 * or expectancy. It reports: how often a signal fires, why rejections
 * happen, and what the approved entries/anchors look like.
 */
import { decideTrade, type RiskSettings, type RiskState } from "../src/engine";
import { loadHistoricalSignals, utcDay } from "./historicalSignals";

async function main() {
  const { spanHours, candlesTrendCount, candlesLowerTfCount, barsEvaluated, signals } = await loadHistoricalSignals();

  console.log(`Backtest window: ${candlesLowerTfCount} 15m candles (~${spanHours.toFixed(1)}h), ${candlesTrendCount} trend-tf candles available.`);
  console.log(`Note: Kraken's public OHLC endpoint does not serve deeper history (confirmed via "since") — this is the full available sample.\n`);

  // Hypothetical risk settings for the backtest (accountSize is assumed —
  // the real configured Settings.accountSize is 0, which would trivially
  // reject every signal at the sizing step and tell us nothing). Risk %,
  // max open positions, and max trades/day are the actual locked values.
  const settings: RiskSettings = {
    riskPctPerTrade: 0.5,
    accountSize: 10000, // ASSUMED for this run — not the real configured value
    maxOpenPositions: 1,
    maxTradesPerDay: 3,
  };

  const state: RiskState = { openPositions: 0, tradesToday: 0 };
  let currentDay = signals.length > 0 ? utcDay(signals[0].time) : 0;

  const rejectionCounts = new Map<string, number>();
  const approvedTrades: Array<{ time: number; direction: string; entry: number; stop: number; size: number; riskAmount: number }> = [];

  for (const { time, signal } of signals) {
    const day = utcDay(time);
    if (day !== currentDay) {
      currentDay = day;
      state.tradesToday = 0;
    }

    const decision = decideTrade(signal, settings, state);
    if (!decision.approved) {
      const ruleCategory = decision.reason.split(":")[0];
      rejectionCounts.set(ruleCategory, (rejectionCounts.get(ruleCategory) ?? 0) + 1);
      continue;
    }

    state.openPositions++; // no exit simulation yet, so positions only accumulate
    state.tradesToday++;
    approvedTrades.push({
      time,
      direction: signal.direction,
      entry: signal.entryPrice,
      stop: decision.initialStop!,
      size: decision.size!,
      riskAmount: decision.riskAmount!,
    });
  }

  console.log(`Bars evaluated (with sufficient warmup): ${barsEvaluated}`);
  console.log(`Signals generated (trend + breakout aligned): ${signals.length} (${((signals.length / barsEvaluated) * 100).toFixed(2)}% of evaluated bars)`);
  console.log(`Approved: ${approvedTrades.length}`);
  console.log(`Rejected: ${signals.length - approvedTrades.length}, by rule category:`);
  for (const [rule, count] of rejectionCounts) console.log(`  - ${rule}: ${count}`);

  console.log(`\nApproved trades (assumed accountSize=${settings.accountSize}, riskPct=${settings.riskPctPerTrade}%):`);
  for (const t of approvedTrades) {
    console.log(`  ${new Date(t.time * 1000).toISOString()} ${t.direction} entry=${t.entry} stop=${t.stop.toFixed(4)} size=${t.size.toFixed(4)} riskAmount=${t.riskAmount}`);
  }
  if (approvedTrades.length === 0) console.log("  (none)");
}

main();
