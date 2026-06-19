import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync } from "node:fs";
import ccxt from "ccxt";
import { getTrades } from "@sol-edge/exchanges";
import { validateDataIntegrity, type IntegrityReport } from "./validate_data";
import { resampleTradesToOHLCV } from "./resample";

/// Visible provenance tag (Phase 10C.1): which fetch method actually
/// produced a stored row. Not cosmetic — "ohlc" rows came from the
/// exchange's native OHLC endpoint (capped at ~720-750 1h bars for
/// SOL/USDT, confirmed during Phase 10C); "trades_resampled" rows were
/// built here from raw trades via resampleTradesToOHLCV, specifically
/// *because* of that cap. Both can legitimately exist for overlapping
/// timestamps (the PRIMARY KEY includes source, see openDb below) — a
/// caller must say which one it wants, never silently get a blend.
export type OHLCVSource = "ohlc" | "trades_resampled";

export interface FeeTierConfig {
  readonly tierName: string;
  readonly thirtyDayVolumeUsd: string;
  readonly takerFeeBps: number;
  readonly makerFeeBps: number;
  readonly fillModel: string;
  readonly feeUsed: string;
  readonly source: string;
  readonly note: string;
}

/// Matches config/market.json's shape (Step 10A.0).
export interface MarketConfig {
  readonly dataSource: string;
  readonly exchange: string;
  readonly pair: string;
  readonly marketType: string;
  readonly resolution: string;
  readonly feeTier: FeeTierConfig;
}

export interface IngestResult {
  readonly count: number;
  readonly storeHash: string;
}

const DEFAULT_DB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
export const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, "ohlcv.sqlite");

function timeframeDurationSeconds(resolution: string): number {
  const match = /^(\d+)(m|h|d)$/.exec(resolution);
  if (!match) throw new Error(`ingestOHLCV: unrecognized resolution "${resolution}" (expected e.g. "1h", "4h", "1d", "15m")`);
  const value = Number(match[1]);
  const unitSeconds = match[2] === "m" ? 60 : match[2] === "h" ? 3600 : 86400;
  return value * unitSeconds;
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return value.toFixed(12);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported value ${String(value)}`);
}

const CANDLES_SCHEMA = `
  CREATE TABLE ohlcv_candles (
    exchange TEXT NOT NULL,
    pair TEXT NOT NULL,
    resolution TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    source TEXT NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (exchange, pair, resolution, timestamp, source)
  )
`;

/// Opens the store, creating or migrating the schema as needed. Existing
/// databases created before Phase 10C.1 (no `source` column, PK without
/// it) are migrated in place: the old table is renamed aside, the new
/// schema is created, every existing row is copied over tagged
/// source='ohlc' (the only fetch method that existed before this phase),
/// and the old table is dropped. No data is lost — this is a non-fatal,
/// re-derivable local fetch cache (any row can be re-ingested), but the
/// migration preserves it anyway rather than dropping and re-fetching.
function openDb(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ohlcv_candles'`).get();
  if (!tableExists) {
    db.exec(CANDLES_SCHEMA);
    return db;
  }

  const columns = db.prepare(`PRAGMA table_info(ohlcv_candles)`).all() as Array<{ name: string }>;
  const hasSourceColumn = columns.some((c) => c.name === "source");
  if (!hasSourceColumn) {
    db.exec(`
      ALTER TABLE ohlcv_candles RENAME TO ohlcv_candles_pre_10c1;
      ${CANDLES_SCHEMA};
      INSERT INTO ohlcv_candles (exchange, pair, resolution, timestamp, source, open, high, low, close, volume)
        SELECT exchange, pair, resolution, timestamp, 'ohlc', open, high, low, close, volume FROM ohlcv_candles_pre_10c1;
      DROP TABLE ohlcv_candles_pre_10c1;
    `);
  }

  return db;
}

/// Fetches OHLCV for cfg.pair/cfg.resolution over [fromTs, toTs] (unix
/// SECONDS — note CCXT itself uses milliseconds, converted at the
/// boundary) via CCXT, normalizes to (timestamp=bar OPEN, open, high, low,
/// close, volume), and persists to a local SQLite store. Idempotent:
/// INSERT OR REPLACE keyed on (exchange, pair, resolution, timestamp), so
/// re-running over the same range overwrites rows in place rather than
/// duplicating or reordering them — re-fetching the same range therefore
/// reproduces the same storeHash.
///
/// `timestamp` here is the bar's OPEN timestamp (matching the exchange's
/// native OHLCV stamp convention, per Phase 10A's stated invariant). It is
/// NOT yet the bar's availability (open_ts + bar_duration) — converting to
/// availability for the causal-block boundary is the integrity layer's
/// job (the next step), not ingestion's. Flagging this explicitly rather
/// than silently picking one and hoping it's later interpreted correctly.
export async function ingestOHLCV(cfg: MarketConfig, fromTs: number, toTs: number, dbPath: string = DEFAULT_DB_PATH): Promise<IngestResult> {
  if (cfg.dataSource !== "ccxt") {
    throw new Error(`ingestOHLCV: unsupported dataSource "${cfg.dataSource}" — only "ccxt" is implemented`);
  }
  const ExchangeClass = (ccxt as unknown as Record<string, new (params: Record<string, unknown>) => CcxtExchange>)[cfg.exchange];
  if (!ExchangeClass) {
    throw new Error(`ingestOHLCV: ccxt has no exchange "${cfg.exchange}"`);
  }
  const exchange = new ExchangeClass({ enableRateLimit: true }); // ccxt's own built-in throttler respects the exchange's rate limit

  const barDurationMs = timeframeDurationSeconds(cfg.resolution) * 1000;
  const toMs = toTs * 1000;
  const limit = 1000;

  const db = openDb(dbPath);
  try {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO ohlcv_candles (exchange, pair, resolution, timestamp, source, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, 'ohlc', ?, ?, ?, ?, ?)
    `);

    let since = fromTs * 1000;
    while (since <= toMs) {
      const rows: number[][] = await exchange.fetchOHLCV(cfg.pair, cfg.resolution, since, limit);
      if (!rows || rows.length === 0) break;

      for (const [tsMs, open, high, low, close, volume] of rows) {
        const tsSeconds = Math.floor(tsMs / 1000);
        if (tsSeconds < fromTs || tsSeconds > toTs) continue; // exchange may pad slightly beyond the requested edge
        upsert.run(cfg.exchange, cfg.pair, cfg.resolution, tsSeconds, open, high, low, close, volume ?? 0);
      }

      const lastTsMs = rows[rows.length - 1][0];
      const nextSince = lastTsMs + barDurationMs;
      if (nextSince <= since) break; // safety: no forward progress, avoid an infinite loop
      since = nextSince;
      if (rows.length < limit) break; // short page -> reached the end of available history
    }

    const stored = db
      .prepare(
        `SELECT timestamp, open, high, low, close, volume FROM ohlcv_candles
         WHERE exchange = ? AND pair = ? AND resolution = ? AND source = 'ohlc' AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`,
      )
      .all(cfg.exchange, cfg.pair, cfg.resolution, fromTs, toTs);

    const storeHash = createHash("sha256").update(canonicalize(stored)).digest("hex");
    return { count: stored.length, storeHash };
  } finally {
    db.close();
  }
}

export interface StoredOHLCVRow {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/// Read-only accessor over the same store ingestOHLCV/ingestTradesResampled
/// write to. `source` is required, not defaulted — a caller must say
/// explicitly which provenance it wants (Phase 10C.1), never silently get
/// a mix of native-OHLC and trades-resampled rows for the same timestamps.
export function readOHLCV(cfg: MarketConfig, source: OHLCVSource, fromTs: number, toTs: number, dbPath: string = DEFAULT_DB_PATH): StoredOHLCVRow[] {
  const db = openDb(dbPath);
  try {
    return db
      .prepare(
        `SELECT timestamp, open, high, low, close, volume FROM ohlcv_candles
         WHERE exchange = ? AND pair = ? AND resolution = ? AND source = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`,
      )
      .all(cfg.exchange, cfg.pair, cfg.resolution, source, fromTs, toTs) as unknown as StoredOHLCVRow[];
  } finally {
    db.close();
  }
}

export interface TradesIngestResult extends IngestResult {
  readonly tradesFetched: number;
  readonly pagesFetched: number;
  readonly integrityReport: IntegrityReport;
}

/// Builds real 1h-resolution depth beyond the OHLC endpoint's ~720-750
/// bar ceiling (Phase 10C.1): paginates Kraken's public Trades endpoint
/// from `fromTs` forward via its since/last cursor (which, unlike the OHLC
/// endpoint, supports genuine deep pagination), resamples the raw trades
/// into hourly bars (resampleTradesToOHLCV — no synthetic flat candles for
/// empty hours), runs the result through the SAME data integrity gate
/// (10A.2's validateDataIntegrity) the OHLC path uses — no separate,
/// looser check for this ingestion method — and persists it tagged
/// source='trades_resampled'. Only implemented for 1h: `resolution` is
/// validated against cfg.resolution rather than re-derived, since the
/// resampling bucket width must match whatever the rest of the pipeline
/// expects to read back.
export async function ingestTradesResampled(
  cfg: MarketConfig,
  fromTs: number,
  toTs: number,
  dbPath: string = DEFAULT_DB_PATH,
  onProgress?: (pagesFetched: number, tradesFetched: number, newestTimestamp: number) => void,
): Promise<TradesIngestResult> {
  const barDurationSeconds = timeframeDurationSeconds(cfg.resolution);
  const krakenPair = cfg.pair.replace("/", "");

  const MAX_PAGES = 20000; // safety cap — fail loudly rather than loop forever if Kraken's cursor ever stops advancing in an unexpected way
  const PAGE_DELAY_MS = 1500; // Kraken's public (unauthenticated) Trades endpoint rate-limits more aggressively than 500ms allows — confirmed empirically (Phase 10C.1 first attempt hit "EGeneral:Too many requests")
  const MAX_RETRIES_PER_PAGE = 8;

  const FLUSH_EVERY_PAGES = 50; // periodic partial persistence — a late failure (rate limit exhausting retries, network drop) loses only the trades since the last flush, not the whole run

  const allTrades: { price: number; volume: number; timestamp: number }[] = [];
  let since: string | number = fromTs;
  let pagesFetched = 0;
  let lastCursor: string | null = null;

  const db = openDb(dbPath);
  try {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO ohlcv_candles (exchange, pair, resolution, timestamp, source, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, 'trades_resampled', ?, ?, ?, ?, ?)
    `);
    const flush = () => {
      // Re-resamples everything collected so far and upserts — idempotent
      // (INSERT OR REPLACE), so re-flushing the same trades on the next
      // call is harmless. Cheap relative to the network round-trips this
      // is interleaved with.
      for (const bar of resampleTradesToOHLCV(allTrades, barDurationSeconds)) {
        upsert.run(cfg.exchange, cfg.pair, cfg.resolution, bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume);
      }
    };

    while (true) {
      if (pagesFetched >= MAX_PAGES) throw new Error(`ingestTradesResampled: exceeded MAX_PAGES (${MAX_PAGES}) — aborting rather than paginating indefinitely`);

      let page;
      for (let attempt = 0; ; attempt++) {
        try {
          page = await getTrades(krakenPair, since);
          break;
        } catch (err) {
          const isRateLimit = err instanceof Error && err.message.includes("Too many requests");
          if (!isRateLimit || attempt >= MAX_RETRIES_PER_PAGE) throw err;
          const backoffMs = PAGE_DELAY_MS * 2 ** (attempt + 1); // exponential backoff: 3s, 6s, 12s, ...
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
      pagesFetched++;
      if (page.trades.length === 0) break;

      for (const trade of page.trades) {
        if (trade.timestamp > toTs) continue;
        allTrades.push(trade);
      }

      const newestTimestamp = page.trades[page.trades.length - 1].timestamp;
      onProgress?.(pagesFetched, allTrades.length, newestTimestamp);
      if (pagesFetched % FLUSH_EVERY_PAGES === 0) flush();
      if (page.last === lastCursor || newestTimestamp > toTs) break; // cursor stalled or we've paged past the requested end
      lastCursor = page.last;
      since = page.last;

      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }

    flush();
    const integrityReport = validateDataIntegrity(resampleTradesToOHLCV(allTrades, barDurationSeconds), barDurationSeconds); // throws on hard violations; gaps (expected — empty hours) are a soft report

    const stored = db
      .prepare(
        `SELECT timestamp, open, high, low, close, volume FROM ohlcv_candles
         WHERE exchange = ? AND pair = ? AND resolution = ? AND source = 'trades_resampled' AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`,
      )
      .all(cfg.exchange, cfg.pair, cfg.resolution, fromTs, toTs);

    const storeHash = createHash("sha256").update(canonicalize(stored)).digest("hex");
    return { count: stored.length, storeHash, tradesFetched: allTrades.length, pagesFetched, integrityReport };
  } finally {
    db.close();
  }
}

interface CcxtExchange {
  fetchOHLCV(symbol: string, timeframe: string, since: number, limit: number): Promise<number[][]>;
}
