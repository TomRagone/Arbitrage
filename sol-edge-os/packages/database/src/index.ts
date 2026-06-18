export { FeatureEngine } from "./features";
export { ingestOHLCV, DEFAULT_DB_PATH, type MarketConfig, type FeeTierConfig, type IngestResult } from "./ingest";
export {
  validateDataIntegrity,
  DataIntegrityException,
  type OHLCVBar,
  type GapAnomaly,
  type IntegrityReport,
} from "./validate_data";
export { findGapIndices, segmentAtGaps, markTradeable, type GapSegment } from "./gaps";
