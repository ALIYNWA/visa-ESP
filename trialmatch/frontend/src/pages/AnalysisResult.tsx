import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { analysesApi } from "@/api/analyses";
import { patientsApi } from "@/api/patients";
import { protocolsApi } from "@/api/protocols";
import { RCPSheet } from "@/components/RCPSheet";
import type { OverrideStatus, Verdict } from "@/types";

interface Props { canValidate: boolean; canOverride: boolean; analystName?: string; }

function NewAnalysisModal({ onClose, onCreate }: { onClose: () => void; onCreate: (protocolId: string, patientId: string) => Promise<void> }) {
  const { data: protocols = [] } = useQuery({ queryKey: ["protocols"], queryFn: () => protocolsApi.list().then(r => r.data) });
  const { data: patients = [] }  = useQuery({ queryKey: ["patients"],  queryFn: () => patientsApi.list().then(r => r.data) });
  const [protocolId, setProtocolId] = useState("");
  const [patientId,  setPatientId]  = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!protocolId || !patientId) { setError("Sélectionnez un protocole et un patient."); return; }
    setLoading(true);
    try { await onCreate(protocolId, patientId); onClose(); }
    catch (err: any) { setError(err?.message ?? "Erreur lors de la création."); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="rounded-2xl p-6 w-full max-w-md shadow-2xl fade-up"
           style={{ background: "#0a1628", border: "1px solid rgba(99,102,241,0.3)" }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(99,102,241,0.15)" }}>
            <svg width="14" height="14" fill="none" stroke="#818cf8" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Nouvelle analyse d'éligibilité</h3>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>L'analyse sera effectuée par Meditron 70B en local</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Protocole</label>
            <select value={protocolId} onChange={e => setProtocolId(e.target.value)}
                    className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" data-testid="new-analysis-protocol">
              <option value="">— Sélectionner un protocole —</option>
              {protocols.map(p => <option key={p.id} value={p.id}>{p.title} (Ph.{p.phase})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Patient</label>
            <select value={patientId} onChange={e => setPatientId(e.target.value)}
                    className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" data-testid="new-analysis-patient">
              <option value="">— Sélectionner un patient —</option>
              {patients.map(p => <option key={p.id} value={p.id}>{p.pseudonym}</option>)}
            </select>
          </div>
          {error && (
            <div className="rounded-xl px-4 py-2.5 text-xs" style={{ background: "rgba(244,63,94,0.1)", color: "#fb7185", border: "1px solid rgba(244,63,94,0.2)" }}>
              {error}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={loading} className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-semibold text-white"
                    data-testid="new-analysis-submit">
              {loading ? "Analyse en cours…" : "Lancer l'analyse"}
            </button>
            <button type="button" onClick={onClose}
                    className="px-4 rounded-xl py-2.5 text-sm font-medium transition-colors"
                    style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const VERDICT_STYLE: Record<Verdict, { color: string; bg: string; border: string }> = {
  eligible:     { color: "#34d399", bg: "rgba(16,185,129,0.12)",  border: "rgba(16,185,129,0.2)" },
  non_eligible: { color: "#fb7185", bg: "rgba(244,63,94,0.12)",   border: "rgba(244,63,94,0.2)" },
  incomplet:    { color: "#fbbf24", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.2)" },
};

const VERDICT_LABEL: Record<Verdict, string> = {
  eligible:     "Éligible",
  non_eligible: "Non éligible",
  incomplet:    "Incomplet",
};

export function AnalysisResult({ canValidate, canOverride, analystName = "Utilisateur" }: Props) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const createMutation = useMutation({
    mutationFn: ({ protocol_id, patient_id }: { protocol_id: string; patient_id: string }) =>
      analysesApi.create({ protocol_id, patient_id }),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ["analyses"] });
      setSelectedId(res.data.id);
    },
  });

  const { data: analyses = [], isLoading } = useQuery({
    queryKey: ["analyses"],
    queryFn: () => analysesApi.list().then(r => r.data),
  });

  const { data: analysis, isLoading: analysisLoading } = useQuery({
    queryKey: ["analysis", selectedId],
    queryFn: () => analysesApi.get(selectedId!).then(r => r.data),
    enabled: !!selectedId,
  });

  // Fetch protocol/patient names for the report
  const { data: protocol } = useQuery({
    queryKey: ["protocol", analysis?.protocol_id],
    queryFn: () => protocolsApi.get(analysis!.protocol_id).then(r => r.data),
    enabled: !!analysis?.protocol_id,
  });
  const { data: patient } = useQuery({
    queryKey: ["patient", analysis?.patient_id],
    queryFn: () => patientsApi.get(analysis!.patient_id).then(r => r.data),
    enabled: !!analysis?.patient_id,
  });

  const validateMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => analysesApi.validate(id, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analysis", selectedId] }),
  });

  const overrideMutation = useMutation({
    mutationFn: ({ analysisId, crId, status, note }: { analysisId: string; crId: string; status: OverrideStatus; note: string }) =>
      analysesApi.overrideCriterion(analysisId, crId, { override_status: status, override_note: note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analysis", selectedId] }),
  });

  return (
    <div className="flex h-full gap-6">
      {showNewModal && (
        <NewAnalysisModal
          onClose={() => setShowNewModal(false)}
          onCreate={async (protocolId, patientId) => {
            await createMutation.mutateAsync({ protocol_id: protocolId, patient_id: patientId });
          }}
        />
      )}

      {/* Sidebar */}
      <aside className="w-80 shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Analyses récentes ({analyses.length})
          </p>
          <button
            onClick={() => setShowNewModal(true)}
            className="btn-primary text-xs px-3 py-1.5 rounded-lg text-white font-medium flex items-center gap-1"
            data-testid="new-analysis-btn"
          >
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
            </svg>
            Nouvelle
          </button>
        </div>
        <div className="flex-1 overflow-auto space-y-2 pr-1">
          {isLoading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
            ))
          ) : analyses.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm" style={{ color: "#334155" }}>Aucune analyse</p>
            </div>
          ) : analyses.map(a => {
            const vs = VERDICT_STYLE[a.verdict as Verdict] || VERDICT_STYLE.incomplet;
            const alerts = (a.missing_data_points?.length ?? 0) + (a.points_attention?.length ?? 0);
            return (
              <div key={a.id}
                   onClick={() => setSelectedId(a.id)}
                   className="cursor-pointer rounded-xl px-4 py-3.5 transition-all"
                   style={{
                     background: selectedId === a.id ? "rgba(99,102,241,0.1)" : "rgba(255,255,255,0.03)",
                     border: selectedId === a.id ? "1px solid rgba(99,102,241,0.28)" : "1px solid rgba(255,255,255,0.06)",
                   }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                        style={{ background: vs.bg, color: vs.color, border: `1px solid ${vs.border}` }}>
                    {VERDICT_LABEL[a.verdict as Verdict] ?? a.verdict}
                  </span>
                  <span className="text-sm font-bold" style={{ color: vs.color }}>{a.score_pct}%</span>
                </div>
                <div className="h-1 w-full rounded-full mb-2" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-1 rounded-full transition-all" style={{ width: `${a.score_pct}%`, background: vs.color, boxShadow: `0 0 6px ${vs.color}40` }} />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {new Date(a.created_at).toLocaleDateString("fr-FR")}
                  </p>
                  <div className="flex items-center gap-2">
                    {alerts > 0 && (
                      <span className="text-xs flex items-center gap-1"
                            style={{ color: "#f59e0b" }}>
                        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round"/>
                        </svg>
                        {alerts}
                      </span>
                    )}
                    {a.validated_at && (
                      <span className="text-xs flex items-center gap-0.5" style={{ color: "#34d399" }}>
                        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path d="M20 6L9 17l-5-5" strokeLinecap="round"/>
                        </svg>
                        Validée
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-auto">
        {analysisLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
            ))}
          </div>
        ) : analysis ? (
          <RCPSheet
            analysis={analysis}
            canValidate={canValidate}
            canOverride={canOverride}
            analystName={analystName}
            protocolTitle={protocol?.title ?? `Protocole ${analysis.protocol_id.slice(0, 8)}`}
            patientPseudonym={patient?.pseudonym ?? `Patient ${analysis.patient_id.slice(0, 8)}`}
            onValidate={async note => { await validateMutation.mutateAsync({ id: analysis.id, note }); }}
            onOverride={async (crId, status, note) => {
              await overrideMutation.mutateAsync({ analysisId: analysis.id, crId, status, note });
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                 style={{ background: "rgba(255,255,255,0.04)" }}>
              <svg width="22" height="22" fill="none" stroke="#334155" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-sm" style={{ color: "#334155" }}>Sélectionnez une analyse</p>
          </div>
        )}
      </main>
    </div>
  );
}
