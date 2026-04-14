import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { analysesApi } from "@/api/analyses";
import type { Analysis, DashboardStats, ProtocolStats } from "@/types";

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  accent: string;
  icon: ReactNode;
}

function KpiCard({ label, value, subtitle, accent, icon }: KpiCardProps) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
      className="rounded-2xl p-5 flex flex-col gap-3"
    >
      <div
        style={{ background: `${accent}26` }}
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
      >
        <span style={{ color: accent }}>{icon}</span>
      </div>
      <div>
        <p
          style={{ color: "var(--text-muted, #3d5a7a)" }}
          className="text-xs font-semibold uppercase tracking-widest mb-1"
        >
          {label}
        </p>
        <p style={{ color: accent }} className="text-2xl font-bold leading-none">
          {value}
        </p>
        {subtitle && (
          <p
            style={{ color: "var(--text-secondary, #7a9bbf)" }}
            className="text-xs mt-1"
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const IconBarChart = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="18" y="3" width="4" height="18" rx="1" />
    <rect x="10" y="8" width="4" height="13" rx="1" />
    <rect x="2" y="13" width="4" height="8" rx="1" />
  </svg>
);

const IconCheckCircle = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
);

const IconUsers = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const IconClock = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

// ─── Protocol row ─────────────────────────────────────────────────────────────

function ProtocolRow({ group, isLast }: { group: ProtocolStats; isLast: boolean }) {
  const { protocol_title, protocol_id, eligible, non_eligible, incomplet, total } = group;
  const eligPct = total > 0 ? (eligible / total) * 100 : 0;
  const nonEligPct = total > 0 ? (non_eligible / total) * 100 : 0;
  const incompletPct = total > 0 ? (incomplet / total) * 100 : 0;

  return (
    <div
      style={!isLast ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : undefined}
      className="space-y-1.5 pb-4"
    >
      <div className="flex items-center justify-between">
        <span
          style={{ color: "var(--text-primary, #dde8f5)" }}
          className="text-sm font-medium truncate max-w-xs"
          title={protocol_title}
        >
          {protocol_title || protocol_id.slice(0, 8)}
        </span>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span
            style={{ background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.2)" }}
            className="text-xs px-2 py-0.5 rounded-full"
          >
            {eligible} Éligibles
          </span>
          <span
            style={{ background: "rgba(251,113,133,0.12)", color: "#fb7185", border: "1px solid rgba(251,113,133,0.2)" }}
            className="text-xs px-2 py-0.5 rounded-full"
          >
            {non_eligible} Non éligibles
          </span>
          <span
            style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" }}
            className="text-xs px-2 py-0.5 rounded-full"
          >
            {incomplet} Incomplets
          </span>
        </div>
      </div>
      <div
        style={{ background: "rgba(255,255,255,0.06)" }}
        className="h-2 rounded-full overflow-hidden flex"
      >
        {eligPct > 0 && (
          <div style={{ width: `${eligPct}%`, background: "#34d399" }} className="h-full" />
        )}
        {nonEligPct > 0 && (
          <div style={{ width: `${nonEligPct}%`, background: "#fb7185" }} className="h-full" />
        )}
        {incompletPct > 0 && (
          <div style={{ width: `${incompletPct}%`, background: "#fbbf24" }} className="h-full" />
        )}
      </div>
    </div>
  );
}

// ─── Verdict badge ────────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict?: string }) {
  let color = "#7a9bbf";
  let bg = "rgba(122,155,191,0.12)";
  let label = verdict ?? "—";

  if (verdict === "eligible") {
    color = "#34d399"; bg = "rgba(52,211,153,0.12)"; label = "Éligible";
  } else if (verdict === "non_eligible") {
    color = "#fb7185"; bg = "rgba(251,113,133,0.12)"; label = "Non éligible";
  } else if (verdict === "incomplet") {
    color = "#fbbf24"; bg = "rgba(251,191,36,0.12)"; label = "Incomplet";
  }

  return (
    <span
      style={{ color, background: bg }}
      className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
    >
      {label}
    </span>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
      className="rounded-2xl p-5 space-y-3 animate-pulse"
    >
      <div style={{ background: "rgba(255,255,255,0.06)" }} className="w-10 h-10 rounded-xl" />
      <div className="space-y-2">
        <div style={{ background: "rgba(255,255,255,0.06)" }} className="h-3 w-24 rounded" />
        <div style={{ background: "rgba(255,255,255,0.06)" }} className="h-7 w-16 rounded" />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
      className="h-12 rounded-xl animate-pulse"
    />
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export function Dashboard() {
  const {
    data: stats,
    isLoading: statsLoading,
  } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: () => analysesApi.dashboardStats().then((r) => r.data),
  });

  const {
    data: analyses,
    isLoading: analysesLoading,
  } = useQuery<Analysis[]>({
    queryKey: ["analyses"],
    queryFn: () => analysesApi.list().then((r) => r.data),
  });

  const isLoading = statsLoading || analysesLoading;

  const protocolGroups = stats?.per_protocol ?? [];

  const recentAnalyses = analyses
    ? [...analyses]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5)
    : [];

  const pendingCount = stats?.pending_validation ?? 0;
  const pendingColor = pendingCount > 0 ? "#fbbf24" : "#3d5a7a";

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      {/* ── A) KPI Cards ── */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            label="Analyses totales"
            value={stats?.total_analyses ?? 0}
            accent="#6366f1"
            icon={IconBarChart}
          />
          <KpiCard
            label="Taux d'éligibilité"
            value={`${stats?.eligible_rate_pct ?? 0}%`}
            subtitle="des patients évalués"
            accent="#34d399"
            icon={IconCheckCircle}
          />
          <KpiCard
            label="Patients"
            value={stats?.total_patients ?? 0}
            accent="#14b8a6"
            icon={IconUsers}
          />
          <KpiCard
            label="En attente validation"
            value={pendingCount}
            accent={pendingColor}
            icon={IconClock}
          />
        </div>
      )}

      {/* ── B) Per-protocol eligibility ── */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
        className="rounded-2xl p-6"
      >
        <p
          style={{ color: "var(--text-muted, #3d5a7a)" }}
          className="text-xs font-semibold uppercase tracking-widest mb-4"
        >
          Éligibilité par protocole
        </p>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : protocolGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <svg
              style={{ color: "var(--text-muted, #3d5a7a)" }}
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p style={{ color: "var(--text-muted, #3d5a7a)" }} className="text-sm">
              Aucune analyse disponible
            </p>
          </div>
        ) : (
          <div className="space-y-0">
            {protocolGroups.map((group, idx) => (
              <ProtocolRow
                key={group.protocol_id}
                group={group}
                isLast={idx === protocolGroups.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── C) Recent analyses ── */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
        className="rounded-2xl p-6"
      >
        <p
          style={{ color: "var(--text-muted, #3d5a7a)" }}
          className="text-xs font-semibold uppercase tracking-widest mb-4"
        >
          Activité récente
        </p>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : recentAnalyses.length === 0 ? (
          <p style={{ color: "var(--text-muted, #3d5a7a)" }} className="text-sm text-center py-6">
            Aucune analyse récente
          </p>
        ) : (
          <div className="space-y-2">
            {recentAnalyses.map((analysis) => {
              const score = analysis.score_pct != null ? `${analysis.score_pct}%` : "—";
              const date = analysis.created_at
                ? new Date(analysis.created_at).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : "—";
              const protocolShort = analysis.protocol_id
                ? analysis.protocol_id.slice(0, 8)
                : "—";

              return (
                <div
                  key={analysis.id}
                  style={{
                    background: "rgba(255,255,255,0.015)",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}
                  className="flex items-center gap-3 rounded-xl px-4 py-2.5"
                >
                  <VerdictBadge verdict={analysis.verdict} />
                  <span
                    style={{ color: "var(--text-primary, #dde8f5)" }}
                    className="text-sm font-semibold w-12 shrink-0 tabular-nums"
                  >
                    {score}
                  </span>
                  <span
                    style={{ color: "var(--text-secondary, #7a9bbf)" }}
                    className="text-xs flex-1"
                  >
                    {date}
                  </span>
                  <span
                    style={{ color: "var(--text-muted, #3d5a7a)", fontFamily: "monospace" }}
                    className="text-xs shrink-0"
                  >
                    {protocolShort}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
