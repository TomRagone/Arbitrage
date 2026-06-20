import fs from "fs";
import path from "path";

/// Structured per-search data, written alongside each pre-registration
/// markdown record so the dashboard has real numbers to chart (equity
/// curve, fold stability) instead of re-parsing prose. Same numbers as
/// the markdown RESULT section — this is a presentation artifact, not a
/// new source of truth. File name matches the markdown record's slug
/// (e.g. "10C-002-depth1-rsi-ema.json" next to "...-rsi-ema.md").
export interface SearchResultJson {
  readonly runId: string;
  readonly trials: number;
  readonly significant: boolean;
  readonly perFold: readonly { fold: number; expectancyBps: number; trades: number; rule: string }[];
  readonly topCandidate: {
    readonly label: string;
    readonly pooledExpectancyBps: number;
    readonly pooledTrades: number;
    readonly maxDrawdownPct: number;
  };
  /// Raw net log returns for the top candidate, in chronological trade
  /// order — what the dashboard's equity curve is built from. null when
  /// genuinely unavailable (10C-001 predates this artifact and re-running
  /// its live-ingestion script would not reproduce its locked record).
  readonly topCandidateReturns: readonly number[] | null;
  /// Per-trade holding periods (bars) for the top candidate, when computed
  /// (10C-004/005/006's whipsaw-churn diagnostic) — null where the
  /// question didn't apply (10C-001/002/003, pure mean-reversion runs).
  readonly topCandidateHoldingPeriods?: readonly number[] | null;
  readonly holdout: {
    readonly evaluated: boolean;
    readonly expectancyBps?: number;
    readonly trades?: number;
    readonly maxDrawdownPct?: number;
  };
  readonly generatedAt: string;
  readonly note?: string;
}

export function writeSearchResultJson(fileSlug: string, data: Omit<SearchResultJson, "generatedAt">, preregDir: string): void {
  const full: SearchResultJson = { ...data, generatedAt: new Date().toISOString() };
  const outPath = path.join(preregDir, `${fileSlug}.json`);
  fs.writeFileSync(outPath, JSON.stringify(full, null, 2) + "\n");
  console.log(`\nWrote ${outPath}`);
}
