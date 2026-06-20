import Link from "next/link";
import { getFrictionCalibration, getMarketConfig, listPreRegistrationRecords } from "@/lib/preregistration";

export default function ProvenancePage() {
  const market = getMarketConfig();
  const friction = getFrictionCalibration();
  const records = listPreRegistrationRecords().filter((r) => r.hasResult && r.dataUsed);

  // Pick the record with the deepest real data depth (largest bar count) as
  // the canonical "current real data depth" reading — later searches repair
  // earlier ones' data-availability preconditions (§2), so the latest/deepest
  // is the one that reflects current reality.
  const deepest = records
    .map((r) => {
      const barCountMatch = r.dataUsed.match(/^([\d,]+)\s*bars/);
      const barCount = barCountMatch ? parseInt(barCountMatch[1].replace(/,/g, ""), 10) : 0;
      return { record: r, barCount };
    })
    .sort((a, b) => b.barCount - a.barCount)[0];

  return (
    <>
      <Link href="/">&larr; all searches</Link>
      <h1>Data provenance</h1>
      <p className="subtitle">
        What data this apparatus actually runs against, and how its friction model is calibrated — pulled directly
        from <code>config/market.json</code>, <code>config/frictionCalibration.json</code>, and the most data-rich
        pre-registration RESULT on file.
      </p>

      <h2>Venue / instrument (config/market.json)</h2>
      <dl className="card">
        <div className="field">
          <dt>Data source</dt>
          <dd className="mono">{market.dataSource}</dd>
        </div>
        <div className="field">
          <dt>Exchange</dt>
          <dd className="mono">{market.exchange}</dd>
        </div>
        <div className="field">
          <dt>Pair</dt>
          <dd className="mono">{market.pair}</dd>
        </div>
        <div className="field">
          <dt>Market type</dt>
          <dd className="mono">{market.marketType}</dd>
        </div>
        <div className="field">
          <dt>Resolution</dt>
          <dd className="mono">{market.resolution}</dd>
        </div>
        <div className="field">
          <dt>Fee tier</dt>
          <dd>
            {market.feeTier.tierName} — taker {market.feeTier.takerFeeBps}bps / maker {market.feeTier.makerFeeBps}bps
            (volume &lt; {market.feeTier.thirtyDayVolumeUsd} USD)
          </dd>
        </div>
        <div className="field">
          <dt>Fee used in sim</dt>
          <dd className="mono">{market.feeTier.feeUsed}</dd>
        </div>
        <div className="field">
          <dt>Fill model</dt>
          <dd className="mono">{market.feeTier.fillModel}</dd>
        </div>
        <div className="field">
          <dt>Lock note</dt>
          <dd className="prose">{market._lockNote}</dd>
        </div>
      </dl>

      <h2>Real data depth (from the deepest pre-registration RESULT on file)</h2>
      {deepest ? (
        <dl className="card">
          <div className="field">
            <dt>Source search</dt>
            <dd>
              <Link href={`/search/${deepest.record.fileSlug}`} className="mono">
                {deepest.record.runId}
              </Link>
            </dd>
          </div>
          <div className="field">
            <dt>Data used (verbatim)</dt>
            <dd className="prose">{deepest.record.dataUsed}</dd>
          </div>
        </dl>
      ) : (
        <p className="empty">No pre-registration record with a filled RESULT section yet.</p>
      )}

      <h2>Friction calibration (config/frictionCalibration.json)</h2>
      <dl className="card">
        <div className="field">
          <dt>Derived at</dt>
          <dd className="mono">{friction.derivedAt}</dd>
        </div>
        <div className="field">
          <dt>Sample window</dt>
          <dd className="mono">
            {friction.sampleWindow.windowDays} days, {friction.sampleWindow.barsUsed} bars
          </dd>
        </div>
        <div className="field">
          <dt>alpha (half-spread)</dt>
          <dd className="mono">{friction.simConfig.alpha}</dd>
        </div>
        <div className="field">
          <dt>beta</dt>
          <dd className="mono">{friction.simConfig.beta}</dd>
        </div>
        <div className="field">
          <dt>kappaImpact</dt>
          <dd className="mono">{friction.simConfig.kappaImpact}</dd>
        </div>
        <div className="field">
          <dt>gammaPanic</dt>
          <dd className="mono">{friction.simConfig.gammaPanic}</dd>
        </div>
        <div className="field">
          <dt>fixedFeeRate</dt>
          <dd className="mono">{friction.simConfig.fixedFeeRate}</dd>
        </div>
        <div className="field">
          <dt>Measured spread fraction</dt>
          <dd className="mono">{friction.measured.spreadFraction}</dd>
        </div>
        <div className="field">
          <dt>Measured median sigma</dt>
          <dd className="mono">{friction.measured.medianSigma}</dd>
        </div>
        <div className="field">
          <dt>Measured ADV</dt>
          <dd className="mono">{friction.measured.adv}</dd>
        </div>
        <div className="field">
          <dt>Assumed (not measured)</dt>
          <dd className="mono">
            referenceImpactRatio={friction.assumed.referenceImpactRatio}, gammaPanic={friction.assumed.gammaPanic}
          </dd>
        </div>
        <div className="field">
          <dt>Methodology note</dt>
          <dd className="prose">{friction._methodologyNote}</dd>
        </div>
      </dl>
    </>
  );
}
