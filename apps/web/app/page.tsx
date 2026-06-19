import Link from "next/link";
import { listPreRegistrationRecords } from "@/lib/preregistration";

function StatusBadge({ status }: { status: "significant" | "null" | "in-progress" }) {
  const label = status === "in-progress" ? "in progress" : status;
  return <span className={`badge badge-${status}`}>{label}</span>;
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
            </tr>
          ))}
        </tbody>
      </table>

      {records.length === 0 && <p className="empty">No pre-registration records found.</p>}
    </>
  );
}
