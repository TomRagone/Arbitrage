/**
 * Rejection diagnostics — explanation, not optimization. No strategy
 * parameters are touched here; this only adds visibility into WHY signals
 * get rejected and whether different filters are flagging the same market
 * condition (overlap) rather than each catching something distinct.
 *
 * decideTrade() short-circuits on the first failing rule, so the backtest's
 * rejection tally only ever sees one reason per signal. Here we check each
 * signal-intrinsic rule (volatility, volume, anti-chase, sizing)
 * independently and in isolation, without early return, to see the full
 * set of rules each signal fails — not just the first one hit.
 *
 * Risk caps (open positions / trades per day) are intentionally excluded
 * from the overlap matrix: they're path-dependent on trade sequencing, not
 * a property of the signal itself, so "would this signal fail the risk cap"
 * isn't well-defined in isolation. They're reported separately via the same
 * sequential walk the backtest uses.
 */
import { decideTrade, type RiskSettings, type RiskState, type Signal } from "../src/engine";
import { loadHistoricalSignals, utcDay } from "./historicalSignals";

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface SignalDiagnostic {
  signal: Signal;
  failVolatility: boolean;
  failVolume: boolean;
  failAntiChase: boolean;
  failSizing: boolean;
  volumeRatio: number;
  requiredSize: number;
  requiredNotional: number;
}

function diagnose(signal: Signal, settings: RiskSettings): SignalDiagnostic {
  const failVolatility = !(signal.atrValue > signal.atrSmaValue);
  const failVolume = !(signal.volume > signal.volumeSmaValue);
  const failAntiChase = !signal.isFirstBreakout;

  const riskAmount = (settings.riskPctPerTrade / 100) * settings.accountSize;
  const failSizing = !(riskAmount > 0);
  const requiredSize = failSizing ? NaN : riskAmount / signal.atrValue;
  const requiredNotional = failSizing ? NaN : requiredSize * signal.entryPrice;

  return {
    signal,
    failVolatility,
    failVolume,
    failAntiChase,
    failSizing,
    volumeRatio: signal.volume / signal.volumeSmaValue,
    requiredSize,
    requiredNotional,
  };
}

async function main() {
  const { spanHours, candlesTrendCount, candlesLowerTfCount, barsEvaluated, signals } = await loadHistoricalSignals();

  console.log(`Diagnostics window: ${candlesLowerTfCount} 15m candles (~${spanHours.toFixed(1)}h), ${candlesTrendCount} trend-tf candles available.`);
  console.log(`Bars evaluated: ${barsEvaluated}  Signals generated: ${signals.length}\n`);

  // Same assumed risk settings as the backtest (accountSize is assumed —
  // real configured value is 0, which would trivially fail sizing always).
  const settings: RiskSettings = { riskPctPerTrade: 0.5, accountSize: 10000, maxOpenPositions: 1, maxTradesPerDay: 3 };

  // ── Part 1: sequential, path-dependent outcome (same as backtest) ──
  const state: RiskState = { openPositions: 0, tradesToday: 0 };
  let currentDay = signals.length > 0 ? utcDay(signals[0].time) : 0;
  const sequentialRejections = new Map<string, number>();
  let approvedCount = 0;

  for (const { time, signal } of signals) {
    const day = utcDay(time);
    if (day !== currentDay) {
      currentDay = day;
      state.tradesToday = 0;
    }
    const decision = decideTrade(signal, settings, state);
    if (decision.approved) {
      approvedCount++;
      state.openPositions++;
      state.tradesToday++;
    } else {
      const category = decision.reason.split(":")[0];
      sequentialRejections.set(category, (sequentialRejections.get(category) ?? 0) + 1);
    }
  }

  // ── Part 2: independent, non-short-circuiting per-signal diagnosis ──
  const diagnostics = signals.map(({ signal }) => diagnose(signal, settings));

  const countVolatility = diagnostics.filter((d) => d.failVolatility).length;
  const countVolume = diagnostics.filter((d) => d.failVolume).length;
  const countAntiChase = diagnostics.filter((d) => d.failAntiChase).length;
  const countSizing = diagnostics.filter((d) => d.failSizing).length;

  const onlyVolatility = diagnostics.filter((d) => d.failVolatility && !d.failVolume && !d.failAntiChase).length;
  const onlyVolume = diagnostics.filter((d) => d.failVolume && !d.failVolatility && !d.failAntiChase).length;
  const onlyAntiChase = diagnostics.filter((d) => d.failAntiChase && !d.failVolatility && !d.failVolume).length;
  const volatilityAndVolume = diagnostics.filter((d) => d.failVolatility && d.failVolume && !d.failAntiChase).length;
  const volatilityAndAntiChase = diagnostics.filter((d) => d.failVolatility && d.failAntiChase && !d.failVolume).length;
  const volumeAndAntiChase = diagnostics.filter((d) => d.failVolume && d.failAntiChase && !d.failVolatility).length;
  const allThree = diagnostics.filter((d) => d.failVolatility && d.failVolume && d.failAntiChase).length;
  const passAllThree = diagnostics.filter((d) => !d.failVolatility && !d.failVolume && !d.failAntiChase).length;

  console.log("── Sequential outcome (matches backtest; risk caps are path-dependent) ──");
  console.log(`Approved: ${approvedCount}`);
  console.log(`Rejected: ${signals.length - approvedCount}, by first-failing-rule category:`);
  for (const [rule, count] of sequentialRejections) console.log(`  - ${rule}: ${count}`);

  console.log("\n── Independent per-signal rule diagnosis (no short-circuit, signal-intrinsic rules only) ──");
  console.log(`Fails volatility (ATR14 <= SMA20(ATR14)): ${countVolatility}/${signals.length}`);
  console.log(`Fails volume (candle vol <= SMA20(volume)): ${countVolume}/${signals.length}`);
  console.log(`Fails anti-chase (not first breakout candle): ${countAntiChase}/${signals.length}`);
  console.log(`Fails sizing (riskAmount <= 0): ${countSizing}/${signals.length}`);

  console.log("\n── Overlap: is the same signal being caught by multiple filters? ──");
  console.log(`Only volatility:               ${onlyVolatility}`);
  console.log(`Only volume:                   ${onlyVolume}`);
  console.log(`Only anti-chase:               ${onlyAntiChase}`);
  console.log(`Volatility AND volume:         ${volatilityAndVolume}`);
  console.log(`Volatility AND anti-chase:     ${volatilityAndAntiChase}`);
  console.log(`Volume AND anti-chase:         ${volumeAndAntiChase}`);
  console.log(`All three (volatility+volume+anti-chase): ${allThree}`);
  console.log(`Pass all three (would only be blocked by risk cap / sizing): ${passAllThree}`);

  console.log("\n── Summary statistics (across all signals) ──");
  console.log(`Signal count: ${signals.length}`);
  console.log(`Approval count: ${approvedCount}`);
  console.log(`Median ATR: ${median(diagnostics.map((d) => d.signal.atrValue)).toFixed(4)}`);
  console.log(`Median volume ratio (volume / SMA20(volume)): ${median(diagnostics.map((d) => d.volumeRatio)).toFixed(4)}`);
  console.log(`Median required position size (assumed accountSize=${settings.accountSize}): ${median(diagnostics.map((d) => d.requiredSize)).toFixed(4)}`);
  console.log(`Median required notional: ${median(diagnostics.map((d) => d.requiredNotional)).toFixed(2)}`);
}

main();
