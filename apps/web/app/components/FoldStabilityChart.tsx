/// Server-rendered inline SVG bar chart of each fold's best OOS
/// expectancy (bps/trade) — makes walk-forward instability visible at a
/// glance (e.g. 10C-002's folds ranging 2.62 to 791.50bps/trade).
export function FoldStabilityChart({ folds }: { folds: readonly { fold: number; expectancyBps: number; trades: number }[] }) {
  if (folds.length === 0) {
    return <p className="empty">No per-fold data available.</p>;
  }

  const width = 640;
  const height = 180;
  const padding = 32;
  const barGap = 6;
  const barWidth = (width - padding * 2) / folds.length - barGap;

  const values = folds.map((f) => f.expectancyBps);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const zeroY = padding + (max / range) * (height - padding * 2);

  return (
    <svg width={width} height={height} role="img" aria-label="Per-fold OOS expectancy stability">
      <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="#30363d" />
      {folds.map((f, i) => {
        const x = padding + i * (barWidth + barGap);
        const barHeight = (Math.abs(f.expectancyBps) / range) * (height - padding * 2);
        const y = f.expectancyBps >= 0 ? zeroY - barHeight : zeroY;
        return (
          <g key={f.fold}>
            <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 1)} fill={f.expectancyBps >= 0 ? "#3fb950" : "#f85149"} opacity={0.85} />
            <text x={x + barWidth / 2} y={height - 6} fontSize="10" fill="#8b949e" textAnchor="middle">
              F{f.fold}
            </text>
          </g>
        );
      })}
      <text x={padding} y={12} fontSize="11" fill="#8b949e">
        bps/trade per fold (best candidate), {Math.min(...values).toFixed(1)} to {Math.max(...values).toFixed(1)}
      </text>
    </svg>
  );
}
