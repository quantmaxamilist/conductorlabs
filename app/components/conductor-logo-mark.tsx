type ConductorLogoMarkProps = {
  size: "sm" | "lg";
  className?: string;
};

/** Vertical bar waveform — tallest at centre, symmetric falloff. */
export function ConductorLogoMark({ size, className }: ConductorLogoMarkProps) {
  const heights = [0.26, 0.4, 0.55, 0.72, 1, 0.72, 0.55, 0.4, 0.26];
  const barW = size === "sm" ? 2 : 4;
  const gap = size === "sm" ? 2 : 3.5;
  const maxH = size === "sm" ? 16 : 52;
  const n = heights.length;
  const totalW = n * barW + (n - 1) * gap;
  const vbH = maxH + 8;
  const midY = vbH / 2;

  return (
    <svg
      viewBox={`0 0 ${totalW} ${vbH}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {heights.map((rel, i) => {
        const bh = rel * maxH;
        const x = i * (barW + gap);
        const y = midY - bh / 2;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={bh}
            rx={barW * 0.35}
            fill="white"
          />
        );
      })}
    </svg>
  );
}
