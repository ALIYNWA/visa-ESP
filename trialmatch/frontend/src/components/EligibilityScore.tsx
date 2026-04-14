import type { Verdict } from "@/types";

interface Props {
  score: number;
  verdict: Verdict;
  latencyMs?: number | null;
}

const VERDICT_CONFIG: Record<Verdict, { label: string; color: string; bg: string; border: string; glow: string }> = {
  eligible:     { label: "ÉLIGIBLE",     color: "#34d399", bg: "rgba(16,185,129,0.12)",  border: "rgba(16,185,129,0.25)",  glow: "rgba(16,185,129,0.3)" },
  non_eligible: { label: "NON ÉLIGIBLE", color: "#fb7185", bg: "rgba(244,63,94,0.12)",   border: "rgba(244,63,94,0.25)",   glow: "rgba(244,63,94,0.3)" },
  incomplet:    { label: "INCOMPLET",    color: "#fbbf24", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.25)",  glow: "rgba(245,158,11,0.3)" },
};

export function EligibilityScore({ score, verdict, latencyMs }: Props) {
  const cfg = VERDICT_CONFIG[verdict];

  // SVG ring
  const R = 44;
  const C = 2 * Math.PI * R;
  const dash = (score / 100) * C;

  return (
    <div
      className="rounded-2xl p-6 flex items-center gap-6"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
      data-testid="eligibility-score"
    >
      {/* Ring */}
      <div className="relative shrink-0 flex items-center justify-center" style={{ width: 110, height: 110 }}>
        <svg width="110" height="110" viewBox="0 0 110 110">
          {/* Track */}
          <circle cx="55" cy="55" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8"/>
          {/* Progress */}
          <circle
            cx="55" cy="55" r={R}
            fill="none"
            stroke={cfg.color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${C}`}
            strokeDashoffset={C / 4}
            style={{ filter: `drop-shadow(0 0 6px ${cfg.glow})`, transition: "stroke-dasharray 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color: cfg.color }} data-testid="score-value">
            {score}%
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="flex-1">
        <span
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold mb-2"
          style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
          data-testid="verdict-badge"
        >
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: cfg.color }} />
          {cfg.label}
        </span>

        {/* Mini bar */}
        <div className="h-1.5 w-full rounded-full mt-3" style={{ background: "rgba(255,255,255,0.07)" }} data-testid="score-bar">
          <div
            className="h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${score}%`, background: cfg.color, boxShadow: `0 0 8px ${cfg.glow}` }}
          />
        </div>

        {latencyMs && (
          <p className="text-xs mt-2" style={{ color: "#475569" }}>
            Analyse effectuée en {(latencyMs / 1000).toFixed(1)}s · Meditron 70B
          </p>
        )}
      </div>
    </div>
  );
}
