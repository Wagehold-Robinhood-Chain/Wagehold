export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;

  const w = 280;
  const h = 64;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="block h-16 w-full"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-gold)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
