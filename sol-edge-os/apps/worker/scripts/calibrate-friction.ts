/**
 * Phase 10B — calibrates @sol-edge/sim's SimConfig/FrictionParams to the
 * locked venue (config/market.json), replacing the round-number
 * placeholders @sol-edge/research/search.ts shipped with. Pulls a real
 * trailing window of OHLCV at the locked resolution (ingest is
 * idempotent — safe to re-run), reads it back, fetches a live ticker
 * spread snapshot, and writes the derived values to
 * config/frictionCalibration.json.
 *
 * Window choice: 60 trailing days at the locked 1h resolution (~1440
 * bars) — enough bars for a stable sigma/ADV estimate without an
 * excessive number of paginated ccxt calls. This is a calibration-input
 * choice, not a strategy-search parameter, so it isn't subject to
 * docs/PRE_REGISTRATION_POLICY.md.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ingestOHLCV, readOHLCV, type MarketConfig } from "@sol-edge/database";
import { getTicker } from "@sol-edge/exchanges";
import { estimateBarLogReturns, estimateAverageDailyVolume, deriveCalibratedFriction, type OhlcvPoint } from "@sol-edge/analytics";
import marketConfig from "../../../config/market.json";

const CONFIG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config");
const OUTPUT_PATH = path.join(CONFIG_DIR, "frictionCalibration.json");

const WINDOW_DAYS = 60;
const REFERENCE_IMPACT_RATIO = 0.01; // assumed Q/ADV reference point (1%) — see frictionCalibration.ts doc comment
const GAMMA_PANIC_PLACEHOLDER = 1.5; // unchanged: no real-data anchor exists for this one

function krakenTickerPair(ccxtPair: string): string {
  return ccxtPair.replace("/", "");
}

async function main() {
  const cfg = marketConfig as MarketConfig;

  const toTs = Math.floor(Date.now() / 1000);
  const fromTs = toTs - WINDOW_DAYS * 86400;

  console.log(`Ingesting ${cfg.exchange}/${cfg.pair}/${cfg.resolution} for the trailing ${WINDOW_DAYS} days...`);
  const ingestResult = await ingestOHLCV(cfg, fromTs, toTs);
  console.log(`  Ingested/verified ${ingestResult.count} bars (storeHash ${ingestResult.storeHash.slice(0, 12)}...).`);

  const rows = readOHLCV(cfg, "ohlc", fromTs, toTs);
  if (rows.length < 2) {
    throw new Error(`calibrate-friction: only ${rows.length} bar(s) available — need at least 2 to compute a return series`);
  }
  const bars: OhlcvPoint[] = rows.map((r) => ({ timestamp: r.timestamp, close: r.close, volume: r.volume }));

  const sigmaSeries = estimateBarLogReturns(bars);
  const adv = estimateAverageDailyVolume(bars);

  console.log(`Fetching live ticker for spread snapshot...`);
  const ticker = await getTicker(krakenTickerPair(cfg.pair));
  console.log(`  bid=${ticker.bid} ask=${ticker.ask}`);

  const calibration = deriveCalibratedFriction({
    takerFeeBps: cfg.feeTier.takerFeeBps,
    bidPrice: ticker.bid,
    askPrice: ticker.ask,
    sigmaSeries,
    adv,
    referenceImpactRatio: REFERENCE_IMPACT_RATIO,
    gammaPanic: GAMMA_PANIC_PLACEHOLDER,
  });

  console.log("\n── Calibrated SimConfig ──");
  console.log(`  alpha (half-spread, REAL):        ${calibration.simConfig.alpha}`);
  console.log(`  beta (volatility, ASSUMED):        ${calibration.simConfig.beta}`);
  console.log(`  gammaPanic (ASSUMED, unchanged):   ${calibration.simConfig.gammaPanic}`);
  console.log(`  kappaImpact (impact, ASSUMED):     ${calibration.simConfig.kappaImpact}`);
  console.log(`  fixedFeeRate (taker fee, REAL):    ${calibration.simConfig.fixedFeeRate}`);
  console.log("── Calibrated FrictionParams (representative defaults) ──");
  console.log(`  sigmaEntry/sigmaExit (median, REAL): ${calibration.frictionParams.sigmaEntry}`);
  console.log(`  adv (REAL):                          ${calibration.frictionParams.adv}`);
  console.log(`  quantity (ASSUMED reference size):   ${calibration.frictionParams.quantity}`);

  const output = {
    derivedAt: new Date().toISOString(),
    sourceMarketConfig: { exchange: cfg.exchange, pair: cfg.pair, resolution: cfg.resolution },
    sampleWindow: { windowDays: WINDOW_DAYS, barsUsed: bars.length, fromTs, toTs },
    simConfig: calibration.simConfig,
    frictionParams: calibration.frictionParams,
    measured: calibration.measured,
    assumed: calibration.assumed,
    _methodologyNote:
      "alpha and fixedFeeRate are measured from a live ticker spread snapshot and the pre-registered fee tier (config/market.json). " +
      "sigmaEntry/sigmaExit/adv are measured from the ingested OHLCV series (median |log return| and average daily base-asset volume). " +
      "beta and kappaImpact are NOT empirically fittable (no real fill/slippage data exists for this venue) and are derived via a documented " +
      "spread-relative heuristic: beta = alpha / median(sigma_t); kappaImpact = alpha / sqrt(referenceImpactRatio), with quantity = adv * " +
      "referenceImpactRatio kept self-consistent with that same reference point. gammaPanic has no real-data anchor and is carried over " +
      "unchanged as an explicitly-flagged assumption. Re-run this script (apps/worker/scripts/calibrate-friction.ts) to refresh — it is " +
      "idempotent and safe to re-run.",
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

main();
