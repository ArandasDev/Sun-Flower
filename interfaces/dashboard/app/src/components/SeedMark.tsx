const GOLDEN_ANGLE = (137.508 * Math.PI) / 180;

/** Static sunflower seed head: a petal ring and phyllotaxis dots. */
export function SeedMark({ size, dots = 9 }: { size: number; dots?: number }) {
  const scale = 16 / Math.sqrt(dots + 1);
  const points = Array.from({ length: dots }, (_, i) => {
    const n = i + 1;
    const radius = scale * Math.sqrt(n);
    return {
      n,
      x: 20 + radius * Math.cos(n * GOLDEN_ANGLE),
      y: 20 + radius * Math.sin(n * GOLDEN_ANGLE),
    };
  });
  return (
    <svg className="seed-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" className="seed-mark-ring" />
      {points.map((p) => (
        <circle key={p.n} cx={p.x} cy={p.y} r={dots > 12 ? 1.1 : 2} className="seed-mark-dot" />
      ))}
    </svg>
  );
}
