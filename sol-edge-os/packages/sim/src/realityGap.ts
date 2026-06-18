import type { RawTrade } from "@sol-edge/core";

export const MOCK_ALPHA_WARNING = "MOCK_ALPHA_WARNING";

export interface RealityGapConfig {
  readonly windowSize: number; // trailing window over which the moving average is computed
  readonly maxGap: number; // configured limit — trailing avg gap above this trips the warning
}

export interface TradeWithNetReturn {
  readonly trade: RawTrade;
  readonly netReturnLog: number; // from applyFriction(trade, ...).netReturnLog
}

export interface LedgerWithMetadata {
  readonly trades: readonly RawTrade[];
  readonly metadata: readonly string[];
}

/// RealityGap = rawReturnLog - netReturnLog (the friction cost actually
/// realized on a trade, in log-return terms).
export function computeRealityGap(entry: TradeWithNetReturn): number {
  return entry.trade.rawReturnLog - entry.netReturnLog;
}

/// Walks the ledger in fixed iteration order, computing the trailing
/// moving average of the per-trade reality gap over `config.windowSize`
/// trades. If that trailing average ever exceeds config.maxGap,
/// MOCK_ALPHA_WARNING is appended to the ledger metadata once (a strategy
/// whose apparent edge is mostly/entirely an artifact of underpriced
/// friction is flagged, not silently reported as profitable).
export function trackRealityGap(entries: readonly TradeWithNetReturn[], config: RealityGapConfig): LedgerWithMetadata {
  const gaps = entries.map(computeRealityGap);
  const metadata: string[] = [];

  for (let i = 0; i < gaps.length; i++) {
    const windowStart = Math.max(0, i - config.windowSize + 1);
    const window = gaps.slice(windowStart, i + 1);
    const trailingAvg = window.reduce((sum, g) => sum + g, 0) / window.length;
    if (trailingAvg > config.maxGap) {
      metadata.push(MOCK_ALPHA_WARNING);
      break;
    }
  }

  return { trades: entries.map((e) => e.trade), metadata };
}
