import { useState } from "react";
import type { CreateProtocolPayload, ProtocolPhase, StudyDrug, StudyVisit } from "@/types";
import { ProtocolImporter } from "./ProtocolImporter";

interface Props {
  onSubmit: (payload: CreateProtocolPayload) => Promise<void>;
  initialValues?: Partial<CreateProtocolPayload>;
  isLoading?: boolean;
}

const PHASES: ProtocolPhase[] = ["I", "II", "III", "IV"];

const L = { color: "#64748b", fontSize: "0.75rem", fontWeight: 500, marginBottom: "6px", display: "block" as const };

type Tab = "identification" | "objectives" | "schema" | "drugs" | "meds" | "criteria";

const TABS: { id: Tab; label: string }[] = [
  { id: "identification", label: "Identification" },
  { id: "objectives",     label: "Objectifs" },
  { id: "schema",         label: "Schéma & Interventions" },
  { id: "drugs",          label: "Médicaments" },
  { id: "meds",           label: "Autorisés / Interdits" },
  { id: "criteria",       label: "Critères" },
];

export function ProtocolForm({ onSubmit, initialValues, isLoading }: Props) {
  const [tab, setTab]           = useState<Tab>("identification");
  const [showImporter, setShowImporter] = useState(false);

  // ── Identification ──
  const [title,       setTitle]       = useState(initialValues?.title       ?? "");
  const [eudract,     setEudract]     = useState(initialValues?.eudract_number ?? "");
  const [phase,       setPhase]       = useState<ProtocolPhase>(initialValues?.phase ?? "II");
  const [pathology,   setPathology]   = useState(initialValues?.pathology   ?? "");
  const [summary,     setSummary]     = useState(initialValues?.summary     ?? "");
  const [promoter,    setPromoter]    = useState(initialValues?.promoter    ?? "");
  const [arcReferent, setArcReferent] = useState(initialValues?.arc_referent ?? "");

  // ── Objectives ──
  const [objPrimary,   setObjPrimary]   = useState(initialValues?.objectives_primary   ?? "");
  const [objSecondary, setObjSecondary] = useState(initialValues?.objectives_secondary ?? "");

  // ── Schema / Interventions ──
  const [studySchema,   setStudySchema]   = useState(initialValues?.study_schema   ?? "");
  const [interventions, setInterventions] = useState(initialValues?.interventions  ?? "");

  // ── Drugs (as text, parsed on submit) ──
  const [drugsText, setDrugsText] = useState(
    (initialValues?.study_drugs ?? [])
      .map(d => `${d.name}|${d.dose ?? ""}|${d.route ?? ""}|${d.frequency ?? ""}`)
      .join("\n")
  );

  // ── Authorized / Prohibited meds ──
  const [authorizedMeds, setAuthorizedMeds] = useState((initialValues?.authorized_meds ?? []).join("\n"));
  const [prohibitedMeds, setProhibitedMeds] = useState((initialValues?.prohibited_meds ?? []).join("\n"));

  // ── Criteria ──
  const [incText, setIncText] = useState(
    (initialValues?.criteria ?? [])
      .filter(c => c.type === "INC")
      .map(c => c.text)
      .join("\n")
  );
  const [excText, setExcText] = useState(
    (initialValues?.criteria ?? [])
      .filter(c => c.type === "EXC")
      .map(c => c.text)
      .join("\n")
  );

  const [visits, setVisits] = useState<StudyVisit[]>(initialValues?.visits ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Import handler ──
  function handleImport(data: Partial<CreateProtocolPayload>) {
    if (data.title)       setTitle(data.title);
    if (data.eudract_number) setEudract(data.eudract_number);
    if (data.phase)       setPhase(data.phase);
    if (data.pathology)   setPathology(data.pathology);
    if (data.summary)     setSummary(data.summary);
    if (data.promoter)    setPromoter(data.promoter);
    if (data.objectives_primary)   setObjPrimary(data.objectives_primary);
    if (data.objectives_secondary) setObjSecondary(data.objectives_secondary);
    if (data.study_schema)   setStudySchema(data.study_schema);
    if (data.interventions)  setInterventions(data.interventions);
    if (data.study_drugs?.length) {
      setDrugsText(data.study_drugs.map(d => `${d.name}|${d.dose ?? ""}|${d.route ?? ""}|${d.frequency ?? ""}`).join("\n"));
    }
    if (data.authorized_meds?.length) setAuthorizedMeds(data.authorized_meds.join("\n"));
    if (data.prohibited_meds?.length) setProhibitedMeds(data.prohibited_meds.join("\n"));
    if (data.criteria?.length) {
      setIncText(data.criteria.filter(c => c.type === "INC").map(c => c.text).join("\n"));
      setExcText(data.criteria.filter(c => c.type === "EXC").map(c => c.text).join("\n"));
    }
    if (data.visits?.length) setVisits(data.visits);
  }

  function parseDrugs(): StudyDrug[] {
    return drugsText.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
      const parts = line.split("|");
      return { name: parts[0] ?? line, dose: parts[1] || undefined, route: parts[2] || undefined, frequency: parts[3] || undefined };
    });
  }

  function parseCriteria() {
    const inc = incText.split("\n").map(l => l.trim().replace(/^[\d]+[.)]\s*/, "").replace(/^[-•·]\s*/, "").trim()).filter(l => l.length > 3);
    const exc = excText.split("\n").map(l => l.trim().replace(/^[\d]+[.)]\s*/, "").replace(/^[-•·]\s*/, "").trim()).filter(l => l.length > 3);
    return [
      ...inc.map((text, i) => ({ type: "INC" as const, text, order: i })),
      ...exc.map((text, i) => ({ type: "EXC" as const, text, order: inc.length + i })),
    ];
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!title.trim())    e.title    = "Le titre est requis";
    if (!pathology.trim()) e.pathology = "La pathologie est requise";
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) { setTab("identification"); return; }
    await onSubmit({
      title: title.trim(),
      eudract_number: eudract.trim() || undefined,
      phase,
      pathology: pathology.trim(),
      summary: summary.trim() || undefined,
      promoter: promoter.trim() || undefined,
      arc_referent: arcReferent.trim() || undefined,
      objectives_primary:   objPrimary.trim()   || undefined,
      objectives_secondary: objSecondary.trim() || undefined,
      study_schema:   studySchema.trim()   || undefined,
      interventions:  interventions.trim() || undefined,
      study_drugs: parseDrugs().length ? parseDrugs() : undefined,
      authorized_meds: authorizedMeds.split("\n").map(l => l.trim()).filter(Boolean) || undefined,
      prohibited_meds: prohibitedMeds.split("\n").map(l => l.trim()).filter(Boolean) || undefined,
      criteria: parseCriteria(),
      visits: visits.length ? visits : undefined,
    });
  }

  const completedTabs = new Set<Tab>();
  if (title && pathology) completedTabs.add("identification");
  if (objPrimary)         completedTabs.add("objectives");
  if (studySchema || interventions) completedTabs.add("schema");
  if (drugsText)          completedTabs.add("drugs");
  if (authorizedMeds || prohibitedMeds) completedTabs.add("meds");
  if (incText || excText) completedTabs.add("criteria");

  return (
    <>
      {showImporter && (
        <ProtocolImporter
          onImport={data => { handleImport(data); setShowImporter(false); }}
          onClose={() => setShowImporter(false)}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-5" data-testid="protocol-form">
        {/* Import PDF button */}
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: "#475569" }}>
            Remplissez manuellement ou importez depuis un PDF de protocole
          </p>
          <button
            type="button"
            onClick={() => setShowImporter(true)}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-xl font-medium transition-all"
            style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" strokeLinecap="round"/>
            </svg>
            Importer depuis PDF
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl p-1"
             style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: tab === t.id ? "rgba(99,102,241,0.18)" : "transparent",
                color: tab === t.id ? "#818cf8" : "var(--text-muted)",
              }}
            >
              {completedTabs.has(t.id) && (
                <span style={{ color: "#34d399", fontSize: "10px" }}>●</span>
              )}
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Identification ── */}
        {tab === "identification" && (
          <div className="space-y-4">
            <div>
              <label style={L}>Titre du protocole *</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                     className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={500} data-testid="protocol-title" />
              {errors.title && <p className="text-xs mt-1" style={{ color: "#fb7185" }} data-testid="error-title">{errors.title}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label style={L}>Numéro EudraCT / NCT</label>
                <input type="text" value={eudract} onChange={e => setEudract(e.target.value)}
                       placeholder="2024-000000-00 ou NCT0XXXXXXX"
                       className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={50} data-testid="protocol-eudract" />
              </div>
              <div>
                <label style={L}>Phase *</label>
                <select value={phase} onChange={e => setPhase(e.target.value as ProtocolPhase)}
                        className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" data-testid="protocol-phase">
                  {PHASES.map(p => <option key={p} value={p}>Phase {p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={L}>Pathologie / Indication *</label>
              <input type="text" value={pathology} onChange={e => setPathology(e.target.value)}
                     className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={255} data-testid="protocol-pathology" />
              {errors.pathology && <p className="text-xs mt-1" style={{ color: "#fb7185" }} data-testid="error-pathology">{errors.pathology}</p>}
            </div>
            <div>
              <label style={L}>Résumé / Synopsis</label>
              <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={4}
                        className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none" data-testid="protocol-summary" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label style={L}>Promoteur</label>
                <input type="text" value={promoter} onChange={e => setPromoter(e.target.value)}
                       className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={255} />
              </div>
              <div>
                <label style={L}>ARC référent</label>
                <input type="text" value={arcReferent} onChange={e => setArcReferent(e.target.value)}
                       className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={255} />
              </div>
            </div>
          </div>
        )}

        {/* ── Objectives ── */}
        {tab === "objectives" && (
          <div className="space-y-4">
            <div>
              <label style={L}>Objectif principal (critère primaire)</label>
              <textarea value={objPrimary} onChange={e => setObjPrimary(e.target.value)} rows={5}
                        className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
                        placeholder="Ex : Survie sans progression (SSP) évaluée par l'investigateur selon RECIST 1.1" />
            </div>
            <div>
              <label style={L}>Objectifs secondaires</label>
              <textarea value={objSecondary} onChange={e => setObjSecondary(e.target.value)} rows={5}
                        className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
                        placeholder="Ex : Survie globale (SG), Taux de réponse objective (TRO), Qualité de vie…" />
            </div>
          </div>
        )}

        {/* ── Schema ── */}
        {tab === "schema" && (
          <div className="space-y-4">
            <div>
              <label style={L}>Schéma de l'étude</label>
              <textarea value={studySchema} onChange={e => setStudySchema(e.target.value)} rows={5}
                        className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
                        placeholder="Ex : Étude de phase III, randomisée (1:1), ouverte, multicentrique…" />
            </div>
            <div>
              <label style={L}>Interventions / Bras de traitement</label>
              <textarea value={interventions} onChange={e => setInterventions(e.target.value)} rows={6}
                        className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
                        placeholder="Bras A : Dato-DXd 6 mg/kg IV J1 Q3W + Durvalumab 1500 mg IV J1 Q3W&#10;Bras B : Pembrolizumab 200 mg IV J1 Q3W + Carboplatine AUC5…" />
            </div>
          </div>
        )}

        {/* ── Drugs ── */}
        {tab === "drugs" && (
          <div className="space-y-3">
            <div className="rounded-xl p-3" style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.12)" }}>
              <p className="text-xs" style={{ color: "#38bdf8" }}>
                Format : <code className="font-mono">Nom médicament|Dose|Voie|Fréquence</code> — 1 médicament par ligne
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
                Exemple : <code className="font-mono">Dato-DXd|6 mg/kg|IV|J1 Q3W</code>
              </p>
            </div>
            <textarea
              value={drugsText}
              onChange={e => setDrugsText(e.target.value)}
              rows={10}
              className="input-dark w-full rounded-xl px-4 py-2.5 text-sm font-mono resize-none"
              placeholder={"Dato-DXd|6 mg/kg|IV|J1 Q3W\nDurvalumab|1500 mg|IV|J1 Q3W\nCarboplatine|AUC 5|IV|J1 Q3W (4 cycles max)"}
            />
            {/* Preview */}
            {drugsText.trim() && (
              <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                <p className="text-xs font-medium" style={{ color: "#475569" }}>Aperçu :</p>
                {drugsText.split("\n").filter(Boolean).map((line, i) => {
                  const [name, dose, route, freq] = line.split("|");
                  return (
                    <div key={i} className="flex items-center gap-3 text-xs">
                      <span className="font-semibold" style={{ color: "#818cf8", minWidth: "120px" }}>{name}</span>
                      <span style={{ color: "#94a3b8" }}>{[dose, route, freq].filter(Boolean).join(" · ")}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Meds ── */}
        {tab === "meds" && (
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded flex items-center justify-center text-xs"
                     style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}>✓</div>
                <label style={{ ...L, marginBottom: 0 }}>Médicaments autorisés <span style={{ opacity: .5 }}>(1 par ligne)</span></label>
              </div>
              <textarea
                value={authorizedMeds}
                onChange={e => setAuthorizedMeds(e.target.value)}
                rows={10}
                className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
                placeholder={"Corticoïdes faible dose (≤ 10 mg/j)\nG-CSF prophylactique\nBisphosphonates pour métastases osseuses\n…"}
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded flex items-center justify-center text-xs"
                     style={{ background: "rgba(244,63,94,0.15)", color: "#fb7185" }}>✗</div>
                <label style={{ ...L, marginBottom: 0 }}>Médicaments interdits <span style={{ opacity: .5 }}>(1 par ligne)</span></label>
              </div>
              <textarea
                value={prohibitedMeds}
                onChange={e => setProhibitedMeds(e.target.value)}
                rows={10}
                className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
                placeholder={"Anti-PD-1 / anti-PD-L1 / anti-CTLA-4\nImmunosuppresseurs systémiques\nVaccins vivants atténués\n…"}
              />
            </div>
          </div>
        )}

        {/* ── Criteria ── */}
        {tab === "criteria" && (
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-1 rounded-md"
                      style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>INC</span>
                <label style={{ ...L, marginBottom: 0 }}>Critères d'inclusion <span style={{ opacity: .5 }}>(1 par ligne)</span></label>
              </div>
              <textarea
                value={incText}
                onChange={e => setIncText(e.target.value)}
                rows={14}
                className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
                placeholder={"Âge ≥ 18 ans\nECOG PS 0 ou 1\nCBNPC stade IV documenté histologiquement\n…"}
              />
              <p className="text-xs" style={{ color: "#334155" }}>
                {incText.split("\n").filter(l => l.trim().length > 3).length} critère(s) d'inclusion
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-1 rounded-md"
                      style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c" }}>EXC</span>
                <label style={{ ...L, marginBottom: 0 }}>Critères d'exclusion <span style={{ opacity: .5 }}>(1 par ligne)</span></label>
              </div>
              <textarea
                value={excText}
                onChange={e => setExcText(e.target.value)}
                rows={14}
                className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
                placeholder={"Antécédent de traitement anti-PD-1/PD-L1\nMétastases cérébrales actives\nInfection VHB/VHC active\n…"}
              />
              <p className="text-xs" style={{ color: "#334155" }}>
                {excText.split("\n").filter(l => l.trim().length > 3).length} critère(s) d'exclusion
              </p>
            </div>
          </div>
        )}

        <button type="submit" disabled={isLoading}
                className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold text-white"
                data-testid="protocol-submit">
          {isLoading ? "Enregistrement…" : "Créer le protocole"}
        </button>
      </form>
    </>
  );
}
