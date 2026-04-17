import { useState } from "react";
import type { Analysis, OverrideStatus } from "@/types";
import { EligibilityScore } from "./EligibilityScore";
import { AnalysisReport } from "./AnalysisReport";

interface Props {
  analysis: Analysis;
  canValidate: boolean;
  canOverride: boolean;
  analystName?: string;
  protocolTitle?: string;
  patientPseudonym?: string;
  onValidate: (note?: string) => Promise<void>;
  onOverride: (criterionResultId: string, status: OverrideStatus, note: string) => Promise<void>;
}

const STATUS_STYLE: Record<string, {
  color: string; bg: string; border: string; dot: string; icon: string;
  rowBg: string; rowBorder: string; checkBg: string;
}> = {
  satisfait:     { color: "#34d399", bg: "rgba(16,185,129,0.1)",   border: "rgba(16,185,129,0.2)",   dot: "#34d399", icon: "✓",
                   rowBg: "rgba(16,185,129,0.04)", rowBorder: "rgba(16,185,129,0.25)", checkBg: "rgba(16,185,129,0.18)" },
  non_satisfait: { color: "#fb7185", bg: "rgba(244,63,94,0.1)",    border: "rgba(244,63,94,0.2)",    dot: "#fb7185", icon: "✗",
                   rowBg: "rgba(244,63,94,0.05)",  rowBorder: "rgba(244,63,94,0.3)",   checkBg: "rgba(244,63,94,0.18)"  },
  inconnu:       { color: "#fbbf24", bg: "rgba(245,158,11,0.1)",   border: "rgba(245,158,11,0.15)",  dot: "#f59e0b", icon: "?",
                   rowBg: "rgba(245,158,11,0.04)", rowBorder: "rgba(245,158,11,0.2)",  checkBg: "rgba(245,158,11,0.18)" },
};

export function RCPSheet({
  analysis, canValidate, canOverride,
  analystName = "Utilisateur démo",
  protocolTitle = "Protocole",
  patientPseudonym = "Patient",
  onValidate, onOverride,
}: Props) {
  const [validating, setValidating]       = useState(false);
  const [signatureNote, setSignatureNote] = useState("");
  const [overrideTarget, setOverrideTarget] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<OverrideStatus>("satisfait");
  const [overrideNote, setOverrideNote]   = useState("");
  const [showReport, setShowReport]       = useState(false);
  const [activeTab, setActiveTab]         = useState<"all" | "inc" | "exc">("all");
  const isValidated = !!analysis.validated_at;

  const missing   = analysis.missing_data_points ?? [];
  const attention = analysis.points_attention ?? [];
  const totalAlerts = missing.length + attention.filter(a => !missing.some(m => a.includes(m.missing_field))).length;

  async function handleValidate() {
    setValidating(true);
    try { await onValidate(signatureNote); } finally { setValidating(false); }
  }

  async function handleOverrideSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!overrideTarget || !overrideNote.trim()) return;
    await onOverride(overrideTarget, overrideStatus, overrideNote);
    setOverrideTarget(null);
    setOverrideNote("");
  }

  const filteredResults = analysis.criterion_results.filter(cr =>
    activeTab === "all" || cr.criterion_type === activeTab.toUpperCase()
  );

  return (
    <div className="space-y-5 fade-up" data-testid="rcp-sheet">

      {/* Score card */}
      <EligibilityScore score={analysis.score_pct} verdict={analysis.verdict} latencyMs={analysis.latency_ms} />

      {/* Summary + Alerts row */}
      <div className="grid gap-4" style={{ gridTemplateColumns: analysis.resume ? "1fr 1fr" : "1fr" }}>
        {analysis.resume && (
          <div className="rounded-2xl p-5"
               style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.15)" }}>
            <div className="flex items-center gap-2 mb-2">
              <svg width="13" height="13" fill="none" stroke="#38bdf8" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01" strokeLinecap="round"/>
              </svg>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#0ea5e9" }}>
                Résumé Meditron 70B
              </p>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "#bae6fd" }} data-testid="analysis-resume">
              {analysis.resume}
            </p>
          </div>
        )}

        {/* Attention points */}
        {totalAlerts > 0 && (
          <div className="rounded-2xl p-5"
               style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg width="13" height="13" fill="none" stroke="#f59e0b" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 9v4M12 17h.01" strokeLinecap="round"/>
                </svg>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#f59e0b" }}>
                  Points de vigilance
                </p>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(245,158,11,0.2)", color: "#fbbf24" }}>
                {totalAlerts}
              </span>
            </div>

            {/* Missing data — structured */}
            {missing.length > 0 && (
              <div className="space-y-2 mb-3">
                <p className="text-xs font-medium" style={{ color: "#d97706" }}>Données manquantes :</p>
                {missing.map((m, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-xl px-3 py-2"
                       style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.15)" }}>
                    <svg width="11" height="11" fill="none" stroke="#f59e0b" strokeWidth="2.5" viewBox="0 0 24 24" className="mt-0.5 shrink-0">
                      <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01" strokeLinecap="round"/>
                    </svg>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: "#fbbf24" }}>{m.missing_field}</p>
                      <p className="text-xs mt-0.5" style={{ color: "#d97706" }}>{m.suggestion}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Other attention points */}
            {attention.filter(a => !missing.some(m => a.includes(m.missing_field))).map((pt, i) => (
              <div key={i} className="flex items-start gap-2 mb-1.5">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#f59e0b" }} />
                <p className="text-xs leading-relaxed" style={{ color: "#fbbf24" }}>{pt}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Criteria table */}
      <div className="rounded-2xl overflow-hidden"
           style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {/* Table header + tabs */}
        <div className="flex items-center justify-between px-5 py-3.5"
             style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Résultats — {analysis.criterion_results.length} critères
          </p>
          <div className="flex items-center gap-1">
            {(["all", "inc", "exc"] as const).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className="text-xs px-2.5 py-1 rounded-lg font-medium transition-colors"
                style={{
                  background: activeTab === t ? "rgba(99,102,241,0.2)" : "transparent",
                  color: activeTab === t ? "#818cf8" : "var(--text-muted)",
                }}
              >
                {t === "all" ? "Tous" : t === "inc" ? "Inclusion" : "Exclusion"}
              </button>
            ))}
          </div>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4 px-5 py-2.5"
             style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)" }}>
          {[
            { status: "satisfait",     label: "Vérifié" },
            { status: "non_satisfait", label: "Non satisfait" },
            { status: "inconnu",       label: "Données manquantes" },
          ].map(({ status, label }) => {
            const s = STATUS_STYLE[status];
            return (
              <div key={status} className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold"
                     style={{ background: s.checkBg, color: s.color, border: `1px solid ${s.border}` }}>
                  {s.icon}
                </div>
                <span className="text-xs" style={{ color: "#475569" }}>{label}</span>
              </div>
            );
          })}
          <div className="ml-auto flex items-center gap-3 text-xs" style={{ color: "#334155" }}>
            <span style={{ color: "#34d399" }}>
              ✓ {filteredResults.filter(r => (r.override_status ?? r.status) === "satisfait").length} vérifiés
            </span>
            <span style={{ color: "#fb7185" }}>
              ✗ {filteredResults.filter(r => (r.override_status ?? r.status) === "non_satisfait").length} exclus
            </span>
            <span style={{ color: "#fbbf24" }}>
              ? {filteredResults.filter(r => !r.override_status && r.status === "inconnu").length} inconnus
            </span>
          </div>
        </div>

        <table className="w-full" data-testid="criteria-table">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {[
                { label: "",        width: "52px"  },
                { label: "Statut",  width: "110px" },
                { label: "Type",    width: "70px"  },
                { label: "Critère", width: "auto"  },
                { label: "Raisonnement / Vigilance", width: "auto" },
                { label: "",        width: "80px"  },
              ].map((h, i) => (
                <th key={i} className="px-4 py-3 text-left text-xs font-medium"
                    style={{ color: "var(--text-muted)", width: h.width }}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredResults.map((cr, i) => {
              const effectiveStatus = cr.override_status ?? cr.status;
              const s = STATUS_STYLE[effectiveStatus] || STATUS_STYLE.inconnu;
              const isMissing = missing.some(m => m.criterion_id === cr.criterion_id);
              return (
                <tr key={cr.id}
                    className="transition-all"
                    style={{
                      borderBottom: i < filteredResults.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      background: s.rowBg,
                      borderLeft: `3px solid ${s.rowBorder}`,
                    }}
                    data-testid={`criterion-row-${cr.id}`}>

                  {/* Index */}
                  <td className="px-4 py-4">
                    <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </td>

                  {/* Status checkbox */}
                  <td className="px-3 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-base font-bold shrink-0"
                           style={{ background: s.checkBg, color: s.color, border: `1.5px solid ${s.border}`, lineHeight: 1 }}>
                        {s.icon}
                      </div>
                      <div>
                        <span className="text-xs font-semibold" style={{ color: s.color }}>
                          {effectiveStatus === "satisfait"     ? "Vérifié"
                         : effectiveStatus === "non_satisfait" ? "Exclu"
                         :                                       "Inconnu"}
                        </span>
                        {cr.override_status && (
                          <span className="block text-xs" style={{ color: "#475569", fontSize: "10px" }}>
                            (modifié)
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Type */}
                  <td className="px-3 py-4">
                    <span className="text-xs font-semibold px-2 py-1 rounded-md"
                          style={cr.criterion_type === "INC"
                            ? { background: "rgba(99,102,241,0.15)", color: "#818cf8" }
                            : { background: "rgba(251,146,60,0.15)", color: "#fb923c" }}>
                      {cr.criterion_type === "INC" ? "Inclusion" : "Exclusion"}
                    </span>
                  </td>

                  {/* Criterion text */}
                  <td className="px-4 py-4 text-sm" style={{ color: "#cbd5e1", maxWidth: "280px" }}>
                    <span className="leading-relaxed">{cr.criterion_text}</span>
                    {isMissing && (
                      <span className="inline-flex items-center gap-1 ml-2 text-xs px-1.5 py-0.5 rounded-md"
                            style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                        ⚠ données manquantes
                      </span>
                    )}
                  </td>

                  {/* Reasoning */}
                  <td className="px-4 py-4" style={{ maxWidth: "260px" }}>
                    <p className="text-xs leading-relaxed" style={{ color: isMissing ? "#d97706" : "#64748b" }}>
                      {cr.reasoning}
                    </p>
                  </td>

                  {/* Override */}
                  <td className="px-4 py-4">
                    {canOverride && !isValidated && (
                      <button
                        onClick={() => setOverrideTarget(cr.id)}
                        className="text-xs px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap"
                        style={{ color: "#6366f1", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
                        data-testid={`override-btn-${cr.id}`}
                      >
                        Modifier
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-3">
        {/* Generate report button */}
        <button
          onClick={() => setShowReport(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{ background: "rgba(13,148,136,0.12)", color: "#14b8a6", border: "1px solid rgba(13,148,136,0.25)" }}
          data-testid="generate-report-btn"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round"/>
          </svg>
          Générer fiche technique
        </button>

        {/* Meta */}
        <div className="flex-1 flex items-center gap-3 text-xs" style={{ color: "#334155" }}>
          <span className="font-mono">{analysis.id.slice(0, 8)}…</span>
          <span>·</span>
          <span className="font-mono">{analysis.prompt_hash.slice(0, 12)}…</span>
          <span>·</span>
          <span>{analysis.model_name}</span>
        </div>
      </div>

      {/* Validation */}
      {isValidated ? (
        <div className="rounded-2xl px-5 py-4 flex items-center gap-3"
             style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}
             data-testid="validated-banner">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
               style={{ background: "rgba(16,185,129,0.15)" }}>
            <svg width="14" height="14" fill="none" stroke="#34d399" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: "#34d399" }}>Fiche RCP validée et signée</p>
            <p className="text-xs" style={{ color: "#065f46" }}>
              {new Date(analysis.validated_at!).toLocaleString("fr-FR")}
            </p>
          </div>
        </div>
      ) : canValidate && (
        <div className="rounded-2xl p-5 space-y-3"
             style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Validation investigateur
          </p>
          <textarea
            value={signatureNote}
            onChange={e => setSignatureNote(e.target.value)}
            placeholder="Note de validation (optionnel)…"
            rows={2}
            className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
            data-testid="signature-note"
          />
          <button
            onClick={handleValidate}
            disabled={validating}
            className="w-full rounded-xl py-2.5 text-sm font-semibold text-white transition-all"
            style={{ background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 0 20px rgba(16,185,129,0.2)" }}
            data-testid="validate-btn"
          >
            {validating ? "Validation en cours…" : "Signer et valider la fiche RCP"}
          </button>
        </div>
      )}

      {/* Override modal */}
      {overrideTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
             style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-2xl p-6 w-full max-w-md shadow-2xl fade-up"
               style={{ background: "#0f2040", border: "1px solid rgba(99,102,241,0.3)" }}>
            <h3 className="text-base font-semibold mb-1" style={{ color: "#f1f5f9" }}>
              Modifier le statut du critère
            </h3>
            <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
              La modification sera tracée dans l'audit log avec votre identifiant et la justification.
            </p>
            <form onSubmit={handleOverrideSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  Nouveau statut
                </label>
                <select value={overrideStatus}
                        onChange={e => setOverrideStatus(e.target.value as OverrideStatus)}
                        className="input-dark w-full rounded-xl px-4 py-2.5 text-sm"
                        data-testid="override-status-select">
                  <option value="satisfait">✓ Satisfait</option>
                  <option value="non_satisfait">✗ Non satisfait</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  Justification médicale *
                </label>
                <textarea value={overrideNote}
                          onChange={e => setOverrideNote(e.target.value)}
                          rows={3} required
                          className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
                          placeholder="Expliquer la raison clinique de cette modification…"
                          data-testid="override-note" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit" className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-semibold text-white"
                        data-testid="override-confirm">
                  Confirmer la modification
                </button>
                <button type="button" onClick={() => { setOverrideTarget(null); setOverrideNote(""); }}
                        className="flex-1 rounded-xl py-2.5 text-sm font-medium transition-colors"
                        style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Report modal */}
      {showReport && (
        <AnalysisReport
          analysis={analysis}
          protocolTitle={protocolTitle}
          patientPseudonym={patientPseudonym}
          analystName={analystName}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
