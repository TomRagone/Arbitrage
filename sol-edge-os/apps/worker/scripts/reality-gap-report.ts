/**
 * Phase 10B — re-runs @sol-edge/sim's reality-gap tracker against real
 * costs (config/frictionCalibration.json) instead of the old arbitrary
 * placeholders, so the gap it reports actually reflects the locked venue.
 *
 * This is NOT a strategy search and makes no discovery claim:
 * docs/PRE_REGISTRATION_POLICY.md §1 governs searches that yield a
 * discovery claim about edge. Here, a small fixed, seeded sample of
 * generated strategies (same generator @sol-edge/research's own
 * apparatus-validation diagnostics already use) is run once over real
 * ingested candles purely to exercise applyFriction/trackRealityGap
 * end-to-end on real numbers — no ranking, no selection, no significance
 * claim. The real pre-registered search over real data is Phase 10C.
 */
import { runAstKernel } from "@sol-edge/kernel";
import { applyFriction, trackRealityGap, MOCK_ALPHA_WARNING, type SimConfig, type FrictionParams, type TradeWithNetReturn } from "@sol-edge/sim";
import { readOHLCV, type MarketConfig } from "@sol-edge/database";
import { generateStrategies, computeFeatures, DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS, type SearchSpace } from "@sol-edge/research";
import type { CompactCandle } from "@sol-edge/core";
import marketConfig from "../../../config/market.json";

// Pre-10B placeholder friction, kept here only as a before/after reference
// point — this is what DEFAULT_SIM_CONFIG/DEFAULT_FRICTION_PARAMS used to
// be before calibrate-friction.ts replaced them (packages/research/src/search.ts).
const OLD_PLACEHOLDER_SIM_CONFIG: SimConfig = { alpha: 0.0005, beta: 0.1, gammaPanic: 1.5, kappaImpact: 0.02, fixedFeeRate: 0.0004 };
const OLD_PLACEHOLDER_FRICTION_PARAMS: FrictionParams = { sigmaEntry: 0.02, sigmaExit: 0.02, quantity: 1000, adv: 1000000 };

const SAMPLE_SEED = 42;
const SAMPLE_COUNT = 5; // fixed, small — apparatus exercise, not a search
const REALITY_GAP_CONFIG = { windowSize: 20, maxGap: 0.01 }; // flag if trailing avg friction cost exceeds 1% per trade (log-return terms)
const WINDOW_DAYS = 60; // same trailing window calibrate-friction.ts used

function buildLedger(trades: ReturnType<typeof runAstKernel>, simConfig: SimConfig, frictionParams: FrictionParams): TradeWithNetReturn[] {
  return trades.map((trade) => ({ trade, netReturnLog: applyFriction(trade, simConfig, frictionParams).netReturnLog }));
}

async function main() {
  const cfg = marketConfig as MarketConfig;
  const toTs = Math.floor(Date.now() / 1000);
  const fromTs = toTs - WINDOW_DAYS * 86400;

  const rows = readOHLCV(cfg, "ohlc", fromTs, toTs);
  if (rows.length < 50) {
    throw new Error(`reality-gap-report: only ${rows.length} bars available — run calibrate-friction.ts (or ingest more history) first`);
  }
  const candles: CompactCandle[] = rows.map((r) => ({ timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close }));

  const space: SearchSpace = { featureKeys: ["ema_20", "rsi_14"], maxDepth: 2, thresholdRange: [40, 100], sides: ["LONG", "SHORT"] };
  const strategies = generateStrategies(space, SAMPLE_SEED, SAMPLE_COUNT);
  const features = computeFeatures(candles, candles, space.featureKeys);

  const allTrades = strategies.flatMap((strategy) => runAstKernel(strategy, candles, features));
  console.log(`${strategies.length} fixed sample strategies (seed ${SAMPLE_SEED}) -> ${allTrades.length} total trades over ${candles.length} real bars.\n`);

  function report(label: string, simConfig: SimConfig, frictionParams: FrictionParams) {
    const ledger = buildLedger(allTrades, simConfig, frictionParams);
    const gaps = ledger.map((e) => e.trade.rawReturnLog - e.netReturnLog);
    const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const tracked = trackRealityGap(ledger, REALITY_GAP_CONFIG);
    const tripped = tracked.metadata.includes(MOCK_ALPHA_WARNING);

    console.log(`── ${label} ──`);
    console.log(`  alpha=${simConfig.alpha} beta=${simConfig.beta} kappaImpact=${simConfig.kappaImpact} fixedFeeRate=${simConfig.fixedFeeRate}`);
    console.log(`  Mean reality gap per trade: ${meanGap.toFixed(6)} (log-return terms)`);
    console.log(`  MOCK_ALPHA_WARNING tripped: ${tripped}\n`);
  }

  report("OLD placeholder friction (pre-10B)", OLD_PLACEHOLDER_SIM_CONFIG, OLD_PLACEHOLDER_FRICTION_PARAMS);
  report("NEW calibrated friction (10B, real costs)", DEFAULT_SIM_CONFIG, DEFAULT_FRICTION_PARAMS);
}

main();
