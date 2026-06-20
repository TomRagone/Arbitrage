/// Server-rendered inline SVG equity curve — no client JS, no charting
/// library. Plots cumulative equity (starting at 1.0) implied by a
/// chronological sequence of net log returns, same fixed-ledger-order
/// math as run.ts's maxDrawdown. Deliberately plain: this is a research
/// log, not a marketing page.
export function EquityCurveChart({ returns }: { returns: readonly number[] }) {
  if (returns.length === 0) {
    return <p className="empty">No per-trade data available for this candidate.</p>;
  }
  if (returns.length < 5) {
    return (
      <p className="empty">
        Only {returns.length} trade{returns.length === 1 ? "" : "s"} — too few to chart a meaningful equity curve.
      </p>
    );
  }

  const width = 640;
  const height = 200;
  const padding = 28;

  let equity = 1;
  const points: number[] = [1];
  for (const r of returns) {
    equity *= Math.exp(r);
    points.push(equity);
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const xStep = (width - padding * 2) / (points.length - 1);
  const toY = (v: number) => height - padding - ((v - min) / range) * (height - padding * 2);
  const toX = (i: number) => padding + i * xStep;

  const pathD = points.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");
  const baselineY = toY(1);
  const finalUp = points[points.length - 1] >= 1;

  return (
    <svg width={width} height={height} role="img" aria-label="Equity curve">
      <line x1={padding} y1={baselineY} x2={width - padding} y2={baselineY} stroke="#30363d" strokeDasharray="4 3" />
      <text x={padding} y={baselineY - 4} fontSize="10" fill="#8b949e">
        1.00 (breakeven)
      </text>
      <path d={pathD} fill="none" stroke={finalUp ? "#3fb950" : "#f85149"} strokeWidth={1.5} />
      <text x={width - padding} y={padding - 8} fontSize="11" fill="#8b949e" textAnchor="end">
        {points.length - 1} trades
      </text>
      <text x={padding} y={padding - 8} fontSize="11" fill="#8b949e">
        final equity: {points[points.length - 1].toFixed(4)}
      </text>
    </svg>
  );
}
