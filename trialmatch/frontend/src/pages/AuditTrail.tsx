import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuditLog } from "@/types";
import { auditApi } from "@/api/audit";

// ─── Style maps ──────────────────────────────────────────────────────────────

const ACTION_STYLE: Record<
  string,
  { color: string; bg: string; border: string; label: string }
> = {
  create: {
    color: "#34d399",
    bg: "rgba(16,185,129,0.12)",
    border: "rgba(16,185,129,0.2)",
    label: "Création",
  },
  update: {
    color: "#60a5fa",
    bg: "rgba(59,130,246,0.12)",
    border: "rgba(59,130,246,0.2)",
    label: "Modification",
  },
  delete: {
    color: "#fb7185",
    bg: "rgba(244,63,94,0.12)",
    border: "rgba(244,63,94,0.2)",
    label: "Suppression",
  },
  validate: {
    color: "#2dd4bf",
    bg: "rgba(20,184,166,0.12)",
    border: "rgba(20,184,166,0.2)",
    label: "Validation",
  },
  override: {
    color: "#fbbf24",
    bg: "rgba(245,158,11,0.12)",
    border: "rgba(245,158,11,0.2)",
    label: "Override",
  },
  login: {
    color: "#818cf8",
    bg: "rgba(99,102,241,0.12)",
    border: "rgba(99,102,241,0.2)",
    label: "Connexion",
  },
};

const ENTITY_LABEL: Record<string, string> = {
  protocol: "Protocole",
  patient: "Patient",
  analysis: "Analyse",
  document: "Document",
  criterion: "Critère",
};

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
      className="h-12 rounded-xl animate-pulse"
    />
  );
}

// ─── Log row ──────────────────────────────────────────────────────────────────

function LogRow({ log }: { log: AuditLog }) {
  const actionStyle = ACTION_STYLE[log.action] ?? {
    color: "#7a9bbf",
    bg: "rgba(122,155,191,0.12)",
    border: "rgba(122,155,191,0.2)",
    label: log.action,
  };

  const entityLabel = ENTITY_LABEL[log.entity] ?? log.entity;

  const timestamp = log.created_at
    ? new Date(log.created_at).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
      className="flex items-center gap-3 rounded-xl px-4 py-3"
    >
      {/* Timestamp */}
      <span
        style={{ color: "var(--text-muted, #3d5a7a)", fontFamily: "monospace" }}
        className="text-xs w-36 shrink-0 tabular-nums"
      >
        {timestamp}
      </span>

      {/* Action badge */}
      <span
        style={{
          color: actionStyle.color,
          background: actionStyle.bg,
          border: `1px solid ${actionStyle.border}`,
        }}
        className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
      >
        {actionStyle.label}
      </span>

      {/* Entity chip */}
      <span
        style={{
          color: "var(--text-secondary, #7a9bbf)",
          background: "rgba(255,255,255,0.06)",
        }}
        className="text-xs px-2 py-0.5 rounded-md shrink-0"
      >
        {entityLabel}
      </span>

      {/* Description */}
      <span
        style={{ color: "var(--text-primary, #dde8f5)" }}
        className="text-sm flex-1 truncate"
      >
        {log.description ?? "—"}
      </span>

      {/* Username */}
      <span
        style={{ color: "var(--text-muted, #3d5a7a)", fontFamily: "monospace" }}
        className="text-xs shrink-0"
      >
        {log.username ?? "—"}
      </span>
    </div>
  );
}

// ─── AuditTrail ───────────────────────────────────────────────────────────────

export function AuditTrail() {
  const [filterAction, setFilterAction] = useState<string>("");
  const [filterEntity, setFilterEntity] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const { data: logs, isLoading } = useQuery<AuditLog[]>({
    queryKey: ["audit-logs"],
    queryFn: () => auditApi.list().then((r) => r.data),
    refetchInterval: 5000,
  });

  const filtered = (logs ?? []).filter((log) => {
    const matchAction = filterAction === "" || log.action === filterAction;
    const matchEntity = filterEntity === "" || log.entity === filterEntity;
    const matchSearch =
      search === "" ||
      (log.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (log.username ?? "").includes(search);
    return matchAction && matchEntity && matchSearch;
  });

  return (
    <div className="flex flex-col h-full gap-4 p-6">
      {/* ── Filter bar ── */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          className="input-dark rounded-xl px-4 py-2 text-sm w-48"
        />

        {/* Action select */}
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-primary, #dde8f5)",
          }}
          className="input-dark rounded-xl px-4 py-2 text-sm"
        >
          <option value="">Toutes les actions</option>
          <option value="create">create</option>
          <option value="update">update</option>
          <option value="delete">delete</option>
          <option value="validate">validate</option>
          <option value="override">override</option>
          <option value="login">login</option>
        </select>

        {/* Entity select */}
        <select
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-primary, #dde8f5)",
          }}
          className="input-dark rounded-xl px-4 py-2 text-sm"
        >
          <option value="">Toutes les entités</option>
          <option value="protocol">protocol</option>
          <option value="patient">patient</option>
          <option value="analysis">analysis</option>
          <option value="document">document</option>
          <option value="criterion">criterion</option>
        </select>

        {/* Count badge */}
        <span
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-secondary, #7a9bbf)",
          }}
          className="text-xs px-3 py-1.5 rounded-xl font-medium ml-auto"
        >
          {filtered.length} entrée{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Log list ── */}
      <div className="flex flex-col space-y-2 overflow-auto flex-1 min-h-0">
        {isLoading ? (
          <>
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonRow key={i} />
            ))}
          </>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <svg
              style={{ color: "var(--text-muted, #3d5a7a)" }}
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <p style={{ color: "var(--text-muted, #3d5a7a)" }} className="text-sm">
              Aucun événement enregistré
            </p>
          </div>
        ) : (
          filtered.map((log) => <LogRow key={log.id} log={log} />)
        )}
      </div>
    </div>
  );
}
