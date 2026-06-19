import fs from "fs";
import path from "path";

const PREREG_DIR = path.join(process.cwd(), "..", "..", "sol-edge-os", "docs", "preregistration");
const MARKET_CONFIG_PATH = path.join(process.cwd(), "..", "..", "sol-edge-os", "config", "market.json");
const FRICTION_CONFIG_PATH = path.join(process.cwd(), "..", "..", "sol-edge-os", "config", "frictionCalibration.json");

export interface FoldResult {
  fold: string;
  expectancyBps: string;
  trades: string;
  rule: string;
}

export interface PreRegistrationRecord {
  fileSlug: string; // filename without .md, used for routing
  runId: string; // e.g. "10C-002"
  committedSearchNumber: string;
  question: string;
  dateRange: string;
  searchSpaceSize: string;
  decision: string; // ENUMERATE / SAMPLE description line
  preHoldoutDescription: string;

  hasResult: boolean;
  status: "significant" | "null" | "in-progress";
  dataUsed: string;
  resultHoldoutDescription: string;
  foldResults: FoldResult[];
  foldNote: string;
  pooledTopCandidate: string;
  pooledOosExpectancy: string;
  pooledOosTrades: string;
  pooledOosMaxDrawdown: string;
  trialsCommittedN: string;
  dsrVerdict: string;
  holdoutStatus: string;
  conclusion: string;

  rawMarkdown: string;
}

/// Extracts the value following a `- Label:` bullet line, up to the next
/// bullet (`- `/`→`) or blank-line-then-heading boundary. Tolerant of the
/// PRE block's free-form prose style (pre-existing, not standardized).
function extractBullet(md: string, label: string): string {
  const re = new RegExp(`-\\s*${label}\\s*:\\s*([^\\n]*(?:\\n(?!\\s*-\\s|\\s*\\n|#)[^\\n]*)*)`, "i");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

/// Extracts the value following a `**Label:**` line — the standardized
/// RESULT format's field shape (docs/preregistration/RESULT_FORMAT.md).
function extractLabeledField(md: string, label: string): string {
  const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]*)`, "i");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}

function extractSearchSpaceSize(md: string): string {
  const m = md.match(/→\s*\|space\|\s*=.*?\*\*([\d,]+)\*\*/);
  return m ? m[1] : "";
}

/// Pulls an ISO-date .. ISO-date range out of free text (the "Data used"
/// RESULT field, or whatever PRE-block text mentions dates if there's no
/// result yet) — used for the overview table's date-range column.
function extractDateRange(text: string): string {
  const m = text.match(/(\d{4}-\d{2}-\d{2}T[\d:]+Z)\s*\.\.\s*(\d{4}-\d{2}-\d{2}T[\d:]+Z)/);
  if (!m) return "";
  const start = m[1].slice(0, 10);
  const end = m[2].slice(0, 10);
  return `${start} .. ${end}`;
}

/// Isolates the "### Per-fold results" section's body (everything up to
/// the next heading or the first **Label:** field, whichever comes
/// first) — the table may not immediately follow the heading (a
/// structural note paragraph can sit in between, as in 10C-001's
/// reformatted record), so this scans the whole section rather than
/// assuming adjacency.
function extractPerFoldSection(md: string): string {
  const m = md.match(/### Per-fold results\s*\n([\s\S]*?)(?=\n###|\n\*\*[A-Z]|$)/);
  return m ? m[1] : "";
}

function extractFoldTable(md: string): FoldResult[] {
  const section = extractPerFoldSection(md);
  const lines = section.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return [];
  // Skip header row (line 0) and separator row (line 1, "|---|---|...")
  const dataLines = lines.slice(2);
  return dataLines.map((line) => {
    const cells = line.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    const [fold, expectancyBps, trades, rule] = cells;
    return { fold: fold ?? "", expectancyBps: expectancyBps ?? "", trades: trades ?? "", rule: rule ?? "" };
  });
}

function extractFoldNote(md: string): string {
  const section = extractPerFoldSection(md);
  // The note is whichever non-table, non-blank paragraph appears in the
  // section — could be before the table (a structural caveat) or after it
  // (a stability observation). Concatenate all non-table text.
  const note = section
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("|"))
    .join(" ")
    .trim();
  return note;
}

function deriveStatus(dsrVerdict: string, hasResult: boolean): "significant" | "null" | "in-progress" {
  if (!hasResult) return "in-progress";
  if (/significant:\s*yes/i.test(dsrVerdict)) return "significant";
  return "null";
}

export function listPreRegistrationRecords(): PreRegistrationRecord[] {
  const files = fs
    .readdirSync(PREREG_DIR)
    .filter((f) => f.endsWith(".md") && f !== "TEMPLATE.md" && f !== "RESULT_FORMAT.md");

  const records = files.map((file) => {
    const raw = fs.readFileSync(path.join(PREREG_DIR, file), "utf-8");
    return parsePreRegistrationRecord(file.replace(/\.md$/, ""), raw);
  });

  // Reverse chronological by run ID (10C-001 < 10C-002 < ... lexically works
  // for this run-ID scheme since the numeric suffix is zero-padded-ish and
  // monotonic; fall back to filename if run IDs ever collide).
  return records.sort((a, b) => b.runId.localeCompare(a.runId));
}

export function getPreRegistrationRecord(fileSlug: string): PreRegistrationRecord | null {
  const filePath = path.join(PREREG_DIR, `${fileSlug}.md`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  return parsePreRegistrationRecord(fileSlug, raw);
}

function parsePreRegistrationRecord(fileSlug: string, md: string): PreRegistrationRecord {
  const [preBlock, resultBlock] = md.split(/##\s*RESULT/i);
  const runId = extractBullet(preBlock, "Run ID") || fileSlug;
  const question = extractBullet(preBlock, "Question\\s*/\\s*hypothesis");
  const committedSearchNumber = extractBullet(preBlock, "Committed-search # on this question");
  const searchSpaceSize = extractSearchSpaceSize(preBlock);
  const decisionMatch = preBlock.match(/-\s*Decision\s*:\s*([^\n]*)/i);
  const decision = decisionMatch ? decisionMatch[1].trim() : "";
  const preHoldoutDescription = extractBullet(preBlock, "Holdout") || extractBullet(preBlock, "Split");

  const hasResultContent = !!resultBlock && /\*\*Data used:\*\*|Data actually/.test(resultBlock);

  const dsrVerdict = hasResultContent ? extractLabeledField(resultBlock, "DSR verdict") : "";
  const dataUsedField = hasResultContent ? extractLabeledField(resultBlock, "Data used") : "";
  const dateRange = extractDateRange(dataUsedField) || extractDateRange(preBlock);

  return {
    fileSlug,
    runId,
    committedSearchNumber,
    question,
    dateRange,
    searchSpaceSize,
    decision,
    preHoldoutDescription,
    hasResult: hasResultContent,
    status: deriveStatus(dsrVerdict, hasResultContent),
    dataUsed: hasResultContent ? extractLabeledField(resultBlock, "Data used") : "",
    resultHoldoutDescription: hasResultContent ? extractLabeledField(resultBlock, "Holdout") : "",
    foldResults: hasResultContent ? extractFoldTable(resultBlock) : [],
    foldNote: hasResultContent ? extractFoldNote(resultBlock) : "",
    pooledTopCandidate: hasResultContent ? extractLabeledField(resultBlock, "Pooled top candidate") : "",
    pooledOosExpectancy: hasResultContent ? extractLabeledField(resultBlock, "Pooled OOS expectancy") : "",
    pooledOosTrades: hasResultContent ? extractLabeledField(resultBlock, "Pooled OOS trades") : "",
    pooledOosMaxDrawdown: hasResultContent ? extractLabeledField(resultBlock, "Pooled OOS max drawdown") : "",
    trialsCommittedN: hasResultContent ? extractLabeledField(resultBlock, "Trials \\(committed N\\)") : "",
    dsrVerdict,
    holdoutStatus: hasResultContent ? extractLabeledField(resultBlock, "Holdout status") : "",
    conclusion: hasResultContent ? extractLabeledField(resultBlock, "Conclusion") : "",
    rawMarkdown: md,
  };
}

export interface MarketConfig {
  dataSource: string;
  exchange: string;
  pair: string;
  marketType: string;
  resolution: string;
  feeTier: {
    tierName: string;
    thirtyDayVolumeUsd: string;
    takerFeeBps: number;
    makerFeeBps: number;
    fillModel: string;
    feeUsed: string;
    source: string;
    note: string;
  };
  _lockNote: string;
}

export interface FrictionCalibration {
  derivedAt: string;
  sourceMarketConfig: { exchange: string; pair: string; resolution: string };
  sampleWindow: { windowDays: number; barsUsed: number; fromTs: number; toTs: number };
  simConfig: { alpha: number; beta: number; gammaPanic: number; kappaImpact: number; fixedFeeRate: number };
  frictionParams: { sigmaEntry: number; sigmaExit: number; quantity: number; adv: number };
  measured: { spreadFraction: number; medianSigma: number; adv: number; fixedFeeRate: number };
  assumed: { referenceImpactRatio: number; gammaPanic: number };
  _methodologyNote: string;
}

export function getMarketConfig(): MarketConfig {
  return JSON.parse(fs.readFileSync(MARKET_CONFIG_PATH, "utf-8"));
}

export function getFrictionCalibration(): FrictionCalibration {
  return JSON.parse(fs.readFileSync(FRICTION_CONFIG_PATH, "utf-8"));
}
