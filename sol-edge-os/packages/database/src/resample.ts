/**
 * Resamples raw trade-level data into OHLCV bars. Pure, no I/O. Built for
 * Phase 10C.1: Kraken's native OHLC endpoint caps real history for
 * SOL/USDT at ~720-750 1h bars regardless of how far back `since` is
 * requested (confirmed during the Phase 10C search). Kraken's public
 * Trades endpoint has no such ceiling — it supports deep pagination via
 * its own `since`/`last` cursor — so real depth comes from resampling
 * trades ourselves instead of trusting the OHLC endpoint.
 */
import type { OHLCVBar } from "./validate_data";

export interface ResamplableTrade {
  readonly price: number;
  readonly volume: number;
  readonly timestamp: number; // unix seconds, sub-second precision allowed
}

/// Buckets trades into `barDurationSeconds`-wide windows and emits one bar
/// per bucket that actually contains at least one trade — an hour with
/// zero trades emits NO bar at all, rather than a synthetic flat candle.
/// This is deliberate: a forward-filled/flat candle would manufacture a
/// fake zero-volatility regime (the same reasoning 10A.3's gap policy
/// already rejected forward-fill for). The resulting series is left with
/// real timestamp gaps wherever a bucket was empty; the existing gap
/// policy (findGapIndices/segmentAtGaps/markTradeable) already excludes
/// any feature window that would span such a gap — no separate handling
/// needed here.
///
/// Trades are assumed to arrive already in ascending timestamp order
/// (true of Kraken's paginated Trades endpoint, page by page) — this
/// function does not re-sort, so out-of-order input would silently
/// produce a wrong open/close for the bars it touches. Asserted, not
/// silently tolerated.
export function resampleTradesToOHLCV(trades: readonly ResamplableTrade[], barDurationSeconds: number): OHLCVBar[] {
  if (!(barDurationSeconds > 0)) throw new Error(`resampleTradesToOHLCV: barDurationSeconds must be > 0, got ${barDurationSeconds}`);

  const bars: OHLCVBar[] = [];
  let currentBucket = -1;
  let open = 0, high = 0, low = 0, close = 0, volume = 0;

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    if (i > 0 && trade.timestamp < trades[i - 1].timestamp) {
      throw new Error(`resampleTradesToOHLCV: trades out of order at index ${i} (timestamp ${trade.timestamp} < previous ${trades[i - 1].timestamp})`);
    }

    const bucket = Math.floor(trade.timestamp / barDurationSeconds) * barDurationSeconds;
    if (bucket !== currentBucket) {
      if (currentBucket !== -1) bars.push({ timestamp: currentBucket, open, high, low, close, volume });
      currentBucket = bucket;
      open = high = low = close = trade.price;
      volume = 0;
    }

    high = Math.max(high, trade.price);
    low = Math.min(low, trade.price);
    close = trade.price;
    volume += trade.volume;
  }
  if (currentBucket !== -1) bars.push({ timestamp: currentBucket, open, high, low, close, volume });

  return bars;
}
