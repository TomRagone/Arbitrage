import Link from "next/link";
import { computeVerdict, listPreRegistrationRecords } from "@/lib/preregistration";

function StatusBadge({ status }: { status: "significant" | "null" | "in-progress" }) {
  const label = status === "in-progress" ? "in progress" : status;
  return <span className={`badge badge-${status}`}>{label}</span>;
}

// Same neutral-vs-alarming distinction as the search detail page's
// VerdictBlock: a clean null (NO-EDGE) is not an error.
const VERDICT_BADGE_STYLE: Record<"GO" | "NO-EDGE" | "PENDING" | "ANOMALY", { cls: string; icon: string; label: string }> = {
  GO: { cls: "badge-significant", icon: "✅", label: "GO" },
  "NO-EDGE": { cls: "badge-no-edge", icon: "–", label: "NO EDGE FOUND" },
  PENDING: { cls: "badge-in-progress", icon: "…", label: "PENDING" },
  ANOMALY: { cls: "badge-anomaly", icon: "⚠️", label: "ANOMALY" },
};

function VerdictBadge({ status }: { status: "GO" | "NO-EDGE" | "PENDING" | "ANOMALY" }) {
  const style = VERDICT_BADGE_STYLE[status];
  return (
    <span className={`badge ${style.cls}`}>
      {style.icon} {style.label}
    </span>
  );
}

export default function OverviewPage() {
  const records = listPreRegistrationRecords();

  return (
    <>
      <h1>Pre-registered searches</h1>
      <p className="subtitle">
        Every committed search under <code>docs/preregistration/</code>, reverse chronological. A null result at the
        committed budget is the answer for that budget, not a cue to re-roll — see{" "}
        <code>docs/PRE_REGISTRATION_POLICY.md</code>.
      </p>

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Hypothesis / question</th>
            <th>Date range</th>
            <th>Search space</th>
            <th>Status</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.fileSlug}>
              <td>
                <Link href={`/search/${r.fileSlug}`} className="mono">
                  {r.runId}
                </Link>
              </td>
              <td style={{ maxWidth: 420 }}>{r.question || <span className="empty">(not parsed)</span>}</td>
              <td className="mono" style={{ whiteSpace: "nowrap" }}>
                {r.dateRange || <span className="empty">—</span>}
              </td>
              <td className="mono">{r.searchSpaceSize ? `${r.searchSpaceSize} candidates` : "—"}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>
                <VerdictBadge status={computeVerdict(r).status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {records.length === 0 && <p className="empty">No pre-registration records found.</p>}
    </>
  );
}
