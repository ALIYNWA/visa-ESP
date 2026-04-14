/**
 * AnalysisReport — printable technical eligibility sheet.
 * Uses window.print() with dedicated print CSS — no external PDF library needed.
 * Privacy: Only the patient pseudonym is shown, never real identifying data.
 */
import type { Analysis } from "@/types";

interface Props {
  analysis: Analysis;
  protocolTitle: string;
  patientPseudonym: string;
  analystName: string;
  onClose: () => void;
}

const STATUS_ICONS: Record<string, string> = {
  satisfait:     "✓",
  non_satisfait: "✗",
  inconnu:       "?",
};
const STATUS_COLORS: Record<string, string> = {
  satisfait:     "#059669",
  non_satisfait: "#dc2626",
  inconnu:       "#d97706",
};

export function AnalysisReport({ analysis, protocolTitle, patientPseudonym, analystName, onClose }: Props) {
  const date = new Date(analysis.created_at).toLocaleString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const inclusion = analysis.criterion_results.filter(r => r.criterion_type === "INC");
  const exclusion = analysis.criterion_results.filter(r => r.criterion_type === "EXC");
  const missing   = analysis.missing_data_points ?? [];
  const attention = analysis.points_attention ?? [];

  const verdictLabel: Record<string, string> = {
    eligible:     "ÉLIGIBLE",
    non_eligible: "NON ÉLIGIBLE",
    incomplet:    "INCOMPLET — DONNÉES MANQUANTES",
  };
  const verdictColor: Record<string, string> = {
    eligible:     "#059669",
    non_eligible: "#dc2626",
    incomplet:    "#d97706",
  };

  return (
    <>
      {/* ── Print-specific styles (injected inline) ─────────────────────────── */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #analysis-report-print, #analysis-report-print * { visibility: visible !important; }
          #analysis-report-print {
            position: fixed; top: 0; left: 0; width: 100%; background: white !important;
            color: #000 !important; padding: 20mm 15mm !important; font-family: Arial, sans-serif !important;
          }
          .no-print { display: none !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
          h3 { page-break-after: avoid; }
          .page-break { page-break-before: always; }
        }
      `}</style>

      {/* ── Modal overlay ────────────────────────────────────────────────────── */}
      <div className="fixed inset-0 z-50 overflow-auto"
           style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}>

        {/* Toolbar */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 no-print"
             style={{ background: "#0a1628", borderBottom: "1px solid rgba(99,102,241,0.2)" }}>
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                 style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}>
              <svg width="14" height="14" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>Fiche technique d'éligibilité</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all"
              style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)", boxShadow: "0 0 16px rgba(13,148,136,0.3)" }}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Imprimer / Exporter PDF
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              Fermer
            </button>
          </div>
        </div>

        {/* ── Report content ──────────────────────────────────────────────────── */}
        <div className="flex justify-center py-8 px-4 no-print-wrapper">
          <div
            id="analysis-report-print"
            style={{
              background: "white",
              color: "#111827",
              width: "210mm",
              minHeight: "297mm",
              padding: "16mm",
              borderRadius: "4px",
              fontFamily: "Arial, 'Helvetica Neue', sans-serif",
              fontSize: "10pt",
              lineHeight: "1.5",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            {/* Header */}
            <div style={{ borderBottom: "2px solid #1e40af", paddingBottom: "8mm", marginBottom: "6mm" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: "16pt", fontWeight: 700, color: "#1e3a5f", letterSpacing: "-0.5px" }}>
                    FICHE D'ÉLIGIBILITÉ — ESSAI CLINIQUE
                  </div>
                  <div style={{ fontSize: "8pt", color: "#6b7280", marginTop: "2px" }}>
                    TrialMatch — Système d'aide à l'éligibilité on-premise · Confidentiel — Usage médical uniquement
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{
                    fontSize: "14pt", fontWeight: 700,
                    color: verdictColor[analysis.verdict] ?? "#374151",
                    border: `2px solid ${verdictColor[analysis.verdict] ?? "#374151"}`,
                    borderRadius: "6px", padding: "4px 12px",
                  }}>
                    {verdictLabel[analysis.verdict] ?? analysis.verdict.toUpperCase()}
                  </div>
                  <div style={{ fontSize: "18pt", fontWeight: 800, color: verdictColor[analysis.verdict], marginTop: "4px" }}>
                    {analysis.score_pct} %
                  </div>
                </div>
              </div>
            </div>

            {/* Info grid */}
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6mm" }}>
              <tbody>
                {[
                  ["Protocole", protocolTitle],
                  ["Patient (pseudonyme)", patientPseudonym],
                  ["Date d'analyse", date],
                  ["Analyste", analystName],
                  ["Modèle IA", `${analysis.model_name} (local, on-premise)`],
                  ["Hash prompt", analysis.prompt_hash.slice(0, 24) + "…"],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ padding: "3px 8px 3px 0", color: "#6b7280", fontWeight: 600, fontSize: "9pt", width: "30%", whiteSpace: "nowrap" }}>
                      {label}
                    </td>
                    <td style={{ padding: "3px 0", color: "#111827", fontSize: "9pt" }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Summary */}
            {analysis.resume && (
              <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "6px", padding: "8px 12px", marginBottom: "6mm" }}>
                <div style={{ fontSize: "8pt", fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
                  Résumé de l'analyse
                </div>
                <div style={{ fontSize: "9pt", color: "#1e3a5f" }}>{analysis.resume}</div>
              </div>
            )}

            {/* Missing data / Attention */}
            {(missing.length > 0 || attention.length > 0) && (
              <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "6px", padding: "8px 12px", marginBottom: "6mm" }}>
                <div style={{ fontSize: "8pt", fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
                  ⚠ Points de vigilance — Données manquantes
                </div>
                {missing.map((m, i) => (
                  <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
                    <span style={{ color: "#d97706", fontWeight: 700, fontSize: "9pt", minWidth: "14px" }}>!</span>
                    <div>
                      <span style={{ fontSize: "9pt", fontWeight: 600, color: "#92400e" }}>{m.missing_field} : </span>
                      <span style={{ fontSize: "9pt", color: "#78350f" }}>{m.suggestion}</span>
                    </div>
                  </div>
                ))}
                {attention.filter(a => !missing.some(m => a.includes(m.missing_field))).map((pt, i) => (
                  <div key={`att-${i}`} style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
                    <span style={{ color: "#d97706", fontWeight: 700, fontSize: "9pt", minWidth: "14px" }}>•</span>
                    <span style={{ fontSize: "9pt", color: "#78350f" }}>{pt}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Inclusion criteria */}
            <CriteriaSection title="Critères d'inclusion" items={inclusion} accentColor="#1e40af" />

            {/* Exclusion criteria */}
            <CriteriaSection title="Critères d'exclusion" items={exclusion} accentColor="#b45309" />

            {/* Signature */}
            <div style={{ marginTop: "10mm", borderTop: "1px solid #e5e7eb", paddingTop: "8mm" }}>
              <div style={{ fontSize: "10pt", fontWeight: 700, color: "#374151", marginBottom: "6mm" }}>
                Validation médicale
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8mm" }}>
                {[
                  { label: "Investigateur principal", line: true },
                  { label: "Date et lieu", line: true },
                  { label: "Signature", line: true },
                  { label: "Cachet du service", line: false },
                ].map(({ label, line }) => (
                  <div key={label}>
                    <div style={{ fontSize: "8pt", color: "#6b7280", marginBottom: "2px" }}>{label}</div>
                    <div style={{ borderBottom: line ? "1px solid #9ca3af" : "none", height: "20px" }} />
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div style={{ marginTop: "8mm", paddingTop: "4mm", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "7pt", color: "#9ca3af" }}>
                Document généré le {new Date().toLocaleString("fr-FR")} · ID analyse : {analysis.id.slice(0, 8)}
              </span>
              <span style={{ fontSize: "7pt", color: "#9ca3af" }}>
                Données traitées localement — aucune transmission externe
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function CriteriaSection({
  title, items, accentColor,
}: {
  title: string;
  items: Analysis["criterion_results"];
  accentColor: string;
}) {
  if (!items.length) return null;
  const satisfait    = items.filter(r => (r.override_status ?? r.status) === "satisfait").length;
  const nonSatisfait = items.filter(r => (r.override_status ?? r.status) === "non_satisfait").length;
  const inconnu      = items.filter(r => !r.override_status && r.status === "inconnu").length;

  return (
    <div style={{ marginBottom: "6mm" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3mm" }}>
        <div style={{ fontSize: "9pt", fontWeight: 700, textTransform: "uppercase", color: accentColor, letterSpacing: "0.5px" }}>
          {title}
        </div>
        <div style={{ fontSize: "8pt", color: "#6b7280" }}>
          ✓ {satisfait} · ✗ {nonSatisfait} · ? {inconnu}
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8.5pt" }}>
        <thead>
          <tr style={{ background: "#f9fafb" }}>
            {["#", "Critère", "Statut", "Raisonnement"].map(h => (
              <th key={h} style={{ padding: "4px 8px", textAlign: "left", color: "#6b7280", fontWeight: 600, fontSize: "8pt", borderBottom: "1px solid #e5e7eb" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((cr, i) => {
            const eff = cr.override_status ?? cr.status;
            return (
              <tr key={cr.id} style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                <td style={{ padding: "4px 8px", color: "#9ca3af", fontSize: "8pt", whiteSpace: "nowrap" }}>
                  {String(i + 1).padStart(2, "0")}
                </td>
                <td style={{ padding: "4px 8px", color: "#1f2937" }}>
                  {cr.criterion_text}
                  {cr.override_status && (
                    <span style={{ fontSize: "7pt", color: "#6366f1", marginLeft: "4px" }}>[modifié]</span>
                  )}
                </td>
                <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>
                  <span style={{
                    fontWeight: 700,
                    color: STATUS_COLORS[eff] ?? "#374151",
                    fontSize: "8pt",
                  }}>
                    {STATUS_ICONS[eff] ?? "?"} {eff.replace("_", " ")}
                  </span>
                </td>
                <td style={{ padding: "4px 8px", color: "#6b7280", fontSize: "8pt" }}>
                  {cr.override_note ?? cr.reasoning ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
