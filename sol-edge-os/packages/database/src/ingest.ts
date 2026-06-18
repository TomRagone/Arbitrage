import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync } from "node:fs";
import ccxt from "ccxt";

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

function openDb(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ohlcv_candles (
      exchange TEXT NOT NULL,
      pair TEXT NOT NULL,
      resolution TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      PRIMARY KEY (exchange, pair, resolution, timestamp)
    )
  `);
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
      INSERT OR REPLACE INTO ohlcv_candles (exchange, pair, resolution, timestamp, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         WHERE exchange = ? AND pair = ? AND resolution = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`,
      )
      .all(cfg.exchange, cfg.pair, cfg.resolution, fromTs, toTs);

    const storeHash = createHash("sha256").update(canonicalize(stored)).digest("hex");
    return { count: stored.length, storeHash };
  } finally {
    db.close();
  }
}

interface CcxtExchange {
  fetchOHLCV(symbol: string, timeframe: string, since: number, limit: number): Promise<number[][]>;
}
