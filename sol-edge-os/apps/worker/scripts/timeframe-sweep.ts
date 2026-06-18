/**
 * The timeframe sweep. Sweeps the entry/breakout timeframe across
 * 15m/1H/4H/1D using the shared runDiagnostic pipeline (the same code
 * path the live worker and every other diagnostic in this repo share via
 * @sol-edge/analytics). Trend timeframe scales with entry timeframe per
 * STEP4_STRATEGY_SPEC.md Addendum 1 (trendIntervalFor) — not fixed at 1H.
 *
 * Optional CLI args filter which intervals to run, e.g.
 * `tsx scripts/timeframe-sweep.ts 4H 1D` — useful for re-running just the
 * higher timeframes without re-pulling/re-computing 15m/1H every time.
 */
import { getSettings, getSystemConfiguration } from "@sol-edge/db";
import { runDiagnostic, type CostRates } from "@sol-edge/analytics";

const ASSUMED_ACCOUNT_SIZE = 10000; // same assumption used throughout every prior diagnostic

async function main() {
  const sysConfig = await getSystemConfiguration();
  const settings = await getSettings();
  const riskAmount = (Number(settings.riskPctPerTrade) / 100) * ASSUMED_ACCOUNT_SIZE;
  const rates: CostRates = {
    feeRateEntry: Number(sysConfig.feeRateEntryBps) / 10000,
    feeRateExit: Number(sysConfig.feeRateExitBps) / 10000,
    slippageRate: Number(sysConfig.slippageBps) / 10000,
  };

  console.log(`riskAmount=${riskAmount}, rates: entry=${sysConfig.feeRateEntryBps}bps exit=${sysConfig.feeRateExitBps}bps slippage=${sysConfig.slippageBps}bps\n`);

  const allIntervals: Array<[string, number]> = [
    ["15m", 15],
    ["1H", 60],
    ["4H", 240],
    ["1D", 1440],
  ];
  const requested = process.argv.slice(2).map((s) => s.toUpperCase());
  const intervals = requested.length > 0 ? allIntervals.filter(([label]) => requested.includes(label.toUpperCase())) : allIntervals;

  console.log("Interval  SpanHours  BarsEval  Signals  Resolved  GrossExp  NetExp    WinRate  PFgross  PFnet");
  for (const [label, minutes] of intervals) {
    try {
      const result = await runDiagnostic(minutes, riskAmount, rates);
      const g = result.grossSummary;
      const n = result.netSummary;
      console.log(
        `${label.padEnd(9)} ${result.spanHours.toFixed(1).padEnd(10)} ${String(result.barsEvaluated).padEnd(9)} ${String(result.signalCount).padEnd(8)} ${String(result.resolvedCount).padEnd(9)} ${g.expectancy.toFixed(4).padEnd(9)} ${n.expectancy.toFixed(4).padEnd(9)} ${(n.winRate * 100).toFixed(1).padEnd(8)} ${(g.profitFactor === Infinity ? "∞" : g.profitFactor.toFixed(2)).padEnd(8)} ${n.profitFactor === Infinity ? "∞" : n.profitFactor.toFixed(2)}`,
      );
    } catch (err) {
      console.log(`${label.padEnd(9)} FAILED: ${(err as Error).message}`);
    }
  }
}

main();
