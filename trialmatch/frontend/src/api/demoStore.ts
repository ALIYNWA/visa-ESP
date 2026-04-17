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
  MissingDataPoint, Patient, Protocol, ProtocolListItem, StudyDocument, StudyVisit,
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

// ── AVANZAR visits ────────────────────────────────────────────────────────────
const AVANZAR_VISITS: StudyVisit[] = [
  {
    id: "vv-0001-0000-0000-0000-000000000001", name: "Screening", day: -14,
    window_before: 7, window_after: 0,
    exams: [
      { id: "ve-0001", name: "Consentement éclairé", required: true },
      { id: "ve-0002", name: "Examen clinique + ECOG PS", required: true },
      { id: "ve-0003", name: "Bilan biologique (NFS, chimie, coagulation)", required: true },
      { id: "ve-0004", name: "Sérologies VHB / VHC / VIH", required: true },
      { id: "ve-0005", name: "TDM thoraco-abdomino-pelvien", required: true },
      { id: "ve-0006", name: "IRM cérébrale (ou TDM injecté)", required: true },
      { id: "ve-0007", name: "Biologie moléculaire (EGFR/ALK/ROS1/NTRK/BRAF/RET/MET)", required: true },
      { id: "ve-0008", name: "Tissu tumoral archivé FFPE", required: true },
      { id: "ve-0009", name: "PD-L1 TPS (IHC 22C3)", required: true },
      { id: "ve-0010", name: "ECG 12 dérivations", required: true },
      { id: "ve-0011", name: "Examen ophtalmologique (lampe à fente)", required: true },
    ],
  },
  {
    id: "vv-0002-0000-0000-0000-000000000001", name: "Cycle 1 — J1", day: 1,
    window_before: 0, window_after: 3,
    exams: [
      { id: "ve-0012", name: "Examen clinique + ECOG PS", required: true },
      { id: "ve-0013", name: "Bilan biologique pré-traitement", required: true },
      { id: "ve-0014", name: "Administration Dato-DXd 6 mg/kg IV", required: true },
      { id: "ve-0015", name: "Administration Durvalumab 1500 mg IV", required: true },
      { id: "ve-0016", name: "Administration Carboplatine AUC5 IV", required: true },
    ],
  },
  {
    id: "vv-0003-0000-0000-0000-000000000001", name: "Cycle 2 — J22", day: 22,
    window_before: 3, window_after: 3,
    exams: [
      { id: "ve-0017", name: "Examen clinique + ECOG PS", required: true },
      { id: "ve-0018", name: "Bilan biologique", required: true },
      { id: "ve-0019", name: "Administration Dato-DXd + Durvalumab + Carboplatine", required: true },
      { id: "ve-0020", name: "Examen ophtalmologique si symptômes", required: false },
    ],
  },
  {
    id: "vv-0004-0000-0000-0000-000000000001", name: "Évaluation J64 (après C3)", day: 64,
    window_before: 3, window_after: 3,
    exams: [
      { id: "ve-0021", name: "TDM thoraco-abdomino-pelvien (RECIST 1.1)", required: true },
      { id: "ve-0022", name: "Bilan biologique complet", required: true },
      { id: "ve-0023", name: "Examen clinique + ECOG PS", required: true },
    ],
  },
  {
    id: "vv-0005-0000-0000-0000-000000000001", name: "Fin de traitement (EOT)", day: 999,
    window_before: 7, window_after: 7,
    exams: [
      { id: "ve-0024", name: "Examen clinique complet", required: true },
      { id: "ve-0025", name: "Bilan biologique complet", required: true },
      { id: "ve-0026", name: "TDM d'évaluation finale", required: true },
      { id: "ve-0027", name: "Déclaration effets indésirables graves", required: true },
    ],
  },
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
    pathology: "Cancer bronchique non à petites cellules (CBNPC) localement avancé (stade IIIB/IIIC) ou métastatique (stade IV) sans altération génomique actionnable",
    summary: "Étude de phase III, randomisée (1:1), ouverte, multicentrique, internationale comparant le Datopotamab Deruxtecan (Dato-DXd, ADC anti-TROP2) + durvalumab + carboplatine versus pembrolizumab + chimiothérapie platine selon histologie, en 1ère ligne du CBNPC avancé sans altération génomique actionnable. Promoteur : AstraZeneca. NCT05687266.",
    promoter: "AstraZeneca",
    arc_referent: null,
    version: 1,
    is_active: true,
    created_at: now(),
    updated_at: now(),
    created_by: "00000000-0000-0000-0000-000000000001",
    criteria: AVANZAR_CRITERIA,
    objectives_primary: "Critères co-primaires :\n1. Survie sans progression (SSP) évaluée par l'investigateur selon RECIST 1.1\n2. Survie globale (SG)\nDans la population ITT complète et dans les sous-groupes histologiques (adénocarcinome / carcinome épidermoïde).",
    objectives_secondary: "• Taux de réponse objective (TRO) et durée de réponse (DR)\n• Taux de contrôle de la maladie (TCM)\n• Délai de dégradation de l'ECOG PS\n• Profil de sécurité (NCI CTCAE v5.0)\n• Qualité de vie (EORTC QLQ-C30, QLQ-LC13)\n• Pharmacocinétique de Dato-DXd",
    study_schema: "Phase III, randomisée (1:1), ouverte (open-label), multicentrique.\nStratification : histologie (adénocarcinome vs épidermoïde), PD-L1 TPS (< 1% / 1-49% / ≥ 50%), région géographique (Asie de l'Est vs reste du monde).\nBras A (expérimental) : Dato-DXd + Durvalumab + Carboplatine × 4 cycles → entretien Dato-DXd + Durvalumab.\nBras B (contrôle) : Pembrolizumab + Carboplatine + Paclitaxel/nab-Paclitaxel.",
    interventions: "Bras A (expérimental) :\n• Datopotamab Deruxtecan (Dato-DXd) 6 mg/kg IV J1 Q3W\n• Durvalumab 1500 mg IV J1 Q3W\n• Carboplatine AUC 5 IV J1 Q3W — 4 cycles max\nEntretien : Dato-DXd + Durvalumab jusqu'à progression ou toxicité inacceptable\n\nBras B (contrôle) :\n• Pembrolizumab 200 mg IV J1 Q3W\n• Carboplatine AUC 5–6 IV J1 Q3W\n• Paclitaxel 200 mg/m² ou nab-Paclitaxel 260 mg/m² IV J1 Q3W (4–6 cycles)",
    study_drugs: [
      { name: "Datopotamab Deruxtecan (Dato-DXd)", dose: "6 mg/kg", route: "IV", frequency: "J1 Q3W", notes: "ADC anti-TROP2 — AstraZeneca/Daiichi Sankyo" },
      { name: "Durvalumab", dose: "1500 mg", route: "IV", frequency: "J1 Q3W", notes: "Anti-PD-L1 — AstraZeneca" },
      { name: "Carboplatine", dose: "AUC 5", route: "IV", frequency: "J1 Q3W (4 cycles max)", notes: "Chimiothérapie platine" },
      { name: "Pembrolizumab (bras contrôle)", dose: "200 mg", route: "IV", frequency: "J1 Q3W", notes: "Anti-PD-1 — MSD" },
      { name: "Paclitaxel (bras contrôle)", dose: "200 mg/m²", route: "IV", frequency: "J1 Q3W", notes: "Ou nab-Paclitaxel 260 mg/m²" },
    ],
    authorized_meds: [
      "Corticoïdes à faible dose (≤ 10 mg/j prednisone équivalent) à visée antiémétique",
      "G-CSF prophylactique si requis",
      "Bisphosphonates ou dénosumab pour métastases osseuses",
      "Radiothérapie palliative antalgique (hors zones-cibles RECIST)",
      "Traitements des comorbidités (HTA, diabète) sans interaction documentée",
    ],
    prohibited_meds: [
      "Anti-PD-1 / anti-PD-L1 / anti-CTLA-4 en dehors du traitement de l'étude",
      "Corticoïdes systémiques immunosuppresseurs (> 10 mg/j prednisone équivalent)",
      "Immunosuppresseurs systémiques (méthotrexate, azathioprine, ciclosporine)",
      "Vaccins vivants atténués dans les 30 jours avant ou pendant le traitement",
      "Inhibiteurs puissants du CYP3A4",
    ],
    visits: AVANZAR_VISITS,
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

const SEED_PATIENT_ID  = "22222222-0000-0000-0000-000000000001";
const AVANZAR_PATIENT_ID = "22222222-0000-0000-0000-000000000002";

const SEED_PATIENTS: Patient[] = [
  {
    id: AVANZAR_PATIENT_ID,
    pseudonym: "AVANZAR-P-001",
    context: {
      age: 58,
      sexe: "F",
      diagnostic_principal: "CBNPC stade IV adénocarcinome",
      stade: "IV",
      ecog_performance_status: 1,
      traitements_en_cours: ["Carboplatine cycle 1", "Paclitaxel"],
      medicaments_concomitants: ["Prednisolone 10mg/j", "Metformine 1000mg"],
      biologie: { creatinine: "0.8 mg/dL", hb: "11.2 g/dL" },
      antecedents: ["Diabète type 2", "HTA"],
      // Intentionnellement incomplet : pas de bilan moléculaire, pas de tissu archivé,
      // pas de sérologies VHB/VHC, pas de statut métastases cérébrales → points de vigilance
      notes_libres: "",
    },
    created_by: "00000000-0000-0000-0000-000000000001",
    created_at: now(),
  },
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
      medicaments_concomitants: [],
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
      // Extended optional fields
      objectives_primary:   payload.objectives_primary   ?? undefined,
      objectives_secondary: payload.objectives_secondary ?? undefined,
      study_schema:   payload.study_schema   ?? undefined,
      interventions:  payload.interventions  ?? undefined,
      study_drugs:    payload.study_drugs    ?? undefined,
      authorized_meds: payload.authorized_meds ?? undefined,
      prohibited_meds: payload.prohibited_meds ?? undefined,
      visits:         payload.visits         ?? undefined,
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

// ── Strict criterion evaluation engine ───────────────────────────────────────
// Rule: if not explicitly documented in patient context → inconnu (never assumed satisfied)

type EvalResult = { status: "satisfait" | "non_satisfait" | "inconnu"; reasoning: string };

function evaluateCriterion(c: Criterion, ctx: NonNullable<Patient["context"]>): EvalResult {
  const t  = c.text.toLowerCase();
  const notes   = (ctx.notes_libres ?? "").toLowerCase();
  const diag    = (ctx.diagnostic_principal ?? "").toLowerCase();
  const stade   = (ctx.stade ?? "").toLowerCase();
  const trts    = (ctx.traitements_en_cours ?? []).map(x => x.toLowerCase());
  const meds    = (ctx.medicaments_concomitants ?? []).map(x => x.toLowerCase());
  const ants    = (ctx.antecedents ?? []).map(x => x.toLowerCase());
  const bio     = ctx.biologie ?? {};
  const allMeds = [...trts, ...meds];
  void ([notes, diag, stade, ...ants, ...trts, ...meds].join(" ").toLowerCase()); // contextual text reserved for future use

  // ── Âge ────────────────────────────────────────────────────────────────────
  if (t.includes("âge") || t.includes("ans ") || (t.includes("≥") && t.match(/\d+ ans/))) {
    if (ctx.age == null) return { status: "inconnu", reasoning: "Âge non renseigné dans le contexte clinique." };
    const m = t.match(/[≥>=]+\s*(\d+)/);
    if (m) {
      const min = parseInt(m[1]);
      return ctx.age >= min
        ? { status: "satisfait",     reasoning: `Patient âgé de ${ctx.age} ans ≥ ${min} ans requis.` }
        : { status: "non_satisfait", reasoning: `Patient âgé de ${ctx.age} ans — inférieur au minimum de ${min} ans.` };
    }
    return { status: "satisfait", reasoning: `Patient âgé de ${ctx.age} ans.` };
  }

  // ── ECOG Performance Status ────────────────────────────────────────────────
  if (t.includes("ecog") || t.includes("performance status") || t.includes("statut de performance")) {
    if (ctx.ecog_performance_status == null)
      return { status: "inconnu", reasoning: "ECOG Performance Status non renseigné dans le contexte clinique." };
    const ps = ctx.ecog_performance_status;
    if (t.includes("0 ou 1") || t.includes("0 or 1") || t.includes("0-1") || t.includes("0 or1")) {
      return ps <= 1
        ? { status: "satisfait",     reasoning: `ECOG PS = ${ps} (0 ou 1 requis) — critère satisfait.` }
        : { status: "non_satisfait", reasoning: `ECOG PS = ${ps} — dépasse le seuil autorisé (0 ou 1 requis).` };
    }
    const m = t.match(/[≤<=]+\s*(\d)/);
    if (m) {
      const max = parseInt(m[1]);
      return ps <= max
        ? { status: "satisfait",     reasoning: `ECOG PS = ${ps} ≤ ${max} — critère satisfait.` }
        : { status: "non_satisfait", reasoning: `ECOG PS = ${ps} — dépasse la limite autorisée (≤ ${max}).` };
    }
    return { status: "satisfait", reasoning: `ECOG PS = ${ps}.` };
  }

  // ── Diagnostic / Histologie / Stade ───────────────────────────────────────
  if (t.includes("cbnpc") || t.includes("nsclc") || t.includes("cancer bronchique") ||
      t.includes("adénocarcinome") || t.includes("carcinome épidermoïde") || t.includes("carcinome pulmonaire")) {
    const hasDiag = diag.includes("cbnpc") || diag.includes("nsclc") || diag.includes("bronchique") ||
                    diag.includes("pulmonaire") || notes.includes("cbnpc") || notes.includes("nsclc") ||
                    diag.includes("adénocarcinome") || diag.includes("carcinome");
    if (!hasDiag)
      return { status: "inconnu", reasoning: "Diagnostic histologique de CBNPC non explicitement documenté dans le contexte clinique." };
    // Stage check
    const reqStages: string[] = [];
    if (t.includes("iiib")) reqStages.push("iiib");
    if (t.includes("iiic")) reqStages.push("iiic");
    if (t.includes(" iv") || t.includes("stade iv") || t.includes("stage iv")) reqStages.push("iv");
    if (reqStages.length > 0) {
      const stageText = (stade + " " + diag + " " + notes).toLowerCase();
      const ok = reqStages.some(s => stageText.includes(s));
      if (!stade && !ok)
        return { status: "inconnu", reasoning: "Stade tumoral non renseigné dans le contexte clinique (requis : " + reqStages.map(s => s.toUpperCase()).join("/") + ")." };
      if (!ok)
        return { status: "non_satisfait", reasoning: `Stade documenté (${ctx.stade}) ne correspond pas aux stades requis (${reqStages.map(s => s.toUpperCase()).join("/")}}).` };
    }
    // Histologie mixte CBPC/sarcomatoïde (exclusion)
    if (c.type === "EXC" && (t.includes("mixte") || t.includes("sarcomatoïde"))) {
      const hasMixed = diag.includes("mixte") || diag.includes("sarcomatoïde") || notes.includes("sarcomatoïde") || notes.includes("mixte cbpc");
      return hasMixed
        ? { status: "non_satisfait", reasoning: "Histologie mixte CBPC/sarcomatoïde documentée — critère d'exclusion non satisfait." }
        : { status: "satisfait",     reasoning: `Histologie CBNPC ${diag.includes("adénocarcinome") ? "adénocarcinome" : diag.includes("épidermoïde") ? "épidermoïde" : ""} — pas de composante mixte documentée.` };
    }
    return { status: "satisfait", reasoning: `Diagnostic CBNPC documenté${ctx.stade ? " stade " + ctx.stade : ""}.` };
  }

  // ── Statut moléculaire EGFR / ALK / ROS1 / NTRK / BRAF ───────────────────
  if (t.includes("egfr") || t.includes("alk") || t.includes("ros1") || t.includes("ntrk") ||
      t.includes("braf") || t.includes("ret") || t.includes("met") ||
      t.includes("altération génomique") || t.includes("driver oncogene") || t.includes("actionnable")) {
    const hasMolData = notes.includes("egfr") || notes.includes("alk") || notes.includes("ros1") ||
                       notes.includes("ntrk") || notes.includes("braf") || notes.includes("ngs") ||
                       notes.includes("biologie moléculaire") || notes.includes("mutation") ||
                       notes.includes("séquençage") || notes.includes("négatif") || notes.includes("négatif");
    if (!hasMolData)
      return { status: "inconnu", reasoning: "Statut moléculaire (EGFR, ALK, ROS1, NTRK, BRAF, RET, MET) non renseigné. Résultats de biologie moléculaire requis dans les notes cliniques." };
    const isAbsence = t.includes("absence") || t.includes("sans") || t.includes("lacks") || t.includes("without") || t.includes("no ") || t.includes("pas de");
    if (isAbsence) {
      const hasMut = notes.includes("positif") || notes.includes("muté") || notes.includes("mutation egfr") || notes.includes("réarrangement alk") || notes.includes("+");
      return hasMut
        ? { status: "non_satisfait", reasoning: "Altération génomique actionnable détectée dans les notes — critère d'inclusion non satisfait." }
        : { status: "satisfait",     reasoning: "Absence d'altération génomique actionnable confirmée dans le bilan moléculaire." };
    }
    return { status: "satisfait", reasoning: "Données de biologie moléculaire présentes dans le contexte clinique." };
  }

  // ── Tissu tumoral archivé ─────────────────────────────────────────────────
  if (t.includes("tissu") || t.includes("archivé") || t.includes("archival") || t.includes("biopsie") || t.includes("tumoral disponible")) {
    const hasTissu = notes.includes("tissu") || notes.includes("biopsie") || notes.includes("archivé") ||
                     notes.includes("bloc") || notes.includes("ffpe") || notes.includes("paraffine");
    if (!hasTissu)
      return { status: "inconnu", reasoning: "Disponibilité du tissu tumoral archivé non documentée dans le contexte clinique. Confirmation requise." };
    return { status: "satisfait", reasoning: "Tissu tumoral archivé documenté dans les notes cliniques." };
  }

  // ── Bilan biologique / Fonction organique ─────────────────────────────────
  if (t.includes("réserve médullaire") || t.includes("bone marrow") || t.includes("bilan biologique") ||
      t.includes("fonction organique") || t.includes("organ function") || t.includes("hématologique")) {
    const hasBio = Object.keys(bio).length > 0;
    if (!hasBio)
      return { status: "inconnu", reasoning: "Bilan biologique complet non renseigné (NFS, créatinine, transaminases requis)." };
    const vals = Object.entries(bio).map(([k, v]) => `${k}: ${v}`).join(", ");
    return { status: "satisfait", reasoning: `Bilan biologique présent : ${vals}.` };
  }

  // ── Créatinine / Fonction rénale ──────────────────────────────────────────
  if (t.includes("créatinine") || t.includes("creatinine") || t.includes("rénale") || t.includes("clairance")) {
    if (!bio["creatinine"])
      return { status: "inconnu", reasoning: "Créatininémie non renseignée dans la section biologie." };
    const val = parseFloat(String(bio["creatinine"]));
    if (t.includes("1.5") && !isNaN(val)) {
      return val <= 1.5
        ? { status: "satisfait",     reasoning: `Créatinine = ${bio["creatinine"]} ≤ 1.5× LSN.` }
        : { status: "non_satisfait", reasoning: `Créatinine = ${bio["creatinine"]} > 1.5× LSN — critère non satisfait.` };
    }
    return { status: "satisfait", reasoning: `Créatinine = ${bio["creatinine"]}.` };
  }

  // ── Métastases cérébrales / Compression médullaire ────────────────────────
  if (t.includes("métastase") || t.includes("cérébral") || t.includes("brain") ||
      t.includes("compression médullaire") || t.includes("spinal cord") || t.includes("leptoméning")) {
    const hasBrainInfo = notes.includes("métastase") || notes.includes("cérébr") || notes.includes("irm") ||
                         notes.includes("scanner") || notes.includes("leptoméning") ||
                         ants.some(a => a.includes("métastase") || a.includes("cérébr"));
    if (!hasBrainInfo)
      return { status: "inconnu", reasoning: "Statut des métastases cérébrales / compression médullaire non documenté. IRM cérébrale recommandée." };
    const hasActive = notes.includes("métastase cérébrale active") || notes.includes("compression médullaire") || notes.includes("leptoméningée");
    return hasActive
      ? { status: "non_satisfait", reasoning: "Métastases cérébrales actives ou compression médullaire documentées — critère d'exclusion non satisfait." }
      : { status: "satisfait",     reasoning: "Pas de métastases cérébrales actives documentées." };
  }

  // ── Hépatites VHB / VHC ───────────────────────────────────────────────────
  if (t.includes("hépatite") || t.includes("vhb") || t.includes("vhc") || t.includes("hepatitis")) {
    const hasHepData = bio["vhb"] || bio["vhc"] || bio["AgHBs"] || bio["ARN VHC"] ||
                       notes.includes("hépatite") || notes.includes("vhb") || notes.includes("vhc");
    if (!hasHepData)
      return { status: "inconnu", reasoning: "Sérologies VHB/VHC non renseignées dans la section biologie. Dépistage obligatoire avant inclusion." };
    const hasActive = String(bio["vhb"]).toLowerCase() === "positif" || String(bio["vhc"]).toLowerCase() === "positif" || notes.includes("hépatite active") || notes.includes("vhb actif");
    return hasActive
      ? { status: "non_satisfait", reasoning: "Hépatite B ou C active documentée — critère d'exclusion non satisfait." }
      : { status: "satisfait",     reasoning: "Absence d'hépatite B/C active documentée." };
  }

  // ── Infection active (nécessitant ATB/antifongique IV) ────────────────────
  if (t.includes("infection") || t.includes("antibiotique") || t.includes("antiviral") || t.includes("antifongique") || t.includes("sepsis")) {
    const hasIVmeds = allMeds.some(m => m.includes("antibiotique") || m.includes("antibiotic") || m.includes("antifongique") || m.includes("aciclovir") || m.includes("caspofongine"));
    if (hasIVmeds)
      return { status: "non_satisfait", reasoning: `Médicament anti-infectieux IV détecté dans les traitements (${allMeds.find(m => m.includes("antibio") || m.includes("antifong"))}) — critère d'exclusion non satisfait.` };
    const hasInfection = notes.includes("infection active") || notes.includes("sepsis") || notes.includes("fièvre infectieuse");
    if (hasInfection)
      return { status: "non_satisfait", reasoning: "Infection active documentée dans les notes cliniques — critère d'exclusion non satisfait." };
    if (!notes && !allMeds.length)
      return { status: "inconnu", reasoning: "Statut infectieux et liste des médicaments IV non documentés dans le contexte clinique." };
    return { status: "satisfait", reasoning: "Pas d'infection active nécessitant traitement IV documentée." };
  }

  // ── Pneumopathie interstitielle / ILD ─────────────────────────────────────
  if (t.includes("pneumonit") || t.includes("interstitielle") || t.includes("pneumopathie") || t.includes("ild") || t.includes("fibrose pulmonaire")) {
    const hasPneumoData = ants.some(a => a.includes("pneumo") || a.includes("ild") || a.includes("fibrose") || a.includes("pulmonaire")) ||
                          notes.includes("pneumo") || notes.includes("interstitiel") || notes.includes("scanner thoracique") || notes.includes("tdm thorax");
    if (!hasPneumoData)
      return { status: "inconnu", reasoning: "Antécédents de pneumopathie interstitielle non documentés. Scanner thoracique et consultation pneumologique recommandés." };
    const hasActive = ants.some(a => a.includes("pneumopathie interstitielle") || a.includes("ild")) || notes.includes("pneumopathie interstitielle active");
    return hasActive
      ? { status: "non_satisfait", reasoning: "Pneumopathie interstitielle active documentée — critère d'exclusion non satisfait." }
      : { status: "satisfait",     reasoning: "Pas de pneumopathie interstitielle active documentée." };
  }

  // ── Maladie cornéenne ─────────────────────────────────────────────────────
  if (t.includes("cornée") || t.includes("corneal") || t.includes("ophtalmolog") || t.includes("oculaire")) {
    const hasCorneal = ants.some(a => a.includes("cornée") || a.includes("oculaire") || a.includes("ophtalmolog")) ||
                       notes.includes("cornée") || notes.includes("oculaire") || notes.includes("ophtalmolog");
    if (!hasCorneal)
      return { status: "inconnu", reasoning: "Antécédents de maladie cornéenne non documentés. Examen ophtalmologique recommandé avant inclusion." };
    const hasDisease = ants.some(a => a.includes("kératite") || a.includes("ulcère cornée")) || notes.includes("cornée pathologique");
    return hasDisease
      ? { status: "non_satisfait", reasoning: "Maladie cornéenne cliniquement significative documentée." }
      : { status: "satisfait",     reasoning: "Pas de maladie cornéenne significative documentée." };
  }

  // ── Antécédent d'un autre cancer primitif ─────────────────────────────────
  if (t.includes("malignité") || t.includes("cancer primitif") || t.includes("malignancy") || t.includes("autre cancer") || t.includes("autre primaire")) {
    if (!ants.length)
      return { status: "inconnu", reasoning: "Antécédents oncologiques non documentés. Vérification d'un cancer primitif antérieur requise." };
    const hasOtherCancer = ants.some(a =>
      (a.includes("cancer") || a.includes("carcinome") || a.includes("lymphome") || a.includes("leucémie") || a.includes("tumeur")) &&
      !a.includes("cbnpc") && !a.includes("bronchique") && !a.includes("pulmonaire")
    );
    return hasOtherCancer
      ? { status: "non_satisfait", reasoning: `Antécédent d'un autre cancer primitif documenté : ${ants.find(a => a.includes("cancer") || a.includes("carcinome"))}.` }
      : { status: "satisfait",     reasoning: "Pas d'antécédent d'un autre cancer primitif documenté dans les antécédents." };
  }

  // ── Toxicités grade > 1 des traitements antérieurs ───────────────────────
  if (t.includes("toxicité") || t.includes("toxicities") || t.includes("grade") || (t.includes("traitement antérieur") && c.type === "EXC")) {
    if (!notes)
      return { status: "inconnu", reasoning: "Toxicités résiduelles des traitements antérieurs non documentées. Évaluation clinique requise (grading CTCAE)." };
    const hasGrade2Plus = notes.includes("grade 2") || notes.includes("grade 3") || notes.includes("grade 4") || notes.includes("toxicité persistante");
    return hasGrade2Plus
      ? { status: "non_satisfait", reasoning: "Toxicités persistantes de grade ≥ 2 documentées dans les notes cliniques." }
      : { status: "satisfait",     reasoning: "Pas de toxicité persistante de grade > 1 documentée." };
  }

  // ── Médicaments concomitants interdits (vérification générique) ───────────
  if (c.type === "EXC" && (t.includes("traitement") || t.includes("thérapie") || t.includes("médicament") || t.includes("concomitant"))) {
    const prohibitedDrugs = ["pembrolizumab","nivolumab","atezolizumab","durvalumab","ipilimumab","anti-pd","pd-l1","pd-1","ctla-4","erlotinib","gefitinib","osimertinib","crizotinib","alectinib","brigatinib","lorlatinib","dabrafenib","trametinib","immunosuppresseur","corticoïde systémique","prednisone","prednisolone"];
    const flaggedMed = allMeds.find(m => prohibitedDrugs.some(d => m.includes(d)));
    if (flaggedMed) {
      // Prednisolone at low dose (≤ 10mg) may be acceptable — flag as inconnu not non_satisfait
      if (flaggedMed.includes("prednisolone") || flaggedMed.includes("prednisone")) {
        const lowDose = /[1-9]\s*mg/.test(flaggedMed) || flaggedMed.includes("10mg") || flaggedMed.includes("10 mg");
        if (lowDose)
          return { status: "inconnu", reasoning: `Corticoïde faible dose détecté (${flaggedMed}) — vérifier compatibilité selon le protocole (généralement ≤ 10mg/j prednisone équivalent autorisé).` };
      }
      return { status: "non_satisfait", reasoning: `Médicament concomitant contra-indiqué détecté : "${flaggedMed}" — critère d'exclusion non satisfait.` };
    }
    if (!allMeds.length && !notes)
      return { status: "inconnu", reasoning: "Liste des médicaments concomitants non renseignée. Vérification des contre-indications requise." };
  }

  // ── Traitement antérieur anti-PD1/PD-L1 ──────────────────────────────────
  if (t.includes("anti-pd") || t.includes("pd-l1") || t.includes("pd-1") || t.includes("immunothérapie antérieure") || t.includes("checkpoint")) {
    const hasPrior = allMeds.some(m => m.includes("pembrolizumab") || m.includes("nivolumab") || m.includes("atezolizumab") || m.includes("anti-pd") || m.includes("pd-l1")) ||
                     notes.includes("immunothérapie antérieure") || notes.includes("anti-pd");
    if (hasPrior)
      return { status: "non_satisfait", reasoning: "Traitement antérieur par anti-PD-1/PD-L1 documenté — critère d'exclusion non satisfait." };
    if (!notes && !allMeds.length)
      return { status: "inconnu", reasoning: "Traitements antérieurs non documentés. Vérifier l'absence d'immunothérapie antérieure." };
    return { status: "satisfait", reasoning: "Pas de traitement antérieur par anti-PD-1/PD-L1 documenté." };
  }

  // ── Fallback strict : inconnu si INC non évalué, satisfait si EXC sans signal d'alarme ──
  if (c.type === "INC")
    return { status: "inconnu", reasoning: `Critère d'inclusion non évaluable : données insuffisantes dans le contexte clinique pour confirmer "${c.text.slice(0, 70)}${c.text.length > 70 ? "…" : ""}".` };

  // For EXC: only flag inconnu if we truly have no context at all
  if (!notes && !allMeds.length && !ants.length)
    return { status: "inconnu", reasoning: `Critère d'exclusion non évaluable faute de données cliniques suffisantes pour "${c.text.slice(0, 70)}${c.text.length > 70 ? "…" : ""}".` };

  return { status: "satisfait", reasoning: "Aucun élément contra-indiquant ce critère d'exclusion trouvé dans le contexte clinique disponible." };
}

// ── Analysis API ──────────────────────────────────────────────────────────────

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

    const docContext  = demoDocuments.getContextForProtocol(payload.protocol_id);
    const hasDocuments = docContext.length > 0;

    // Evaluate each criterion strictly — never assumed satisfait
    const criteriaResults = protocol.criteria.map(c => {
      const { status, reasoning } = evaluateCriterion(c, ctx);
      return {
        id: uuid(), criterion_id: c.id, criterion_text: c.text, criterion_type: c.type,
        status, reasoning,
        overridden_by: null, overridden_at: null, override_note: null, override_status: null,
      };
    });

    const satisfied = criteriaResults.filter(r => r.status === "satisfait").length;
    const nonSat    = criteriaResults.filter(r => r.status === "non_satisfait").length;
    const unknown   = criteriaResults.filter(r => r.status === "inconnu").length;
    const total     = criteriaResults.length;
    const score     = Math.round((satisfied / Math.max(total, 1)) * 100);
    const finalVerdict: Analysis["verdict"] = nonSat > 0 ? "non_eligible"
                                            : unknown > 0 ? "incomplet"
                                            : "eligible";

    // Build missing data points from every inconnu criterion
    const missingDataPoints: MissingDataPoint[] = criteriaResults
      .filter(r => r.status === "inconnu")
      .map(r => ({
        criterion_id:   r.criterion_id,
        criterion_text: r.criterion_text,
        missing_field:  r.criterion_text.length > 60 ? r.criterion_text.slice(0, 57) + "…" : r.criterion_text,
        suggestion:     r.reasoning,
      }));

    // Concomitant medication warnings
    const allMeds = [...(ctx.traitements_en_cours ?? []), ...(ctx.medicaments_concomitants ?? [])];
    const medWarnings: string[] = allMeds
      .filter(m => {
        const ml = m.toLowerCase();
        return ml.includes("prednisolone") || ml.includes("prednisone") || ml.includes("corticoïde") ||
               ml.includes("méthotrexate") || ml.includes("azathioprine") || ml.includes("ciclosporine") ||
               ml.includes("immunosuppresseur");
      })
      .map(m => `Médicament concomitant à vérifier : "${m}" — peut interférer avec l'immunothérapie ou l'éligibilité`);

    const attentionPoints: string[] = [
      ...missingDataPoints.map(m => `Donnée manquante — ${m.missing_field} : ${m.suggestion}`),
      ...medWarnings,
      ...((ctx.antecedents ?? []).some(a => a.toLowerCase().includes("diabète")) ? ["Contrôle glycémique recommandé avant inclusion"] : []),
      ...((ctx.antecedents ?? []).some(a => a.toLowerCase().includes("hta")) ? ["Surveillance tensionnelle à prévoir sous traitement"] : []),
      ...(!hasDocuments ? ["Aucun document d'étude chargé — enrichir le protocole avec le document officiel pour une analyse plus précise"] : []),
    ].filter(Boolean);

    const analysis: Analysis = {
      id: uuid(),
      protocol_id: payload.protocol_id,
      protocol_version: protocol.version,
      patient_id: payload.patient_id,
      verdict: finalVerdict,
      score_pct: score,
      resume: finalVerdict === "eligible"
        ? `${patient.pseudonym} satisfait l'ensemble des ${total} critères (${satisfied} satisfaits). Éligibilité confirmée.${hasDocuments ? " (Analyse enrichie par les documents d'étude.)" : ""}`
        : finalVerdict === "non_eligible"
        ? `${patient.pseudonym} ne satisfait pas ${nonSat} critère(s) — exclusion définitive. ${unknown > 0 ? `De plus, ${unknown} critère(s) sont non évaluables.` : ""}`
        : `${unknown} critère(s) sur ${total} ne peuvent être évalués faute de données cliniques suffisantes (score partiel : ${score}% sur les critères évaluables). Vérification manuelle requise pour : ${missingDataPoints.slice(0, 3).map(m => m.missing_field).join(", ")}${missingDataPoints.length > 3 ? `… (+${missingDataPoints.length - 3} autres)` : ""}.`,
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

// ── Seed AVANZAR analysis (created after APIs are defined) ────────────────────
// Patient AVANZAR-P-001 intentionally has incomplete context to demo vigilance points
(() => {
  try {
    const avanzarAnalysis = demoAnalyses.create({
      protocol_id: AVANZAR_PROTOCOL_ID,
      patient_id:  AVANZAR_PATIENT_ID,
    });
    addAudit("create", "analysis", avanzarAnalysis.id,
      `Analyse AVANZAR seed — AVANZAR-P-001 × AVANZAR NCT05687266 → ${avanzarAnalysis.verdict} (${avanzarAnalysis.score_pct}%)`);
  } catch { /* ignore if already seeded */ }
})();
