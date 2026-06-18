/**
 * Data integrity gate — the "8.x for data". Pure, no I/O. Real OHLCV
 * (Step 10A.1) carries volume, which CompactCandle (the locked Phase 0-8
 * core type) does not model — so this validates a dedicated OHLCVBar
 * shape, not CompactCandle directly. A separate exception type
 * (DataIntegrityException) is used rather than reusing
 * CausalViolationException: these are data-quality violations (corrupted
 * bars), not information crossing a forbidden temporal boundary — a
 * different failure class from what CausalViolationException has meant
 * everywhere else in this codebase.
 */
export class DataIntegrityException extends Error {}

export interface OHLCVBar {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface GapAnomaly {
  readonly afterTimestamp: number;
  readonly expectedNextTimestamp: number;
  readonly actualNextTimestamp: number;
  // Positive: bars are missing (a real gap). Negative: bars arrived MORE
  // frequently than bar_duration implies (declared resolution doesn't
  // match the data's actual cadence) — also a real anomaly, reported either way.
  readonly missingBars: number;
}

export interface IntegrityReport {
  readonly barCount: number;
  readonly gaps: readonly GapAnomaly[];
}

/// Hard violations (timestamp ordering/duplicates, OHLC sanity, volume)
/// throw immediately with the specific violation named. Spacing gaps are
/// a soft anomaly — real exchange data legitimately has occasional gaps
/// (downtime, thin liquidity) — so they're collected into the report,
/// not thrown.
export function validateDataIntegrity(bars: readonly OHLCVBar[], barDurationSeconds: number): IntegrityReport {
  if (bars.length === 0) return { barCount: 0, gaps: [] };

  const gaps: GapAnomaly[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];

    if (!(bar.open > 0) || !(bar.high > 0) || !(bar.low > 0) || !(bar.close > 0)) {
      throw new DataIntegrityException(
        `validateDataIntegrity: non-positive price at timestamp ${bar.timestamp} (open=${bar.open}, high=${bar.high}, low=${bar.low}, close=${bar.close})`,
      );
    }
    if (!(bar.high >= Math.max(bar.open, bar.close))) {
      throw new DataIntegrityException(
        `validateDataIntegrity: OHLC sanity violation — high (${bar.high}) < max(open,close) (${Math.max(bar.open, bar.close)}) at timestamp ${bar.timestamp}`,
      );
    }
    if (!(bar.low <= Math.min(bar.open, bar.close))) {
      throw new DataIntegrityException(
        `validateDataIntegrity: OHLC sanity violation — low (${bar.low}) > min(open,close) (${Math.min(bar.open, bar.close)}) at timestamp ${bar.timestamp}`,
      );
    }

    if (bar.volume === undefined || bar.volume === null || Number.isNaN(bar.volume)) {
      throw new DataIntegrityException(`validateDataIntegrity: volume missing or NaN at timestamp ${bar.timestamp}`);
    }
    if (bar.volume < 0) {
      throw new DataIntegrityException(`validateDataIntegrity: negative volume (${bar.volume}) at timestamp ${bar.timestamp}`);
    }

    if (i > 0) {
      const prev = bars[i - 1];
      if (bar.timestamp === prev.timestamp) {
        throw new DataIntegrityException(`validateDataIntegrity: duplicate timestamp ${bar.timestamp} (indices ${i - 1} and ${i})`);
      }
      if (bar.timestamp < prev.timestamp) {
        throw new DataIntegrityException(
          `validateDataIntegrity: out-of-order timestamp — ${bar.timestamp} at index ${i} precedes ${prev.timestamp} at index ${i - 1}`,
        );
      }

      const expectedNext = prev.timestamp + barDurationSeconds;
      if (bar.timestamp !== expectedNext) {
        gaps.push({
          afterTimestamp: prev.timestamp,
          expectedNextTimestamp: expectedNext,
          actualNextTimestamp: bar.timestamp,
          missingBars: Math.round((bar.timestamp - expectedNext) / barDurationSeconds),
        });
      }
    }
  }

  return { barCount: bars.length, gaps };
}
