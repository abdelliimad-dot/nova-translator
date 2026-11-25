"use client";

interface AudioVisualizerProps {
  /** Normalized 0..1 audio level */
  level: number;
  active?: boolean;
  accent?: "forest" | "sand" | "cyan" | "indigo" | "emerald";
  bars?: number;
  compact?: boolean;
}

const BAR_WEIGHTS = [0.45, 0.72, 1.0, 0.85, 0.95, 0.68, 0.5];

export default function AudioVisualizer({
  level,
  active = false,
  accent = "forest",
  bars = 7,
  compact = false,
}: AudioVisualizerProps) {
  const clamped = Math.max(0, Math.min(1, level));

  const isSand = accent === "sand" || accent === "indigo";
  const activeColor = isSand ? "bg-[#C58B62]" : "bg-[#315F4A]";
  const idleColor = isSand ? "bg-[#E8D8BF]" : "bg-[#DCE8DD]";

  return (
    <div
      className={`flex items-center ${compact ? "gap-0.5 h-5" : "gap-1 h-6"}`}
      aria-hidden="true"
    >
      {Array.from({ length: bars }).map((_, idx) => {
        const weight = BAR_WEIGHTS[idx % BAR_WEIGHTS.length];
        const minPct = active ? 24 : 18;
        const dynamicPct = Math.min(
          100,
          Math.round(minPct + clamped * weight * (100 - minPct))
        );
        const isLit = active || clamped > 0.04;

        return (
          <span
            key={idx}
            className={`w-1 rounded-full transition-[height,background-color] duration-75 ${
              isLit ? activeColor : idleColor
            }`}
            style={{ height: `${dynamicPct}%` }}
          />
        );
      })}
    </div>
  );
}
