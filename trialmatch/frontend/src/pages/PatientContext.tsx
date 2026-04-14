import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { patientsApi } from "@/api/patients";
import { PatientForm } from "@/components/PatientForm";
import type { PatientContext as PatientCtx } from "@/types";

function ConfirmDeleteModal({ pseudonym, onConfirm, onCancel }: {
  pseudonym: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
         style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="rounded-2xl p-6 w-full max-w-sm shadow-2xl fade-up"
           style={{ background: "#0a1628", border: "1px solid rgba(244,63,94,0.3)" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
               style={{ background: "rgba(244,63,94,0.15)" }}>
            <svg width="16" height="16" fill="none" stroke="#fb7185" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold" style={{ color: "#f1f5f9" }}>Supprimer le patient</h3>
            <p className="text-xs" style={{ color: "#64748b" }}>Cette action est irréversible</p>
          </div>
        </div>
        <p className="text-sm mb-5" style={{ color: "#94a3b8" }}>
          Voulez-vous vraiment supprimer le patient <span className="font-mono font-semibold" style={{ color: "#fb7185" }}>{pseudonym}</span> ?
          Toutes ses analyses seront également supprimées.
        </p>
        <div className="flex gap-3">
          <button onClick={onConfirm}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-all"
                  style={{ background: "linear-gradient(135deg, #f43f5e, #e11d48)", boxShadow: "0 0 20px rgba(244,63,94,0.3)" }}>
            Supprimer
          </button>
          <button onClick={onCancel}
                  className="px-5 rounded-xl py-2.5 text-sm font-medium transition-colors"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

export function PatientContextPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"view" | "create" | "edit">("view");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ["patients"],
    queryFn: () => patientsApi.list().then(r => r.data),
  });

  const { data: selected } = useQuery({
    queryKey: ["patient", selectedId],
    queryFn: () => patientsApi.get(selectedId!).then(r => r.data),
    enabled: !!selectedId,
  });

  const createMutation = useMutation({
    mutationFn: (p: { pseudonym: string; context: PatientCtx }) => patientsApi.create(p),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      setSelectedId(res.data.id);
      setMode("view");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (p: { pseudonym: string; context: PatientCtx }) =>
      patientsApi.update(selectedId!, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.invalidateQueries({ queryKey: ["patient", selectedId] });
      setMode("view");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => patientsApi.delete(selectedId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      qc.invalidateQueries({ queryKey: ["analyses"] });
      setSelectedId(null);
      setMode("view");
      setShowDeleteModal(false);
    },
  });

  const ctx = selected?.context;

  const fields = [
    { label: "Âge",             value: ctx?.age != null ? `${ctx.age} ans` : null },
    { label: "Sexe",            value: ctx?.sexe ?? null },
    { label: "Diagnostic",      value: ctx?.diagnostic_principal ?? null },
    { label: "Stade",           value: ctx?.stade ?? null },
    { label: "ECOG PS",         value: ctx?.ecog_performance_status != null ? String(ctx.ecog_performance_status) : null },
  ];

  return (
    <div className="flex h-full gap-6">
      {showDeleteModal && selected && (
        <ConfirmDeleteModal
          pseudonym={selected.pseudonym}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}

      {/* Sidebar */}
      <aside className="w-72 shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Patients ({patients.length})
          </p>
          <button
            onClick={() => { setMode("create"); setSelectedId(null); }}
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
              <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
            ))}
          </div>
        ) : patients.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm" style={{ color: "#334155" }}>Aucun patient</p>
          </div>
        ) : (
          <ul className="space-y-2 flex-1 overflow-auto">
            {patients.map(p => (
              <li key={p.id}
                  onClick={() => { setSelectedId(p.id); setMode("view"); }}
                  className="cursor-pointer rounded-xl px-4 py-3 transition-all"
                  style={{
                    background: selectedId === p.id ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                    border: selectedId === p.id ? "1px solid rgba(99,102,241,0.35)" : "1px solid rgba(255,255,255,0.06)",
                  }}>
                <p className="text-sm font-medium font-mono" style={{ color: "#f1f5f9" }}>{p.pseudonym}</p>
                <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
                  Créé le {new Date(p.created_at).toLocaleDateString("fr-FR")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-auto">
        {mode === "create" ? (
          <div className="rounded-2xl p-6 fade-up"
               style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                   style={{ background: "rgba(99,102,241,0.15)" }}>
                <svg width="14" height="14" fill="none" stroke="#818cf8" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
                </svg>
              </div>
              <h3 className="text-base font-semibold" style={{ color: "#f1f5f9" }}>Nouveau patient</h3>
            </div>
            <PatientForm
              onSubmit={async d => { await createMutation.mutateAsync(d); }}
              isLoading={createMutation.isPending}
            />
          </div>
        ) : mode === "edit" && selected ? (
          <div className="rounded-2xl p-6 fade-up"
               style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                     style={{ background: "rgba(14,165,233,0.15)" }}>
                  <svg width="14" height="14" fill="none" stroke="#38bdf8" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <h3 className="text-base font-semibold" style={{ color: "#f1f5f9" }}>Modifier — <span className="font-mono">{selected.pseudonym}</span></h3>
              </div>
              <button onClick={() => setMode("view")}
                      className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                      style={{ background: "rgba(255,255,255,0.05)", color: "#64748b", border: "1px solid rgba(255,255,255,0.08)" }}>
                Annuler
              </button>
            </div>
            <PatientForm
              initialValues={{ pseudonym: selected.pseudonym, context: selected.context }}
              submitLabel="Enregistrer les modifications"
              onSubmit={async d => { await updateMutation.mutateAsync(d); }}
              isLoading={updateMutation.isPending}
            />
          </div>
        ) : selected ? (
          <div className="space-y-4 fade-up">
            {/* Header */}
            <div className="rounded-2xl px-6 py-5"
                 style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-base font-bold shrink-0"
                       style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff" }}>
                    {selected.pseudonym[0]}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold font-mono" style={{ color: "#f1f5f9" }}>{selected.pseudonym}</h3>
                    <p className="text-xs" style={{ color: "#475569" }}>
                      Créé le {new Date(selected.created_at).toLocaleString("fr-FR")}
                    </p>
                  </div>
                </div>
                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMode("edit")}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
                    style={{ background: "rgba(14,165,233,0.12)", color: "#38bdf8", border: "1px solid rgba(14,165,233,0.25)" }}
                  >
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Modifier
                  </button>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
                    style={{ background: "rgba(244,63,94,0.1)", color: "#fb7185", border: "1px solid rgba(244,63,94,0.2)" }}
                  >
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Supprimer
                  </button>
                </div>
              </div>
            </div>

            {/* Clinical data */}
            {ctx && (
              <div className="rounded-2xl p-6"
                   style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "var(--text-muted)" }}>
                  Contexte clinique
                </p>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-4 mb-4">
                  {fields.map(({ label, value }) => {
                    if (!value) return null;
                    return (
                      <div key={label}>
                        <dt className="text-xs font-medium mb-0.5" style={{ color: "#475569" }}>{label}</dt>
                        <dd className="text-sm font-medium" style={{ color: "#cbd5e1" }}>{value}</dd>
                      </div>
                    );
                  })}
                </dl>

                {ctx.traitements_en_cours && ctx.traitements_en_cours.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-medium mb-2" style={{ color: "#475569" }}>Traitements en cours</p>
                    <div className="flex flex-wrap gap-2">
                      {ctx.traitements_en_cours.map((t, i) => (
                        <span key={i} className="text-xs px-2.5 py-1 rounded-full"
                              style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {ctx.antecedents && ctx.antecedents.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-medium mb-2" style={{ color: "#475569" }}>Antécédents</p>
                    <div className="flex flex-wrap gap-2">
                      {ctx.antecedents.map((a, i) => (
                        <span key={i} className="text-xs px-2.5 py-1 rounded-full"
                              style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {ctx.biologie && Object.keys(ctx.biologie).length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-medium mb-2" style={{ color: "#475569" }}>Biologie</p>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(ctx.biologie).map(([k, v]) => (
                        <div key={k} className="rounded-lg px-3 py-2"
                             style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.12)" }}>
                          <p className="text-xs" style={{ color: "#0ea5e9" }}>{k}</p>
                          <p className="text-sm font-semibold" style={{ color: "#bae6fd" }}>{String(v)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ctx.notes_libres && (
                  <div>
                    <p className="text-xs font-medium mb-2" style={{ color: "#475569" }}>Notes cliniques libres</p>
                    <p className="text-sm leading-relaxed rounded-xl p-4"
                       style={{ background: "rgba(255,255,255,0.02)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.05)", whiteSpace: "pre-wrap" }}>
                      {ctx.notes_libres}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                 style={{ background: "rgba(255,255,255,0.04)" }}>
              <svg width="22" height="22" fill="none" stroke="#334155" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-sm" style={{ color: "#334155" }}>Sélectionnez un patient</p>
            <p className="text-xs" style={{ color: "#1e293b" }}>ou créez un nouveau patient →</p>
          </div>
        )}
      </main>
    </div>
  );
}
