import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { protocolsApi } from "@/api/protocols";
import { ProtocolForm } from "@/components/ProtocolForm";
import { CriterionList } from "@/components/CriterionList";
import { DocumentManager } from "@/components/DocumentManager";
import { VisitsSchedule } from "@/components/VisitsSchedule";
import type { CreateProtocolPayload, Protocol } from "@/types";

type DetailTab = "overview" | "criteria" | "documents" | "visits";

const PHASE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  I:   { bg: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "rgba(139,92,246,0.25)" },
  II:  { bg: "rgba(99,102,241,0.15)", color: "#818cf8", border: "rgba(99,102,241,0.25)" },
  III: { bg: "rgba(14,165,233,0.15)", color: "#38bdf8", border: "rgba(14,165,233,0.25)" },
  IV:  { bg: "rgba(20,184,166,0.15)", color: "#2dd4bf", border: "rgba(20,184,166,0.25)" },
};

export function ProtocolManager() {
  const qc = useQueryClient();
  const [selected, setSelected]   = useState<Protocol | null>(null);
  const [showForm, setShowForm]   = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");

  const { data: protocols = [], isLoading } = useQuery({
    queryKey: ["protocols"],
    queryFn: () => protocolsApi.list().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (p: CreateProtocolPayload) => protocolsApi.create(p),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ["protocols"] });
      setSelected(res.data);
      setShowForm(false);
      setDetailTab("criteria");
    },
  });

  const addCriterionMutation = useMutation({
    mutationFn: ({ protocolId, payload }: { protocolId: string; payload: { type: "INC"|"EXC"; text: string; order: number } }) =>
      protocolsApi.addCriterion(protocolId, payload),
    onSuccess: () => selected && protocolsApi.get(selected.id).then(r => setSelected(r.data)),
  });

  const deleteCriterionMutation = useMutation({
    mutationFn: ({ protocolId, criterionId }: { protocolId: string; criterionId: string }) =>
      protocolsApi.deleteCriterion(protocolId, criterionId),
    onSuccess: () => selected && protocolsApi.get(selected.id).then(r => setSelected(r.data)),
  });

  async function selectProtocol(id: string) {
    const r = await protocolsApi.get(id);
    setSelected(r.data);
    setShowForm(false);
    setDetailTab("overview");
  }

  return (
    <div className="flex h-full gap-4 min-w-0">

      {/* ── Protocol sidebar ─────────────────────────────────────────────────── */}
      <aside className="shrink-0 flex flex-col" style={{ width: "190px" }}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Protocoles ({protocols.length})
          </p>
          <button
            onClick={() => { setShowForm(true); setSelected(null); }}
            className="btn-primary text-xs px-3 py-1.5 rounded-lg text-white font-medium flex items-center gap-1"
          >
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
            </svg>
            Nouveau
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
            ))}
          </div>
        ) : (
          <ul className="space-y-1.5 flex-1 overflow-auto">
            {protocols.map(p => {
              const ph = PHASE_COLORS[p.phase] || PHASE_COLORS.II;
              const isActive = selected?.id === p.id;
              return (
                <li key={p.id}
                    onClick={() => selectProtocol(p.id)}
                    className="cursor-pointer rounded-xl px-4 py-3 transition-all"
                    style={{
                      background: isActive ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.03)",
                      border: isActive ? "1px solid rgba(99,102,241,0.3)" : "1px solid rgba(255,255,255,0.05)",
                    }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)", maxWidth: "75%" }}>
                      {p.title}
                    </p>
                    <span className="text-xs px-1.5 py-0.5 rounded-md font-bold shrink-0 ml-1"
                          style={{ background: ph.bg, color: ph.color, border: `1px solid ${ph.border}` }}>
                      Ph.{p.phase}
                    </span>
                  </div>
                  <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    {p.pathology}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs" style={{ color: "#334155" }}>{p.criteria_count} critères</span>
                    {p.eudract_number && (
                      <>
                        <span style={{ color: "#1e293b" }}>·</span>
                        <span className="text-xs font-mono" style={{ color: "#334155" }}>{p.eudract_number}</span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* ── Detail panel ─────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-auto">
        {showForm ? (
          <div className="rounded-2xl p-6 fade-up"
               style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                   style={{ background: "rgba(99,102,241,0.15)" }}>
                <svg width="14" height="14" fill="none" stroke="#818cf8" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
                </svg>
              </div>
              <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Nouveau protocole</h3>
            </div>
            <ProtocolForm
              onSubmit={async p => { await createMutation.mutateAsync(p); }}
              isLoading={createMutation.isPending}
            />
          </div>
        ) : selected ? (
          <div className="space-y-4 fade-up">
            {/* Protocol header */}
            <div className="rounded-2xl px-6 py-5"
                 style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {selected.title}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2.5 mt-2">
                    <span className="text-xs px-2.5 py-1 rounded-lg font-semibold"
                          style={PHASE_COLORS[selected.phase] ?? {}}>
                      Phase {selected.phase}
                    </span>
                    <span className="text-sm" style={{ color: "#64748b" }}>{selected.pathology}</span>
                    {selected.eudract_number && (
                      <span className="text-xs font-mono px-2 py-0.5 rounded-md"
                            style={{ background: "rgba(255,255,255,0.04)", color: "#475569" }}>
                        EudraCT {selected.eudract_number}
                      </span>
                    )}
                    {selected.promoter && (
                      <span className="text-xs" style={{ color: "#475569" }}>{selected.promoter}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <span className="text-xs px-2.5 py-1 rounded-full"
                        style={{ background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}>
                    v{selected.version} · Actif
                  </span>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 rounded-xl p-1"
                 style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", width: "fit-content" }}>
              {([
                { id: "overview",   label: "Vue d'ensemble",    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
                { id: "criteria",   label: `Critères (${selected.criteria.length})`, icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
                { id: "visits",     label: `Calendrier (${(selected as any).visits?.length ?? 0})`, icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
                { id: "documents",  label: "Documents",          icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
              ] as const).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setDetailTab(tab.id)}
                  className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg transition-all"
                  style={{
                    background: detailTab === tab.id ? "rgba(99,102,241,0.18)" : "transparent",
                    color: detailTab === tab.id ? "#818cf8" : "var(--text-muted)",
                  }}
                >
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d={tab.icon} strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="rounded-2xl px-6 py-5"
                 style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>

              {detailTab === "overview" && (
                <div className="space-y-4">
                  {/* KPI grid */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Phase", value: `Phase ${selected.phase}` },
                      { label: "Version", value: `v${selected.version}` },
                      { label: "Promoteur", value: selected.promoter ?? "—" },
                      { label: "ARC référent", value: selected.arc_referent ?? "—" },
                      { label: "Critères inclusion", value: `${selected.criteria.filter(c => c.type === "INC").length}` },
                      { label: "Critères exclusion", value: `${selected.criteria.filter(c => c.type === "EXC").length}` },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl p-4"
                           style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
                        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {selected.summary && (
                    <div className="rounded-xl p-4"
                         style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.12)" }}>
                      <p className="text-xs font-medium mb-2" style={{ color: "#0ea5e9" }}>Résumé</p>
                      <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "#bae6fd" }}>{selected.summary}</p>
                    </div>
                  )}

                  {(selected as any).objectives_primary && (
                    <div className="rounded-xl p-4"
                         style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)" }}>
                      <p className="text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: "#818cf8" }}>Objectif principal</p>
                      <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "#c7d2fe" }}>{(selected as any).objectives_primary}</p>
                    </div>
                  )}

                  {(selected as any).objectives_secondary && (
                    <div className="rounded-xl p-4"
                         style={{ background: "rgba(99,102,241,0.03)", border: "1px solid rgba(99,102,241,0.08)" }}>
                      <p className="text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: "#6366f1" }}>Objectifs secondaires</p>
                      <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "#94a3b8" }}>{(selected as any).objectives_secondary}</p>
                    </div>
                  )}

                  {(selected as any).study_schema && (
                    <div className="rounded-xl p-4"
                         style={{ background: "rgba(20,184,166,0.05)", border: "1px solid rgba(20,184,166,0.12)" }}>
                      <p className="text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: "#2dd4bf" }}>Schéma de l'étude</p>
                      <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "#99f6e4" }}>{(selected as any).study_schema}</p>
                    </div>
                  )}

                  {(selected as any).interventions && (
                    <div className="rounded-xl p-4"
                         style={{ background: "rgba(20,184,166,0.03)", border: "1px solid rgba(20,184,166,0.08)" }}>
                      <p className="text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: "#14b8a6" }}>Interventions</p>
                      <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "#94a3b8" }}>{(selected as any).interventions}</p>
                    </div>
                  )}

                  {/* Study drugs */}
                  {((selected as any).study_drugs ?? []).length > 0 && (
                    <div className="rounded-xl p-4"
                         style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <p className="text-xs font-semibold mb-3 uppercase tracking-widest" style={{ color: "#475569" }}>
                        Médicaments étudiés ({(selected as any).study_drugs.length})
                      </p>
                      <div className="space-y-2">
                        {(selected as any).study_drugs.map((d: any, i: number) => (
                          <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2"
                               style={{ background: "rgba(99,102,241,0.07)" }}>
                            <span className="text-xs font-semibold" style={{ color: "#818cf8", minWidth: "120px" }}>{d.name}</span>
                            <span className="text-xs" style={{ color: "#94a3b8" }}>
                              {[d.dose, d.route, d.frequency].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Authorized / Prohibited meds */}
                  {(((selected as any).authorized_meds ?? []).length > 0 || ((selected as any).prohibited_meds ?? []).length > 0) && (
                    <div className="grid grid-cols-2 gap-4">
                      {((selected as any).authorized_meds ?? []).length > 0 && (
                        <div className="rounded-xl p-4"
                             style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.12)" }}>
                          <p className="text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: "#34d399" }}>
                            Médicaments autorisés
                          </p>
                          <ul className="space-y-1.5">
                            {(selected as any).authorized_meds.map((m: string, i: number) => (
                              <li key={i} className="flex items-start gap-2 text-xs">
                                <span style={{ color: "#34d399" }}>✓</span>
                                <span style={{ color: "#94a3b8" }}>{m}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {((selected as any).prohibited_meds ?? []).length > 0 && (
                        <div className="rounded-xl p-4"
                             style={{ background: "rgba(244,63,94,0.04)", border: "1px solid rgba(244,63,94,0.12)" }}>
                          <p className="text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: "#fb7185" }}>
                            Médicaments interdits
                          </p>
                          <ul className="space-y-1.5">
                            {(selected as any).prohibited_meds.map((m: string, i: number) => (
                              <li key={i} className="flex items-start gap-2 text-xs">
                                <span style={{ color: "#fb7185" }}>✗</span>
                                <span style={{ color: "#94a3b8" }}>{m}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-xl p-3 flex items-center gap-2"
                       style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.07)" }}>
                    <svg width="12" height="12" fill="none" stroke="#334155" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round"/>
                    </svg>
                    <p className="text-xs" style={{ color: "#334155" }}>
                      Créé le {new Date(selected.created_at).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                </div>
              )}

              {detailTab === "criteria" && (
                <CriterionList
                  criteria={selected.criteria}
                  canEdit={true}
                  onAdd={async payload => { await addCriterionMutation.mutateAsync({ protocolId: selected.id, payload }); }}
                  onDelete={async cid => { await deleteCriterionMutation.mutateAsync({ protocolId: selected.id, criterionId: cid }); }}
                  onReorder={async (cid, order) => {
                    await protocolsApi.updateCriterion(selected.id, cid, { order });
                    const r = await protocolsApi.get(selected.id);
                    setSelected(r.data);
                  }}
                />
              )}

              {detailTab === "visits" && (
                <VisitsSchedule
                  visits={(selected as any).visits ?? []}
                  canEdit={true}
                  onChange={visits => {
                    setSelected(prev => prev ? { ...prev, visits } as any : prev);
                    protocolsApi.update?.(selected.id, { visits });
                  }}
                />
              )}

              {detailTab === "documents" && (
                <DocumentManager protocolId={selected.id} />
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                 style={{ background: "rgba(255,255,255,0.04)" }}>
              <svg width="22" height="22" fill="none" stroke="#334155" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-sm" style={{ color: "#334155" }}>Sélectionnez un protocole</p>
            <p className="text-xs" style={{ color: "#1e293b" }}>ou créez un nouveau protocole →</p>
          </div>
        )}
      </main>
    </div>
  );
}
