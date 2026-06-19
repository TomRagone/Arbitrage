/**
 * Phase 10C.1 — builds real 1h depth for SOL/USDT beyond the OHLC
 * endpoint's ~720-750 bar ceiling (confirmed during Phase 10C), by
 * paginating Kraken's public Trades endpoint (genuine deep pagination via
 * its own since/last cursor) and resampling to hourly bars ourselves
 * (ingestTradesResampled, @sol-edge/database). Reports depth achieved and
 * the integrity gate's result — does NOT run a search. That's a separate
 * pre-registered step once real depth is known.
 */
import { ingestTradesResampled, type MarketConfig } from "@sol-edge/database";
import marketConfig from "../../../config/market.json";

const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 450); // ~15 months — comfortably past "a year+"; trade volume for this pair is low enough that pulling full history (back to Oct 2022) is also feasible, but this is a deliberate bounded choice, not the absolute ceiling

async function main() {
  const cfg = marketConfig as MarketConfig;
  const toTs = Math.floor(Date.now() / 1000);
  const fromTs = toTs - LOOKBACK_DAYS * 86400;

  console.log(`Paginating Kraken public Trades for ${cfg.pair} from ${new Date(fromTs * 1000).toISOString()} to ${new Date(toTs * 1000).toISOString()} (${LOOKBACK_DAYS} days)...`);
  console.log(`(Paced at 1.5s/request, with backoff-retry on rate-limit errors — this will take a while for a multi-month window.)\n`);

  const result = await ingestTradesResampled(cfg, fromTs, toTs, undefined, (pagesFetched, tradesFetched, newestTimestamp) => {
    if (pagesFetched % 20 === 0) {
      console.log(`  ...page ${pagesFetched}, ${tradesFetched} trades so far, up to ${new Date(newestTimestamp * 1000).toISOString()}`);
    }
  });

  console.log(`Trades fetched:  ${result.tradesFetched}`);
  console.log(`Pages fetched:   ${result.pagesFetched}`);
  console.log(`Bars produced:   ${result.count} (source='trades_resampled')`);
  console.log(`Store hash:      ${result.storeHash}`);

  console.log(`\n── Integrity gate (10A.2, same check the OHLC path uses) ──`);
  console.log(`  Bars checked: ${result.integrityReport.barCount}`);
  console.log(`  Gaps found:   ${result.integrityReport.gaps.length} (expected wherever an hour had zero trades — not an error)`);
  if (result.integrityReport.gaps.length > 0) {
    const totalMissingBars = result.integrityReport.gaps.reduce((sum, g) => sum + g.missingBars, 0);
    console.log(`  Total bars implied missing across all gaps: ${totalMissingBars}`);
    console.log(`  Largest gap: ${Math.max(...result.integrityReport.gaps.map((g) => g.missingBars))} bars`);
  }
}

main();
