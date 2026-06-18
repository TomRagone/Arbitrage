/**
 * Breaks down net expectancy by trade outcome type (SL before TP1 / TP1
 * then BE / TP1+TP2 then BE / TP3 full winner), reusing the exact same
 * per-trade simulation as cost-model-report.ts via tradeSimulation.ts —
 * no re-simulation, no new logic.
 */
import { getSettings, getSystemConfiguration } from "@sol-edge/db";
import type { CostRates } from "@sol-edge/analytics";
import { loadHistoricalSignals } from "./historicalSignals";
import { simulateTrade, categorizeOutcome, type TradeResult } from "@sol-edge/analytics";

const ASSUMED_ACCOUNT_SIZE = 10000; // same assumption as cost-model-report.ts

const CATEGORY_ORDER = ["SL before TP1", "TP1 then BE", "TP1 + TP2 then BE", "TP3 full winner"];

async function main() {
  const { signals, completedLowerTf } = await loadHistoricalSignals();
  const sysConfig = await getSystemConfiguration();
  const settings = await getSettings();

  const riskAmount = (Number(settings.riskPctPerTrade) / 100) * ASSUMED_ACCOUNT_SIZE;
  const rates: CostRates = {
    feeRateEntry: Number(sysConfig.feeRateEntryBps) / 10000,
    feeRateExit: Number(sysConfig.feeRateExitBps) / 10000,
    slippageRate: Number(sysConfig.slippageBps) / 10000,
  };

  const byCategory = new Map<string, TradeResult[]>();
  for (const { index, signal } of signals) {
    const candlesAfter = completedLowerTf.slice(index + 1);
    const result = simulateTrade(signal, candlesAfter, riskAmount, rates);
    if (!result) continue;
    const category = categorizeOutcome(result.events);
    byCategory.set(category, [...(byCategory.get(category) ?? []), result]);
  }

  const avg = (vals: number[]) => vals.reduce((s, v) => s + v, 0) / vals.length;

  console.log("Outcome                  Count  Avg Gross R  Avg Fees R  Avg Slippage R  Avg Net R");
  let totalCount = 0;
  for (const category of CATEGORY_ORDER) {
    const results = byCategory.get(category) ?? [];
    totalCount += results.length;
    if (results.length === 0) {
      console.log(`${category.padEnd(24)} 0      —            —           —               —`);
      continue;
    }
    const avgGrossR = avg(results.map((r) => r.grossR));
    const avgFeesR = avg(results.map((r) => r.feesR));
    const avgSlippageR = avg(results.map((r) => r.slippageR));
    const avgNetR = avg(results.map((r) => r.netR));
    console.log(
      `${category.padEnd(24)} ${String(results.length).padEnd(6)} ${avgGrossR.toFixed(4).padEnd(12)} ${avgFeesR.toFixed(4).padEnd(11)} ${avgSlippageR.toFixed(4).padEnd(15)} ${avgNetR.toFixed(4)}`,
    );
  }
  console.log(`\nTotal resolved: ${totalCount}/${signals.length}`);
}

main();
