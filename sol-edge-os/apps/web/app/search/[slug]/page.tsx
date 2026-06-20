import Link from "next/link";
import { notFound } from "next/navigation";
import { computeVerdict, getPreRegistrationRecord } from "@/lib/preregistration";
import { EquityCurveChart } from "@/app/components/EquityCurveChart";
import { FoldStabilityChart } from "@/app/components/FoldStabilityChart";

// A clean null (NO-EDGE) is not an error -- it's the apparatus working
// correctly and finding nothing. Only ANOMALY (an actual rule/process
// violation) should read as alarming; everything else is calm/neutral.
const VERDICT_STYLE: Record<"GO" | "NO-EDGE" | "PENDING" | "ANOMALY", { badgeClass: string; borderColor: string; icon: string; label: string }> = {
  GO: { badgeClass: "badge-significant", borderColor: "var(--good)", icon: "✅", label: "GO" },
  "NO-EDGE": { badgeClass: "badge-no-edge", borderColor: "var(--border)", icon: "–", label: "NO EDGE FOUND" },
  PENDING: { badgeClass: "badge-in-progress", borderColor: "var(--accent)", icon: "…", label: "PENDING" },
  ANOMALY: { badgeClass: "badge-anomaly", borderColor: "var(--bad)", icon: "⚠️", label: "ANOMALY" },
};

function VerdictBlock({ verdict }: { verdict: { status: "GO" | "NO-EDGE" | "PENDING" | "ANOMALY"; reasons: readonly string[] } }) {
  const style = VERDICT_STYLE[verdict.status];
  return (
    <div className="card" style={{ borderLeft: `3px solid ${style.borderColor}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: verdict.reasons.length ? 10 : 0 }}>
        <span style={{ fontSize: 18 }}>{style.icon}</span>
        <span className={`badge ${style.badgeClass}`} style={{ fontSize: 13 }}>
          {style.label}
        </span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5 }}>
        {verdict.reasons.map((r, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function SearchDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = getPreRegistrationRecord(slug);
  if (!record) notFound();
  const verdict = computeVerdict(record);

  return (
    <>
      <Link href="/">&larr; all searches</Link>
      <h1 className="mono">{record.runId}</h1>
      <p className="subtitle">{record.question}</p>

      <h2>Verdict</h2>
      <VerdictBlock verdict={verdict} />

      <h2>PRE (committed before the run)</h2>
      <dl className="card">
        <div className="field">
          <dt>Committed-search #</dt>
          <dd>{record.committedSearchNumber || "—"}</dd>
        </div>
        <div className="field">
          <dt>Search space size</dt>
          <dd className="mono">{record.searchSpaceSize ? `${record.searchSpaceSize} candidates` : "—"}</dd>
        </div>
        <div className="field">
          <dt>Enumerate / sample decision</dt>
          <dd>{record.decision || "—"}</dd>
        </div>
        <div className="field">
          <dt>Holdout (as pre-registered)</dt>
          <dd>{record.preHoldoutDescription || "—"}</dd>
        </div>
      </dl>

      <h2>RESULT</h2>
      {!record.hasResult ? (
        <p className="empty">No RESULT recorded yet — this search is in progress or has not been run.</p>
      ) : (
        <>
          <dl className="card">
            <div className="field">
              <dt>Data used</dt>
              <dd>{record.dataUsed}</dd>
            </div>
            <div className="field">
              <dt>Holdout</dt>
              <dd>{record.resultHoldoutDescription}</dd>
            </div>
          </dl>

          <h3>Per-fold results</h3>
          {record.resultData && record.resultData.perFold.length > 0 && (
            <FoldStabilityChart folds={record.resultData.perFold} />
          )}
          {record.foldResults.length > 0 ? (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Fold</th>
                    <th>OOS expectancy (bps/trade)</th>
                    <th>Trades</th>
                    <th>Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {record.foldResults.map((f, i) => (
                    <tr key={i}>
                      <td className="mono">{f.fold}</td>
                      <td className="mono">{f.expectancyBps}</td>
                      <td className="mono">{f.trades}</td>
                      <td className="mono">{f.rule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {record.foldNote && <p className="subtitle">{record.foldNote}</p>}
            </>
          ) : (
            <p className="empty">No per-fold table parsed.</p>
          )}

          <h3>Pooled / significance-bearing result</h3>
          {record.resultData && (
            <div className="card">
              <EquityCurveChart returns={record.resultData.topCandidateReturns ?? []} />
            </div>
          )}
          <dl className="card">
            <div className="field">
              <dt>Top candidate</dt>
              <dd className="mono">{record.pooledTopCandidate}</dd>
            </div>
            <div className="field">
              <dt>OOS expectancy</dt>
              <dd className="mono">{record.pooledOosExpectancy}</dd>
            </div>
            <div className="field">
              <dt>OOS trades</dt>
              <dd className="mono">{record.pooledOosTrades}</dd>
            </div>
            <div className="field">
              <dt>OOS max drawdown</dt>
              <dd className="mono">{record.pooledOosMaxDrawdown}</dd>
            </div>
            <div className="field">
              <dt>Trials (committed N)</dt>
              <dd className="mono">{record.trialsCommittedN}</dd>
            </div>
            <div className="field">
              <dt>DSR verdict</dt>
              <dd>
                <span className={`badge badge-${record.status}`}>
                  {/significant:\s*yes/i.test(record.dsrVerdict) ? "significant" : "not significant"}
                </span>{" "}
                {record.dsrVerdict}
              </dd>
            </div>
            <div className="field">
              <dt>Holdout status</dt>
              <dd>
                {/untouched/i.test(record.holdoutStatus) ? (
                  <span className="badge badge-in-progress">locked, untouched</span>
                ) : (
                  <span className="badge badge-significant">evaluated once</span>
                )}{" "}
                {record.holdoutStatus}
              </dd>
            </div>
          </dl>

          <h3>Conclusion</h3>
          <p className="prose">{record.conclusion}</p>
        </>
      )}
    </>
  );
}
