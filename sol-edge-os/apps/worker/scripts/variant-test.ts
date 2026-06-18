/**
 * Tests hypothetical exit-structure variants against the SAME locked
 * entries/filters/stop as the baseline strategy — isolating whether the
 * entry mechanism has edge independent of the specific TP payout
 * structure. Exploratory backtesting only; does not change anything live.
 */
import { getSettings, getSystemConfiguration } from "@sol-edge/db";
import { estimateTradeCosts, type CostRates } from "@sol-edge/analytics";
import { loadHistoricalSignals, computeBiasSeries } from "./historicalSignals";
import { simulateTrade as simulateBaselineTrade } from "@sol-edge/analytics";
import { simulateVariantTrade, type ExitPlan } from "@sol-edge/analytics";

const ASSUMED_ACCOUNT_SIZE = 10000; // same assumption used throughout prior scripts

interface Result {
  grossR: number;
  netR: number;
  fills: number;
}

function aggregate(results: Result[], totalSignals: number) {
  const n = results.length;
  const avg = (vals: number[]) => vals.reduce((s, v) => s + v, 0) / n;
  const profitFactor = (rs: number[]) => {
    const wins = rs.filter((r) => r > 0).reduce((s, r) => s + r, 0);
    const losses = Math.abs(rs.filter((r) => r < 0).reduce((s, r) => s + r, 0));
    return losses > 0 ? wins / losses : Infinity;
  };
  const grossRs = results.map((r) => r.grossR);
  const netRs = results.map((r) => r.netR);
  const wins = netRs.filter((r) => r > 0).length;

  return {
    resolved: n,
    totalSignals,
    avgGrossR: avg(grossRs),
    avgNetR: avg(netRs),
    winRateNet: wins / n,
    profitFactorGross: profitFactor(grossRs),
    profitFactorNet: profitFactor(netRs),
    avgFills: avg(results.map((r) => r.fills)),
  };
}

async function main() {
  const { signals, completedLowerTf, completedTrend } = await loadHistoricalSignals();
  const biasSeries = computeBiasSeries(completedTrend, completedLowerTf);
  const sysConfig = await getSystemConfiguration();
  const settings = await getSettings();

  const riskAmount = (Number(settings.riskPctPerTrade) / 100) * ASSUMED_ACCOUNT_SIZE;
  const rates: CostRates = {
    feeRateEntry: Number(sysConfig.feeRateEntryBps) / 10000,
    feeRateExit: Number(sysConfig.feeRateExitBps) / 10000,
    slippageRate: Number(sysConfig.slippageBps) / 10000,
  };

  console.log(`${signals.length} signals (same entries/filters/stop for every variant). riskAmount=${riskAmount}, rates: entry=${sysConfig.feeRateEntryBps}bps exit=${sysConfig.feeRateExitBps}bps slippage=${sysConfig.slippageBps}bps.\n`);

  // Baseline: the actual locked structure (50%@1R, 30%@2R, 20%@3R).
  const baselineResults: Result[] = [];
  for (const { index, signal } of signals) {
    const candlesAfter = completedLowerTf.slice(index + 1);
    const result = simulateBaselineTrade(signal, candlesAfter, riskAmount, rates);
    if (result) baselineResults.push({ grossR: result.grossR, netR: result.netR, fills: result.events.length + 1 });
  }

  const plans: ExitPlan[] = [
    { name: "Variant A (25%@1R, 25%@2R, 50%@4R)", legs: [{ portion: 0.25, rMultiple: 1 }, { portion: 0.25, rMultiple: 2 }, { portion: 0.5, rMultiple: 4 }], trailRemainder: false },
    { name: "Variant B (100%@3R, no partials)", legs: [{ portion: 1, rMultiple: 3 }], trailRemainder: false },
    { name: "Variant C (50%@1R, 50% trails until trend break)", legs: [{ portion: 0.5, rMultiple: 1 }], trailRemainder: true },
  ];

  const allResults: Array<{ name: string; agg: ReturnType<typeof aggregate> }> = [
    { name: "Baseline (50%@1R,30%@2R,20%@3R)", agg: aggregate(baselineResults, signals.length) },
  ];

  for (const plan of plans) {
    const results: Result[] = [];
    for (const { index, signal } of signals) {
      const candlesAfter = completedLowerTf.slice(index + 1);
      const biasSeriesAfter = biasSeries.slice(index + 1);
      const events = simulateVariantTrade(signal, candlesAfter, biasSeriesAfter, plan);
      if (!events) continue;

      const size = riskAmount / signal.atrValue;
      const grossR = events.reduce((sum, e) => sum + e.sizePortion * e.rMultiple, 0);
      const costs = estimateTradeCosts(signal.entryPrice, size, events, riskAmount, rates);
      results.push({ grossR, netR: grossR - costs.totalCostR, fills: events.length + 1 });
    }
    allResults.push({ name: plan.name, agg: aggregate(results, signals.length) });
  }

  console.log("Variant                                              Resolved  AvgGrossR  AvgNetR   WinRate  PFgross  PFnet   AvgFills");
  for (const { name, agg } of allResults) {
    console.log(
      `${name.padEnd(52)} ${String(agg.resolved).padEnd(9)} ${agg.avgGrossR.toFixed(4).padEnd(10)} ${agg.avgNetR.toFixed(4).padEnd(9)} ${(agg.winRateNet * 100).toFixed(1).padEnd(8)} ${(agg.profitFactorGross === Infinity ? "∞" : agg.profitFactorGross.toFixed(2)).padEnd(8)} ${(agg.profitFactorNet === Infinity ? "∞" : agg.profitFactorNet.toFixed(2)).padEnd(7)} ${agg.avgFills.toFixed(2)}`,
    );
  }
}

main();
