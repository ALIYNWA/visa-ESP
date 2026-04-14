/**
 * Demo in-memory store — simulates the backend when no API is available.
 * Active when localStorage.access_token === "demo-token".
 *
 * Privacy model:
 *  – All data stays in memory (never leaves the browser in demo mode)
 *  – In real mode, only localhost:11434 (Ollama/Meditron) receives analysis prompts
 *  – Document text is stored locally; patient context uses pseudonyms only
 */
import type {
  Analysis, AuditAction, AuditEntity, AuditLog, Criterion,
  MissingDataPoint, Patient, Protocol, ProtocolListItem, StudyDocument,
} from "@/types";

function uuid(): string { return crypto.randomUUID(); }
function now(): string  { return new Date().toISOString(); }

// ── Seed data ─────────────────────────────────────────────────────────────────

const SEED_PROTOCOL_ID = "11111111-0000-0000-0000-000000000001";
const SEED_CRITERIA: Criterion[] = [
  { id: uuid(), protocol_id: SEED_PROTOCOL_ID, type: "INC", text: "Âge >= 18 ans", order: 0, created_at: now() },
  { id: uuid(), protocol_id: SEED_PROTOCOL_ID, type: "INC", text: "ECOG Performance Status <= 2", order: 1, created_at: now() },
  { id: uuid(), protocol_id: SEED_PROTOCOL_ID, type: "INC", text: "Diagnostic histologique confirmé de CBNPC stade IIIB ou IV", order: 2, created_at: now() },
  { id: uuid(), protocol_id: SEED_PROTOCOL_ID, type: "EXC", text: "Traitement antérieur par anti-PD1/PD-L1", order: 3, created_at: now() },
  { id: uuid(), protocol_id: SEED_PROTOCOL_ID, type: "EXC", text: "Créatinine > 1.5x la limite supérieure de la normale", order: 4, created_at: now() },
];

// ── AVANZAR seed (NCT05687266 — AstraZeneca Phase III) ────────────────────────

const AVANZAR_PROTOCOL_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const AVANZAR_CRITERIA: Criterion[] = [
  // Inclusion
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "INC", text: "Âge ≥ 18 ans au moment du screening", order: 0, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "INC", text: "CBNPC documenté histologiquement ou cytologiquement, stade IIIB, IIIC (non éligible à la résection chirurgicale ou à la chimioradiation définitive) ou stade IV métastatique", order: 1, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "INC", text: "Absence de mutation EGFR sensibilisante, de réarrangement ALK et ROS1 ; absence d'altérations oncogéniques actionnables documentées (NTRK, BRAF, RET, MET ou autres) avec thérapies approuvées", order: 2, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "INC", text: "ECOG Performance Status 0 ou 1", order: 3, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "INC", text: "Tissu tumoral archivé disponible pour analyse biomarqueurs", order: 4, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "INC", text: "Réserve médullaire et fonction organique adéquates dans les 7 jours avant la randomisation (bilan biologique complet requis)", order: 5, created_at: now() },
  // Exclusion
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "EXC", text: "Histologie mixte CBPC/CBNPC ou variant CBNPC sarcomatoïde", order: 6, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "EXC", text: "Antécédent d'un autre cancer primitif (sauf exceptions documentées)", order: 7, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "EXC", text: "Toxicités persistantes de grade > 1 liées à un traitement anticancéreux antérieur", order: 8, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "EXC", text: "Compression médullaire ou métastases cérébrales actives non contrôlées", order: 9, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "EXC", text: "Antécédent de carcinomatose leptoméningée", order: 10, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "EXC", text: "Infection active ou non contrôlée par le VHB ou VHC", order: 11, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "EXC", text: "Infection nécessitant des antibiotiques, antiviraux ou antifongiques IV non contrôlée ou suspectée", order: 12, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "EXC", text: "Maladie cornéenne cliniquement significative", order: 13, created_at: now() },
  { id: uuid(), protocol_id: AVANZAR_PROTOCOL_ID, type: "EXC", text: "Pneumopathie interstitielle/pneumonite non infectieuse nécessitant des corticoïdes, pneumopathie interstitielle actuelle ou suspectée ne pouvant être exclue à l'imagerie", order: 14, created_at: now() },
];

const SEED_PROTOCOLS: Protocol[] = [
  {
    id: AVANZAR_PROTOCOL_ID,
    title: "AVANZAR — Dato-DXd + Durvalumab + Carboplatine vs Pembrolizumab 1L CBNPC",
    eudract_number: "2021-004606-21",
    phase: "III",
    pathology: "Cancer bronchique non à petites cellules avancé ou métastatique sans altération génomique actionnable",
    summary: "Étude de phase III, randomisée, ouverte, multicentrique, globale comparant le Datopotamab Deruxtecan (Dato-DXd) en association avec le durvalumab et le carboplatine versus le pembrolizumab en association avec une chimiothérapie à base de platine spécifique à l'histologie, pour le traitement de première ligne des patients adultes atteints d'un CBNPC localement avancé ou métastatique (stade IIIB, IIIC ou IV) sans altération génomique actionnable. Promoteur : AstraZeneca. NCT05687266.",
    promoter: "AstraZeneca",
    arc_referent: null,
    version: 1,
    is_active: true,
    created_at: now(),
    updated_at: now(),
    created_by: "00000000-0000-0000-0000-000000000001",
    criteria: AVANZAR_CRITERIA,
  },
  {
    id: SEED_PROTOCOL_ID,
    title: "ONCO-IMMUNO-2024 — Immunothérapie CBNPC",
    eudract_number: "2024-001234-10",
    phase: "II",
    pathology: "Cancer bronchique non à petites cellules",
    summary: "Essai de phase II évaluant l'efficacité du pembrolizumab en première ligne.",
    promoter: "CHU Démonstration",
    arc_referent: "ARC Dupont",
    version: 1,
    is_active: true,
    created_at: now(),
    updated_at: now(),
    created_by: "00000000-0000-0000-0000-000000000001",
    criteria: SEED_CRITERIA,
  },
];

const SEED_PATIENT_ID = "22222222-0000-0000-0000-000000000001";
const SEED_PATIENTS: Patient[] = [
  {
    id: SEED_PATIENT_ID,
    pseudonym: "DEMO-P-001",
    context: {
      age: 62,
      sexe: "M",
      diagnostic_principal: "CBNPC stade IV",
      stade: "IV",
      ecog_performance_status: 1,
      traitements_en_cours: ["Carboplatine", "Paclitaxel"],
      biologie: { creatinine: "0.9 mg/dL", hb: "12.5 g/dL" },
      antecedents: ["HTA", "Diabète type 2"],
    },
    created_by: "00000000-0000-0000-0000-000000000001",
    created_at: now(),
  },
];

const SEED_ANALYSIS_ID = "33333333-0000-0000-0000-000000000001";
const SEED_ANALYSES: Analysis[] = [
  {
    id: SEED_ANALYSIS_ID,
    protocol_id: SEED_PROTOCOL_ID,
    protocol_version: 1,
    patient_id: SEED_PATIENT_ID,
    verdict: "eligible",
    score_pct: 100,
    resume: "Le patient remplit tous les critères d'inclusion et aucun critère d'exclusion n'est présent. Éligibilité confirmée.",
    points_attention: [
      "Surveiller la créatinine à chaque cycle (antécédent de diabète type 2)",
      "Contrôle glycémique avant inclusion recommandé",
    ],
    missing_data_points: [],
    prompt_hash: "a3f8c2e1d9b7f4a2c6e8d1b3f5a7c9e2d4b6f8a1c3e5d7b9f2a4c6e8d1b3f5a7",
    model_name: "meditron:70b",
    model_version: "70B",
    latency_ms: 3240,
    created_at: now(),
    created_by: "00000000-0000-0000-0000-000000000001",
    validated_by: null,
    validated_at: null,
    criterion_results: SEED_CRITERIA.map((c, i) => ({
      id: uuid(),
      criterion_id: c.id,
      criterion_text: c.text,
      criterion_type: c.type,
      status: "satisfait" as const,
      reasoning: i === 0 ? "Patient âgé de 62 ans — critère satisfait." :
                 i === 1 ? "ECOG PS = 1, inférieur ou égal à 2." :
                 i === 2 ? "Diagnostic de CBNPC stade IV confirmé histologiquement." :
                 i === 3 ? "Aucun traitement antérieur par immunothérapie retrouvé." :
                           "Créatinine à 0.9 mg/dL, nettement inférieure à 1.5x la LSN.",
      overridden_by: null, overridden_at: null, override_note: null, override_status: null,
    })),
  },
];

// ── Mutable store ─────────────────────────────────────────────────────────────

const store = {
  protocols:  [...SEED_PROTOCOLS] as Protocol[],
  patients:   [...SEED_PATIENTS]  as Patient[],
  analyses:   [...SEED_ANALYSES]  as Analysis[],
  documents:  []                  as StudyDocument[],
  auditLogs:  []                  as AuditLog[],
};

// ── Audit helpers ─────────────────────────────────────────────────────────────

function addAudit(
  action: AuditAction,
  entity: AuditEntity,
  entityId: string | null,
  description: string,
  username = "system"
): void {
  store.auditLogs.unshift({
    id: uuid(),
    timestamp: now(),
    user_id: "00000000-0000-0000-0000-000000000001",
    username,
    action,
    entity,
    entity_id: entityId,
    description,
  });
  // Keep at most 500 entries
  if (store.auditLogs.length > 500) store.auditLogs.length = 500;
}

// Seed a few initial audit events for demo purposes
addAudit("login",  "patient",  null,                  "Connexion admin — mode démo", "admin");
addAudit("create", "protocol", AVANZAR_PROTOCOL_ID,   "Protocole AVANZAR (NCT05687266) importé depuis ClinicalTrials.gov — Phase III AstraZeneca", "admin");
addAudit("create", "protocol", SEED_PROTOCOL_ID,      "Protocole ONCO-IMMUNO-2024 créé", "admin");
addAudit("create", "patient",  SEED_PATIENT_ID,       "Patient DEMO-P-001 créé", "admin");
addAudit("create", "analysis", SEED_ANALYSIS_ID,      "Analyse créée — DEMO-P-001 × ONCO-IMMUNO-2024 → Éligible", "admin");

export function isDemoMode(): boolean {
  return localStorage.getItem("access_token") === "demo-token";
}

// ── Protocol API ──────────────────────────────────────────────────────────────

export const demoProtocols = {
  list(): ProtocolListItem[] {
    return store.protocols.map(p => ({
      id: p.id, title: p.title, eudract_number: p.eudract_number,
      phase: p.phase, pathology: p.pathology, version: p.version,
      is_active: p.is_active, created_at: p.created_at,
      criteria_count: p.criteria.length,
    }));
  },
  get(id: string): Protocol {
    const p = store.protocols.find(p => p.id === id);
    if (!p) throw new Error("Protocol not found");
    return p;
  },
  create(payload: any): Protocol {
    const id = uuid();
    const proto: Protocol = {
      id, version: 1, is_active: true,
      created_at: now(), updated_at: now(),
      created_by: "00000000-0000-0000-0000-000000000001",
      criteria: (payload.criteria || []).map((c: any, i: number) => ({
        id: uuid(), protocol_id: id, type: c.type, text: c.text,
        order: c.order ?? i, created_at: now(),
      })),
      title: payload.title, eudract_number: payload.eudract_number ?? null,
      phase: payload.phase, pathology: payload.pathology,
      summary: payload.summary ?? null, promoter: payload.promoter ?? null,
      arc_referent: payload.arc_referent ?? null,
    };
    store.protocols.unshift(proto);
    addAudit("create", "protocol", id, `Protocole "${payload.title}" créé (Phase ${payload.phase})`, payload._username);
    return proto;
  },
  update(id: string, payload: any): Protocol {
    const p = store.protocols.find(p => p.id === id);
    if (!p) throw new Error("Protocol not found");
    Object.assign(p, payload, { updated_at: now() });
    addAudit("update", "protocol", id, `Protocole "${p.title}" modifié`, payload._username);
    return p;
  },
  delete(id: string): void {
    const p = store.protocols.find(p => p.id === id);
    if (!p) throw new Error("Protocol not found");
    addAudit("delete", "protocol", id, `Protocole "${p.title}" supprimé`);
    store.protocols = store.protocols.filter(p => p.id !== id);
  },
  addCriterion(protocolId: string, payload: any): Criterion {
    const p = store.protocols.find(p => p.id === protocolId);
    if (!p) throw new Error("Protocol not found");
    const c: Criterion = { id: uuid(), protocol_id: protocolId, ...payload, created_at: now() };
    p.criteria.push(c);
    addAudit("create", "criterion", c.id, `Critère ajouté au protocole "${p.title}": ${c.text.slice(0, 60)}`);
    return c;
  },
  deleteCriterion(protocolId: string, criterionId: string): void {
    const p = store.protocols.find(p => p.id === protocolId);
    if (!p) throw new Error("Protocol not found");
    const c = p.criteria.find(c => c.id === criterionId);
    addAudit("delete", "criterion", criterionId, `Critère supprimé du protocole "${p.title}": ${c?.text.slice(0, 60) ?? ""}`);
    p.criteria = p.criteria.filter(c => c.id !== criterionId);
  },
  updateCriterion(protocolId: string, criterionId: string, payload: any): Criterion {
    const p = store.protocols.find(p => p.id === protocolId);
    if (!p) throw new Error("Protocol not found");
    const c = p.criteria.find(c => c.id === criterionId);
    if (!c) throw new Error("Criterion not found");
    Object.assign(c, payload);
    return c;
  },
};

// ── Documents API ─────────────────────────────────────────────────────────────

export const demoDocuments = {
  list(protocolId: string): StudyDocument[] {
    return store.documents.filter(d => d.protocol_id === protocolId);
  },
  get(id: string): StudyDocument {
    const d = store.documents.find(d => d.id === id);
    if (!d) throw new Error("Document not found");
    return d;
  },
  create(protocolId: string, payload: {
    name: string; category: StudyDocument["category"];
    content_text: string; size_bytes: number;
  }): StudyDocument {
    const doc: StudyDocument = {
      id: uuid(),
      protocol_id: protocolId,
      name: payload.name,
      category: payload.category,
      size_bytes: payload.size_bytes,
      content_text: payload.content_text,
      uploaded_by: "00000000-0000-0000-0000-000000000001",
      uploaded_at: now(),
    };
    store.documents.unshift(doc);
    addAudit("create", "document", doc.id, `Document "${doc.name}" (${doc.category}) ajouté au protocole`);
    return doc;
  },
  delete(id: string): void {
    const d = store.documents.find(d => d.id === id);
    if (d) addAudit("delete", "document", id, `Document "${d.name}" supprimé`);
    store.documents = store.documents.filter(d => d.id !== id);
  },
  /** Returns a safe excerpt of all documents for a protocol (max 3000 chars total).
   *  Privacy: this text may be sent to local Ollama — no patient data is included. */
  getContextForProtocol(protocolId: string): string {
    const docs = store.documents.filter(d => d.protocol_id === protocolId);
    if (!docs.length) return "";
    const MAX_PER_DOC = Math.floor(3000 / docs.length);
    return docs.map(d =>
      `[${d.category.toUpperCase()} — ${d.name}]\n${d.content_text.slice(0, MAX_PER_DOC)}`
    ).join("\n\n---\n\n");
  },
};

// ── Patient API ───────────────────────────────────────────────────────────────

export const demoPatients = {
  list() { return store.patients.map(({ id, pseudonym, created_at }) => ({ id, pseudonym, created_at })); },
  get(id: string): Patient {
    const p = store.patients.find(p => p.id === id);
    if (!p) throw new Error("Patient not found");
    return p;
  },
  create(payload: any): Patient {
    const p: Patient = {
      id: uuid(), pseudonym: payload.pseudonym, context: payload.context,
      created_by: "00000000-0000-0000-0000-000000000001", created_at: now(),
    };
    store.patients.unshift(p);
    addAudit("create", "patient", p.id, `Patient "${p.pseudonym}" créé`);
    return p;
  },
  update(id: string, payload: any): Patient {
    const p = store.patients.find(p => p.id === id);
    if (!p) throw new Error("Patient not found");
    const oldPseudonym = p.pseudonym;
    if (payload.pseudonym) p.pseudonym = payload.pseudonym;
    if (payload.context)   p.context   = payload.context;
    addAudit("update", "patient", id, `Patient "${oldPseudonym}" modifié`);
    return p;
  },
  delete(id: string): void {
    const p = store.patients.find(p => p.id === id);
    if (!p) throw new Error("Patient not found");
    addAudit("delete", "patient", id, `Patient "${p.pseudonym}" supprimé`);
    store.patients   = store.patients.filter(p => p.id !== id);
    store.analyses   = store.analyses.filter(a => a.patient_id !== id);
  },
};

// ── Missing-data detection ────────────────────────────────────────────────────

/**
 * Compares criterion text against available patient context fields.
 * Returns structured missing-data points — used in attention warnings.
 * Pure function, no side-effects, no patient identifiers returned.
 */
function detectMissingData(
  criteria: Criterion[],
  context: Patient["context"],
  criteriaResults: Array<{ criterion_id: string; status: string; criterion_text: string }>
): MissingDataPoint[] {
  const ctx = context ?? {};
  const missing: MissingDataPoint[] = [];

  for (const cr of criteriaResults) {
    if (cr.status !== "inconnu") continue;
    const crit = criteria.find(c => c.id === cr.criterion_id);
    if (!crit) continue;

    const t = crit.text.toLowerCase();

    if ((t.includes("ecog") || t.includes("performance status")) && ctx.ecog_performance_status == null)
      missing.push({ criterion_id: crit.id, criterion_text: crit.text, missing_field: "ECOG Performance Status", suggestion: "Renseigner le statut OMS/ECOG (0–4) dans le contexte clinique." });

    if ((t.includes("egfr") || t.includes("mutation") || t.includes("altération génomique")) && !ctx.notes_libres?.toLowerCase().includes("egfr"))
      missing.push({ criterion_id: crit.id, criterion_text: crit.text, missing_field: "Statut moléculaire (EGFR/ALK/ROS1)", suggestion: "Ajouter les résultats de biologie moléculaire dans les notes libres ou biologie." });

    if ((t.includes("tissu") || t.includes("archivé") || t.includes("biopsie")) && !ctx.notes_libres?.toLowerCase().includes("tissu"))
      missing.push({ criterion_id: crit.id, criterion_text: crit.text, missing_field: "Disponibilité du tissu tumoral archivé", suggestion: "Confirmer la disponibilité du tissu tumoral archivé dans les notes du dossier." });

    if ((t.includes("hépatite") || t.includes("vhb") || t.includes("vhc")) && !ctx.biologie?.vhb && !ctx.biologie?.vhc)
      missing.push({ criterion_id: crit.id, criterion_text: crit.text, missing_field: "Sérologies VHB / VHC", suggestion: "Documenter les sérologies VHB et VHC dans la section biologie." });

    if ((t.includes("créatinine") || t.includes("rénale")) && !ctx.biologie?.creatinine)
      missing.push({ criterion_id: crit.id, criterion_text: crit.text, missing_field: "Créatininémie", suggestion: "Renseigner la créatinine (mg/dL) dans la section biologie." });

    if ((t.includes("métastase") || t.includes("cérébral")) && !ctx.notes_libres?.toLowerCase().includes("métastase") && !ctx.notes_libres?.toLowerCase().includes("cerveau"))
      missing.push({ criterion_id: crit.id, criterion_text: crit.text, missing_field: "Statut métastases cérébrales", suggestion: "Préciser l'absence ou la présence de métastases cérébrales dans les notes libres." });

    if ((t.includes("pneumonit") || t.includes("interstitielle") || t.includes("pneumopathie")) && !ctx.antecedents?.some(a => a.toLowerCase().includes("pneumo")))
      missing.push({ criterion_id: crit.id, criterion_text: crit.text, missing_field: "Antécédents de pneumopathie interstitielle", suggestion: "Vérifier et documenter les antécédents pulmonaires dans la liste des antécédents." });

    // Generic fallback for still-unmatched inconnu criteria
    if (!missing.find(m => m.criterion_id === crit.id))
      missing.push({ criterion_id: crit.id, criterion_text: crit.text, missing_field: "Données cliniques insuffisantes", suggestion: "Compléter le contexte clinique pour évaluer ce critère." });
  }

  return missing;
}

// ── Analysis API ──────────────────────────────────────────────────────────────

const DEMO_VERDICTS = ["eligible", "non_eligible", "incomplet"] as const;

export const demoAnalyses = {
  list(params?: { patient_id?: string; protocol_id?: string }) {
    let result = store.analyses;
    if (params?.patient_id)  result = result.filter(a => a.patient_id  === params.patient_id);
    if (params?.protocol_id) result = result.filter(a => a.protocol_id === params.protocol_id);
    return result;
  },
  get(id: string): Analysis {
    const a = store.analyses.find(a => a.id === id);
    if (!a) throw new Error("Analysis not found");
    return a;
  },
  create(payload: { protocol_id: string; patient_id: string }): Analysis {
    const protocol = store.protocols.find(p => p.id === payload.protocol_id);
    if (!protocol) throw new Error("Protocol not found");
    const patient  = store.patients.find(p => p.id === payload.patient_id);
    if (!patient)  throw new Error("Patient not found");
    const ctx = patient.context ?? {};

    // Check document context
    const docContext = demoDocuments.getContextForProtocol(payload.protocol_id);
    const hasDocuments = docContext.length > 0;

    const verdictIndex = store.analyses.length % 3;
    const verdict = DEMO_VERDICTS[verdictIndex];

    const criteriaResults = protocol.criteria.map((c, i) => {
      let status: "satisfait" | "non_satisfait" | "inconnu" =
        verdict === "eligible"     ? "satisfait" :
        verdict === "non_eligible" && i === 0 ? "non_satisfait" :
        verdict === "incomplet"    && i === protocol.criteria.length - 1 ? "inconnu" :
        "satisfait";

      // Make AVANZAR-like criteria inconnu if patient context is missing relevant data
      const t = c.text.toLowerCase();
      if ((t.includes("egfr") || t.includes("altération génomique") || t.includes("alk") || t.includes("ros1")) &&
          !ctx.notes_libres?.toLowerCase().includes("egfr") && !ctx.notes_libres?.toLowerCase().includes("negative")) {
        status = "inconnu";
      }
      if ((t.includes("tissu") || t.includes("archivé")) && !ctx.notes_libres?.toLowerCase().includes("tissu")) {
        status = "inconnu";
      }
      if ((t.includes("hépatite") || t.includes("vhb") || t.includes("vhc")) &&
          !(ctx.biologie as Record<string, unknown>)?.["vhb"]) {
        status = "inconnu";
      }

      const reasoning = status === "satisfait"
        ? (hasDocuments ? `[Document: ${protocol.title}] ` : "") +
          (i === 0 && ctx.age != null ? `Patient âgé de ${ctx.age} ans — critère satisfait.` :
           i === 1 && ctx.ecog_performance_status != null ? `ECOG PS = ${ctx.ecog_performance_status}.` :
           `Critère évalué comme satisfait selon le contexte clinique disponible.`)
        : status === "non_satisfait"
        ? "Ce critère n'est pas satisfait selon les données cliniques fournies."
        : "Données insuffisantes dans le contexte clinique pour évaluer ce critère avec certitude. Vérification manuelle requise.";

      return {
        id: uuid(), criterion_id: c.id, criterion_text: c.text, criterion_type: c.type,
        status, reasoning,
        overridden_by: null, overridden_at: null, override_note: null, override_status: null,
      };
    });

    const satisfied = criteriaResults.filter(r => r.status === "satisfait").length;
    const unknown   = criteriaResults.filter(r => r.status === "inconnu").length;
    const score     = Math.round((satisfied / Math.max(criteriaResults.length, 1)) * 100);
    const finalVerdict = criteriaResults.some(r => r.status === "non_satisfait") ? "non_eligible"
                       : unknown > 0 ? "incomplet"
                       : "eligible";

    const missingDataPoints = detectMissingData(protocol.criteria, ctx, criteriaResults);

    const attentionPoints: string[] = [
      ...missingDataPoints.map(m => `Donnée manquante — ${m.missing_field} : ${m.suggestion}`),
      ...(ctx.antecedents?.includes("Diabète type 2") ? ["Contrôle glycémique recommandé avant inclusion"] : []),
      ...(ctx.antecedents?.includes("HTA") ? ["Surveillance tensionnelle à prévoir sous traitement"] : []),
      ...(hasDocuments ? [] : ["Aucun document d'étude chargé — enrichir le protocole avec le document officiel pour une analyse plus précise"]),
    ].filter(Boolean);

    const analysis: Analysis = {
      id: uuid(),
      protocol_id: payload.protocol_id,
      protocol_version: protocol.version,
      patient_id: payload.patient_id,
      verdict: finalVerdict,
      score_pct: score,
      resume: finalVerdict === "eligible"
        ? `Le patient ${patient.pseudonym} remplit tous les critères. Éligibilité confirmée.${hasDocuments ? " (Analyse enrichie par les documents d'étude.)" : ""}`
        : finalVerdict === "non_eligible"
        ? "Au moins un critère d'inclusion n'est pas satisfait. Patient non éligible."
        : `${unknown} critère(s) ne peuvent être évalués faute de données suffisantes. Une vérification manuelle est requise.`,
      points_attention: attentionPoints,
      missing_data_points: missingDataPoints,
      prompt_hash: Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join(""),
      model_name: "meditron:70b",
      model_version: "70B",
      latency_ms: 2800 + Math.floor(Math.random() * 1200),
      created_at: now(),
      created_by: "00000000-0000-0000-0000-000000000001",
      validated_by: null,
      validated_at: null,
      criterion_results: criteriaResults,
    };
    store.analyses.unshift(analysis);
    addAudit("create", "analysis", analysis.id,
      `Analyse créée — ${patient.pseudonym} × ${protocol.title} → ${finalVerdict === "eligible" ? "Éligible" : finalVerdict === "non_eligible" ? "Non éligible" : "Incomplet"} (${score}%)`);
    return analysis;
  },
  validate(id: string): Analysis {
    const a = store.analyses.find(a => a.id === id);
    if (!a) throw new Error("Analysis not found");
    if (a.validated_at) throw new Error("Already validated");
    a.validated_by = "00000000-0000-0000-0000-000000000001";
    a.validated_at = now();
    addAudit("validate", "analysis", id, `Analyse validée — verdict: ${a.verdict}, score: ${a.score_pct}%`);
    return a;
  },
  override(analysisId: string, criterionResultId: string, payload: any): Analysis {
    const a = store.analyses.find(a => a.id === analysisId);
    if (!a) throw new Error("Analysis not found");
    const cr = a.criterion_results.find(r => r.id === criterionResultId);
    if (!cr) throw new Error("Criterion result not found");
    cr.override_status   = payload.override_status;
    cr.override_note     = payload.override_note;
    cr.overridden_by     = "00000000-0000-0000-0000-000000000001";
    cr.overridden_at     = now();
    const satisfied = a.criterion_results.filter(r => (r.override_status ?? r.status) === "satisfait").length;
    a.score_pct = Math.round((satisfied / a.criterion_results.length) * 100);
    const hasNonSat  = a.criterion_results.some(r => (r.override_status ?? r.status) === "non_satisfait");
    const hasUnknown = a.criterion_results.some(r => !r.override_status && r.status === "inconnu");
    a.verdict = hasNonSat ? "non_eligible" : hasUnknown ? "incomplet" : "eligible";
    addAudit("override", "analysis", analysisId,
      `Critère overridé — "${cr.criterion_text.slice(0, 50)}" → ${payload.override_status}`);
    return a;
  },
  dashboardStats() {
    const total    = store.analyses.length;
    const eligible = store.analyses.filter(a => a.verdict === "eligible").length;

    // Per-protocol breakdown
    const protocolMap = new Map<string, { title: string; eligible: number; non_eligible: number; incomplet: number }>();
    for (const a of store.analyses) {
      const proto = store.protocols.find(p => p.id === a.protocol_id);
      const title = proto?.title ?? `Protocole ${a.protocol_id.slice(0, 8)}`;
      if (!protocolMap.has(a.protocol_id)) {
        protocolMap.set(a.protocol_id, { title, eligible: 0, non_eligible: 0, incomplet: 0 });
      }
      const entry = protocolMap.get(a.protocol_id)!;
      if (a.verdict === "eligible")     entry.eligible++;
      else if (a.verdict === "non_eligible") entry.non_eligible++;
      else                              entry.incomplet++;
    }

    return {
      total_protocols: store.protocols.length,
      active_protocols: store.protocols.filter(p => p.is_active).length,
      total_patients: store.patients.length,
      total_analyses: total,
      analyses_last_7_days: total,
      eligible_rate_pct: total ? Math.round((eligible / total) * 100) : 0,
      pending_validation: store.analyses.filter(a => !a.validated_at).length,
      per_protocol: [...protocolMap.entries()].map(([protocol_id, v]) => ({
        protocol_id,
        protocol_title: v.title,
        total: v.eligible + v.non_eligible + v.incomplet,
        eligible: v.eligible,
        non_eligible: v.non_eligible,
        incomplet: v.incomplet,
      })),
    };
  },
};

// ── Audit log API ─────────────────────────────────────────────────────────────

export const demoAuditLogs = {
  list(): AuditLog[] { return store.auditLogs; },
};
