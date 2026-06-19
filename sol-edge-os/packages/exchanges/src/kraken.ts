/**
 * Kraken public market-data client. Read-only: ticker, OHLC, and trades
 * only. No API keys, no signed requests, no order endpoints — this file
 * must never grow an order-placement function.
 */
const KRAKEN_PUBLIC_BASE = "https://api.kraken.com/0/public";

interface KrakenResponse<T> {
  error: string[];
  result: T;
}

async function krakenGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${KRAKEN_PUBLIC_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kraken ${path} request failed: ${res.status} ${res.statusText}`);

  const json = (await res.json()) as KrakenResponse<T>;
  if (json.error.length > 0) throw new Error(`Kraken ${path} error: ${json.error.join(", ")}`);
  return json.result;
}

export interface Ticker {
  pair: string;
  bid: number;
  ask: number;
  last: number;
  openToday: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

interface KrakenTickerEntry {
  a: [string, string, string];
  b: [string, string, string];
  c: [string, string];
  v: [string, string];
  p: [string, string];
  t: [number, number];
  l: [string, string];
  h: [string, string];
  o: string;
}

/// Current ticker snapshot for a Kraken spot pair (default SOL/USD).
export async function getTicker(pair = "SOLUSD"): Promise<Ticker> {
  const result = await krakenGet<Record<string, KrakenTickerEntry>>("Ticker", { pair });
  const [resolvedPair, entry] = Object.entries(result)[0] ?? [];
  if (!entry) throw new Error(`Kraken Ticker returned no data for pair ${pair}`);

  return {
    pair: resolvedPair,
    bid: Number(entry.b[0]),
    ask: Number(entry.a[0]),
    last: Number(entry.c[0]),
    openToday: Number(entry.o),
    high24h: Number(entry.h[1]),
    low24h: Number(entry.l[1]),
    volume24h: Number(entry.v[1]),
  };
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  volume: number;
  count: number;
}

type KrakenOHLCRow = [number, string, string, string, string, string, string, number];

/// OHLC candles for a Kraken spot pair. interval is in minutes (Kraken's
/// supported values: 1, 5, 15, 30, 60, 240, 1440, 10080, 21600).
export async function getOHLC(pair = "SOLUSD", interval = 1): Promise<Candle[]> {
  const result = await krakenGet<Record<string, KrakenOHLCRow[] | number>>("OHLC", {
    pair,
    interval: String(interval),
  });
  const rows = Object.entries(result).find(([key]) => key !== "last")?.[1];
  if (!Array.isArray(rows)) throw new Error(`Kraken OHLC returned no data for pair ${pair}`);

  return rows.map(([time, open, high, low, close, vwap, volume, count]) => ({
    time,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    vwap: Number(vwap),
    volume: Number(volume),
    count,
  }));
}

export interface Trade {
  readonly price: number;
  readonly volume: number;
  readonly timestamp: number; // unix seconds, sub-second precision preserved
  readonly side: "buy" | "sell";
}

export interface TradesPage {
  readonly trades: readonly Trade[];
  readonly last: string; // opaque cursor — pass as `since` to fetch the next page
}

type KrakenTradeRow = [string, string, number, "b" | "s", string, string, number];

/// One page of raw trades for a Kraken spot pair, the `since` cursor for
/// the next page chained from the previous page's `last` (Kraken's public
/// Trades endpoint supports deep pagination via this cursor — unlike the
/// OHLC endpoint, which only ever returns its most recent ~720 bars
/// regardless of `since`, confirmed during Phase 10C). count caps the page
/// size (Kraken's max is 1000).
export async function getTrades(pair: string, since: string | number, count = 1000): Promise<TradesPage> {
  const result = await krakenGet<Record<string, KrakenTradeRow[] | string>>("Trades", {
    pair,
    since: String(since),
    count: String(count),
  });
  const rows = Object.entries(result).find(([key]) => key !== "last")?.[1];
  const last = result.last;
  if (!Array.isArray(rows) || typeof last !== "string") throw new Error(`Kraken Trades returned no data for pair ${pair}`);

  return {
    trades: rows.map(([price, volume, timestamp, side]) => ({
      price: Number(price),
      volume: Number(volume),
      timestamp,
      side: side === "b" ? "buy" : "sell",
    })),
    last,
  };
}
