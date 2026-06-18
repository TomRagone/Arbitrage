/**
 * Non-leaking gap policy. Pure, no I/O.
 *
 * CHOSEN RULE: per-window exclusion (NOT forward-fill).
 *
 * Forward-filling prices across a gap is explicitly rejected — it injects
 * stale values and manufactures fake flat-signal regimes (a constant
 * forward-filled price produces artificially zero volatility / zero
 * returns that a strategy could spuriously "trade"). Instead, gaps are
 * left as real discontinuities, and a bar is marked TRADEABLE only if the
 * `lookbackPeriods` bars immediately preceding-and-including it form an
 * unbroken, gap-free chain (each consecutive pair spaced exactly
 * barDuration). Any bar whose feature lookback window would span a gap is
 * non-tradeable — its features would be computed across a discontinuity
 * and are therefore untrustworthy.
 *
 * This is equivalent to segmenting the series at every gap and discarding
 * the first `lookbackPeriods - 1` bars of each segment as warmup —
 * segmentAtGaps() exposes that segmented view directly for callers that
 * prefer it. The gate consumes 10A.2's already-validated bars (monotonic,
 * de-duplicated), so the only spacing question left here is contiguity.
 */
import type { OHLCVBar } from "./validate_data";

export interface GapSegment {
  readonly startIndex: number; // inclusive index into the original bars array
  readonly endIndex: number; // inclusive; bars[startIndex..endIndex] are internally gap-free
}

/// Indices j (j >= 1) where bar[j] is NOT contiguous with bar[j-1], i.e. a
/// gap sits immediately before j. Assumes bars are already validated as
/// strictly-monotonic by validateDataIntegrity (10A.2).
export function findGapIndices(bars: readonly OHLCVBar[], barDurationSeconds: number): number[] {
  const gapIndices: number[] = [];
  for (let j = 1; j < bars.length; j++) {
    if (bars[j].timestamp - bars[j - 1].timestamp !== barDurationSeconds) gapIndices.push(j);
  }
  return gapIndices;
}

/// Contiguous (internally gap-free) segments of the series.
export function segmentAtGaps(bars: readonly OHLCVBar[], barDurationSeconds: number): GapSegment[] {
  if (bars.length === 0) return [];
  const gapIndices = findGapIndices(bars, barDurationSeconds);
  const segments: GapSegment[] = [];
  let start = 0;
  for (const j of gapIndices) {
    segments.push({ startIndex: start, endIndex: j - 1 });
    start = j;
  }
  segments.push({ startIndex: start, endIndex: bars.length - 1 });
  return segments;
}

/// Boolean mask aligned to `bars`: true iff this bar is tradeable, meaning
/// the `lookbackPeriods` bars ending at it (inclusive) are an unbroken,
/// gap-free chain. Computed via a running contiguous-run-length, O(n).
export function markTradeable(bars: readonly OHLCVBar[], barDurationSeconds: number, lookbackPeriods: number): boolean[] {
  if (!(lookbackPeriods >= 1)) throw new Error(`markTradeable: lookbackPeriods must be >= 1, got ${lookbackPeriods}`);
  const tradeable = new Array<boolean>(bars.length).fill(false);
  let runLength = 0; // length of the unbroken contiguous chain ending at i

  for (let i = 0; i < bars.length; i++) {
    if (i === 0 || bars[i].timestamp - bars[i - 1].timestamp === barDurationSeconds) {
      runLength += 1;
    } else {
      runLength = 1; // gap before i — a fresh chain starts at this bar
    }
    // The last `lookbackPeriods` bars are gap-free only once the unbroken
    // chain ending here is at least that long.
    tradeable[i] = runLength >= lookbackPeriods;
  }

  return tradeable;
}
