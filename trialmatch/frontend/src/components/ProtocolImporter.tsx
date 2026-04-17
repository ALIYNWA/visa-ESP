/**
 * ProtocolImporter — Upload a PDF protocol and auto-fill all protocol fields.
 * Uses pdfjs-dist to extract text client-side (100% local, no external call).
 */
import { useRef, useState } from "react";
import type { CreateProtocolPayload, CriterionType, ProtocolPhase, StudyDrug, StudyVisit, StudyExam } from "@/types";

// ── PDF.js dynamic import ─────────────────────────────────────────────────────
async function extractTextFromPDF(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");

  // Use local worker bundled with pdfjs-dist (no CDN dependency — 100% on-premise)
  // Vite will resolve this as a static asset URL
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).href;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    // Disable range requests — load entire PDF at once (works with File objects)
    disableRange: true,
    disableStream: true,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Join items — preserve spacing between words
    const lineText = content.items
      .map((it: any) => {
        const str: string = it.str ?? "";
        const hasEOL: boolean = it.hasEOL ?? false;
        return hasEOL ? str + "\n" : str + " ";
      })
      .join("")
      .trim();
    pages.push(lineText);
  }
  return pages.join("\n\n");
}

// ── Text-based parser ─────────────────────────────────────────────────────────

function between(text: string, startKeywords: string[], endKeywords: string[], maxLen = 2000): string {
  const lower = text.toLowerCase();
  let start = -1;
  for (const kw of startKeywords) {
    const idx = lower.indexOf(kw.toLowerCase());
    if (idx !== -1) { start = idx; break; }
  }
  if (start === -1) return "";
  let end = text.length;
  for (const kw of endKeywords) {
    const idx = lower.indexOf(kw.toLowerCase(), start + 10);
    if (idx !== -1 && idx < end) end = idx;
  }
  return text.slice(start, Math.min(end, start + maxLen)).trim();
}

function extractSection(text: string, keywords: string[], stopKeywords: string[]): string {
  const raw = between(text, keywords, stopKeywords, 3000);
  if (!raw) return "";
  // Remove the keyword header itself
  const lines = raw.split(/\n+/).filter(Boolean);
  if (lines.length <= 1) return "";
  return lines.slice(1).join("\n").trim();
}

function extractCriteria(text: string, type: CriterionType): Array<{ type: CriterionType; text: string; order: number }> {
  const isInc = type === "INC";
  const sectionKws = isInc
    ? ["critères d'inclusion", "criteres d'inclusion", "criteres d inclusion", "critères d inclusion",
       "inclusion criteria", "critères d'eligibilit", "criteres d eligibilit",
       "criteres d'éligibilit", "critères d'éligibilit"]
    : ["critères d'exclusion", "criteres d'exclusion", "criteres d exclusion", "critères d exclusion",
       "exclusion criteria", "critères de non-inclusion", "criteres de non-inclusion"];
  const stopKws = isInc
    ? ["critères d'exclusion", "criteres d'exclusion", "criteres d exclusion", "critères d exclusion",
       "exclusion criteria"]
    : ["critères de retrait", "medicaments", "médicaments", "calendrier des visites",
       "calendrier", "statistiques", "annexe", "schema", "schéma"];

  // Use between() + handle single-line PDFs (where extractSection would return "")
  const rawBlock = between(text, sectionKws, stopKws, 4000);
  if (!rawBlock) return [];
  const blockLines = rawBlock.split(/\n+/).filter(Boolean);
  let raw: string;
  if (blockLines.length >= 2) {
    raw = blockLines.slice(1).join("\n").trim();
  } else {
    // All on one line — strip the keyword prefix
    const lower = rawBlock.toLowerCase();
    let kwEnd = -1;
    for (const kw of sectionKws) {
      const idx = lower.indexOf(kw.toLowerCase());
      if (idx !== -1) { kwEnd = idx + kw.length; break; }
    }
    raw = kwEnd !== -1 ? rawBlock.slice(kwEnd).trim() : rawBlock;
  }
  if (!raw) return [];

  // Split on numbered items: "1.", "2.", etc. even if on the same line
  // This handles PDFs where all criteria are on one long line
  const normalized = raw
    .replace(/(\d+)\.\s+/g, "\n$1. ")  // "1. " → newline before
    .replace(/\n{2,}/g, "\n");

  return normalized
    .split(/\n/)
    .map(l => l.trim())
    .filter(l => l.length > 15)
    // Remove lines that look like headers (all caps, short)
    .filter(l => !(l.length < 40 && l === l.toUpperCase()))
    // Clean numbering prefix: "1.", "1)", "-", "•"
    .map(l => l.replace(/^[\d]+[.)]\s*/, "").replace(/^[-•·]\s*/, "").trim())
    .filter(l => l.length > 15)
    .slice(0, 30)
    .map((text, i) => ({ type, text, order: i }));
}

function extractDrugs(text: string): StudyDrug[] {
  const sectionKws = [
    "médicaments de l'étude", "medicaments de l'etude",
    "medicaments de l etude", "médicaments de l etude",
    "traitement à l'étude", "traitement a l etude",
    "study drug", "investigational product", "posologie",
  ];
  const stopKws = ["critères", "criteres", "pharmacocinétique", "statistiques", "calendrier", "autorises", "autorisés"];
  // Use between() directly to get the raw block including the section header line
  const rawBlock = between(text, sectionKws, stopKws, 3000);
  if (!rawBlock) return [];
  // Remove the section keyword line prefix (first word group before a drug name)
  // Then try to get just the content; handle both multi-line and single-line PDFs
  const blockLines = rawBlock.split(/\n+/).filter(Boolean);
  // If multi-line, skip the header line; if single-line (all on one line), use the raw block
  // and strip the keyword prefix
  let raw: string;
  if (blockLines.length >= 2) {
    raw = blockLines.slice(1).join("\n").trim();
  } else {
    // Single line: strip anything up to and including the section keyword
    const lower = rawBlock.toLowerCase();
    let kwEnd = -1;
    for (const kw of sectionKws) {
      const idx = lower.indexOf(kw.toLowerCase());
      if (idx !== -1) { kwEnd = idx + kw.length; break; }
    }
    raw = kwEnd !== -1 ? rawBlock.slice(kwEnd).trim() : rawBlock;
  }
  if (!raw) return [];

  const drugs: StudyDrug[] = [];
  const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l.length > 3);

  // Global drug-pattern scan: find all occurrences in a block of text
  const drugRegex = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-]{3,}(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-]{2,})?)\s+(\d+(?:[,.]\d+)?\s*(?:mg\/m[²2]|mg\/kg|mg|µg|g|UI|AUC)\d*(?:[\-–]\d+)?)/gi;

  for (const line of lines.slice(0, 15)) {
    // Format 1: pipe-separated  Name|Dose|Route|Frequency
    if (line.includes("|")) {
      const parts = line.split("|").map(p => p.trim());
      if (parts.length >= 2 && parts[0].length > 2) {
        drugs.push({
          name: parts[0],
          dose: parts[1] || undefined,
          route: parts[2] || undefined,
          frequency: parts[3] || undefined,
        });
      }
      continue;
    }

    // Format 2: "Name Dose Route" space-separated
    drugRegex.lastIndex = 0;
    const m = drugRegex.exec(line);
    if (m) {
      const name = m[1].trim();
      const dose = m[2].trim();
      const route = /\bIV\b/.test(line) ? "IV" : /\bSC\b/.test(line) ? "SC" : /\bPO\b/i.test(line) ? "PO" : undefined;
      drugs.push({ name, dose, route });
    } else if (/[A-Z][a-z]+(?:ab|mab|nib|tinib)/i.test(line)) {
      // Fallback: drug name only (monoclonal antibody suffix pattern)
      const nameM = line.match(/[A-Za-z][a-z]+(?:ab|mab|nib|tinib)\w*/i);
      if (nameM) drugs.push({ name: nameM[0], notes: line.slice(0, 120) });
    }
  }
  // Deduplicate by name
  return drugs
    .filter((d, i, arr) => arr.findIndex(x => x.name.toLowerCase() === d.name.toLowerCase()) === i)
    .slice(0, 15);
}

function extractMedList(text: string, keywords: string[], extraStop: string[] = []): string[] {
  const raw = extractSection(text, keywords, [
    "critères", "criteres", "statistiques", "calendrier", "protocole",
    ...extraStop,
  ]);
  if (!raw) return [];
  return raw
    .split(/\n/)
    .map(l => l.trim().replace(/^[-•·\d.)]\s*/, "").trim())
    .filter(l => l.length > 3 && l.length < 200)
    .slice(0, 20);
}

function extractVisits(text: string): StudyVisit[] {
  const sectionKws = ["calendrier des visites", "calendar of events", "visite", "schéma de suivi", "tableau des visites", "synoptique"];
  const stopKws    = ["statistiques", "critères", "annexe", "pharmacocinétique", "analyses"];
  const raw = extractSection(text, sectionKws, stopKws);
  if (!raw) return [];

  // Try to identify visit rows: "Visite X — Jour Y" or "V1 J1" patterns
  const visits: StudyVisit[] = [];
  const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l.length > 3);

  for (const line of lines.slice(0, 30)) {
    const dayMatch = line.match(/(?:jour|day|j)\s*[-–]?\s*(\-?\d+)/i);
    const visitMatch = line.match(/(?:visite|visit|v)\s*(\d+)/i);
    if (visitMatch || dayMatch) {
      const visitNum = visitMatch ? parseInt(visitMatch[1]) : visits.length + 1;
      const day = dayMatch ? parseInt(dayMatch[1]) : (visitNum === 1 ? 1 : visitNum * 21);
      // Extract exams from same line or next lines
      const exams: StudyExam[] = [];
      const examTerms = ["examen clinique", "bilan bio", "nfs", "ecg", "scanner", "irm", "radiographie", "biopsie", "ecog", "consentement", "eligibilit"];
      for (const term of examTerms) {
        if (line.toLowerCase().includes(term)) {
          exams.push({ id: crypto.randomUUID(), name: term.charAt(0).toUpperCase() + term.slice(1), required: true });
        }
      }
      visits.push({
        id: crypto.randomUUID(),
        name: visitMatch ? `Visite ${visitNum}` : line.slice(0, 40).trim(),
        day,
        window_before: 3,
        window_after: 3,
        exams,
      });
    }
  }
  return visits.slice(0, 20);
}

export function parseProtocolText(text: string): Partial<CreateProtocolPayload> {
  const lower = text.toLowerCase();

  // ── Title ──
  let title = "";
  const titlePatterns = [
    // Explicit "TITRE :" prefix (most reliable)
    /(?:titre\s*:|title\s*:)\s*([^\n]{10,250})/i,
    // "STUDY TITLE" or "PROTOCOL TITLE"
    /(?:study title|protocol title|titre du protocole|titre du projet)[:\s]+([^\n]{10,250})/i,
    // Line starting with NCT or EudraCT study name pattern
    /^((?:NCT|EUDRACT)[^\n]{10,150})/m,
    // Capitalized line containing "essai" or "étude" or "study" or "trial" — but NOT "protocole de recherche"
    /^([A-ZÀÉÈÊËÂÙÛÎÏÔÇ][^\n]{15,200}(?:essai|étude|study|trial|phase\s+[IVX]+)[^\n]{0,100})$/m,
  ];
  for (const pat of titlePatterns) {
    const m = text.match(pat);
    if (m) {
      const candidate = m[1].trim().slice(0, 250);
      // Reject generic protocol headers
      if (!candidate.match(/^(de recherche|clinique|d'investigation|protocole|synopsis)/i)) {
        title = candidate;
        break;
      }
    }
  }

  // ── EudraCT ──
  const eudractM = text.match(/(?:eudract|eudraCT)[:\s]*(\d{4}-\d{6}-\d{2})/i);
  const nctM     = text.match(/NCT\d{8}/i);

  // ── Phase ──
  let phase: ProtocolPhase = "II";
  const phaseM = text.match(/phase\s*(I{1,3}V?|[1-4])\b/i);
  if (phaseM) {
    const raw = phaseM[1].toUpperCase();
    const map: Record<string, ProtocolPhase> = { "1": "I", "2": "II", "3": "III", "4": "IV", "I": "I", "II": "II", "III": "III", "IV": "IV" };
    phase = map[raw] ?? "II";
  }

  // ── Pathology ──
  // Strategy: look for explicit "Indication/Pathologie:" field first,
  // then extract from title or summary (avoid hitting criteria section)
  let pathology = "";
  // Explicit labeled field patterns
  const pathExplicitM = text.match(
    /(?:indication[s]?|pathologie|pathology|tumeur|localisation)\s*[:\-]\s*([^\n]{10,200})/i
  );
  if (pathExplicitM) {
    pathology = pathExplicitM[1].trim();
  } else {
    // Extract from summary section (before criteria keywords appear)
    const summaryForPath = text.slice(0, text.search(/critères?\s+d['']?(?:inclusion|exclusion)|inclusion criteria/i) || text.length);
    const cancerM = summaryForPath.match(/\b((?:cancer|carcinome|tumeur|CBNPC|NSCLC|CBP|lymphome|leucémie|leucemie|mélanome|melanome|sarcome|glioblastome|gliome)[^.;\n]{0,200})/i);
    if (cancerM) pathology = cancerM[0].trim().slice(0, 200);
  }

  // ── Promoter ──
  const promoterM = text.match(/(?:promoteur|sponsor|commanditaire)[:\s]+([^\n]{3,100})/i);

  // ── Summary ──
  const summaryKws = ["résumé", "synopsis", "summary", "abstract", "contexte"];
  const stopKws    = ["objectif", "critères", "schéma", "1.", "1 -"];
  const summary = extractSection(text, summaryKws, stopKws).slice(0, 1500);

  // ── Objectives ──
  const objPrimKws  = ["objectif principal", "primary objective", "objectif primaire"];
  const objSecKws   = ["objectifs secondaires", "secondary objectives", "objectifs exploratoires", "objectifs secondaires"];
  // Stop keywords include both accented and unaccented forms
  const objStop     = ["critères", "criteres", "schéma", "schema", "population", "méthodologie", "methodologie", "3."];
  const objectives_primary   = extractSection(text, objPrimKws, objSecKws.concat(objStop)).slice(0, 1000);
  const objectives_secondary = extractSection(text, objSecKws, [
    "critères", "criteres", "schéma", "schema", "population",
    "médicaments", "medicaments", "bras ", "randomis", "4.",
  ]).slice(0, 1000);

  // ── Study schema ──
  const schemaKws = [
    "schéma de l'étude", "schema de l etude", "schema de l'etude",
    "schéma de l etude", "study design", "plan d'étude", "design de l'étude",
    "plan de l etude",
  ];
  const study_schema = extractSection(text, schemaKws, [
    "critères", "criteres", "intervention", "médicaments", "medicaments", "3.", "4.",
  ]).slice(0, 1500);

  // ── Interventions ──
  const interventionKws = [
    "intervention", "bras de traitement", "traitement expérimental", "traitement experimental",
    "treatment arm", "randomisation", "bras a", "bras b",
  ];
  const interventions = extractSection(text, interventionKws, [
    "critères", "criteres", "statistiques", "médicaments", "medicaments", "4.", "5.",
  ]).slice(0, 1500);

  // ── Drugs ──
  const study_drugs = extractDrugs(text);

  // ── Authorized / Prohibited meds ──
  const authorized_meds = extractMedList(text, [
    "médicaments autorisés", "medicaments autorises",
    "traitements autorisés", "traitements autorises",
    "allowed medications", "permitted medications",
    "medicaments accompagnateurs", "traitements accompagnateurs",
  ], [
    // Stop at prohibited meds section to avoid bleeding
    "médicaments interdits", "medicaments interdits",
    "médicaments contre-indiqués", "medicaments contre-indiques",
    "prohibited medications", "forbidden medications",
  ]);
  const prohibited_meds = extractMedList(text, [
    "médicaments interdits", "medicaments interdits",
    "médicaments contre-indiqués", "medicaments contre-indiques",
    "traitements interdits", "prohibited medications",
    "forbidden medications", "médicaments non autorisés", "medicaments non autorises",
  ]);

  // ── Criteria ──
  const incCriteria = extractCriteria(text, "INC");
  const excCriteria = extractCriteria(text, "EXC").map((c, i) => ({ ...c, order: incCriteria.length + i }));
  const criteria = [...incCriteria, ...excCriteria];

  // ── Visits ──
  const visits = extractVisits(text);

  return {
    ...(title      ? { title }      : {}),
    ...(eudractM   ? { eudract_number: eudractM[1] } : nctM ? { eudract_number: nctM[0] } : {}),
    phase,
    ...(pathology  ? { pathology }  : {}),
    ...(promoterM  ? { promoter: promoterM[1].trim().slice(0, 200) } : {}),
    ...(summary    ? { summary }    : {}),
    ...(objectives_primary   ? { objectives_primary }   : {}),
    ...(objectives_secondary ? { objectives_secondary } : {}),
    ...(study_schema  ? { study_schema }  : {}),
    ...(interventions ? { interventions } : {}),
    ...(study_drugs.length   ? { study_drugs }   : {}),
    ...(authorized_meds.length ? { authorized_meds } : {}),
    ...(prohibited_meds.length ? { prohibited_meds } : {}),
    ...(criteria.length ? { criteria } : {}),
    ...(visits.length   ? { visits }   : {}),
  };
}

// ── AVANZAR demo data (simulated PDF extraction) ──────────────────────────────
export function getAVANZARDemoData(): Partial<CreateProtocolPayload> {
  const incCriteria: Array<{ type: CriterionType; text: string; order: number }> = [
    { type: "INC", order: 0,  text: "Âge ≥ 18 ans au moment du screening" },
    { type: "INC", order: 1,  text: "CBNPC documenté histologiquement ou cytologiquement, stade IIIB, IIIC (non éligible à la résection chirurgicale ou à la chimioradiation définitive) ou stade IV métastatique" },
    { type: "INC", order: 2,  text: "Absence de mutation EGFR sensibilisante, réarrangement ALK et ROS1 ; absence d'altérations oncogéniques actionnables documentées (NTRK, BRAF, RET, MET) avec thérapies approuvées" },
    { type: "INC", order: 3,  text: "ECOG Performance Status 0 ou 1" },
    { type: "INC", order: 4,  text: "Tissu tumoral archivé disponible pour analyse des biomarqueurs (bloc FFPE ou lames)" },
    { type: "INC", order: 5,  text: "Réserve médullaire et fonctions organiques adéquates : NFS, créatinine, bilan hépatique dans les 7 jours avant la randomisation" },
    { type: "INC", order: 6,  text: "Espérance de vie ≥ 12 semaines" },
    { type: "EXC", order: 7,  text: "Histologie mixte CBPC/CBNPC ou variant sarcomatoïde" },
    { type: "EXC", order: 8,  text: "Antécédent d'un autre cancer primitif actif (sauf carcinome in situ, cancer de la peau non mélanocytaire ou cancer traité et en rémission depuis ≥ 5 ans)" },
    { type: "EXC", order: 9,  text: "Toxicités persistantes de grade > 1 liées à un traitement anticancéreux antérieur (sauf alopécie, neuropathie ≤ grade 2)" },
    { type: "EXC", order: 10, text: "Compression médullaire ou métastases cérébrales actives non traitées ou symptomatiques" },
    { type: "EXC", order: 11, text: "Antécédent de carcinomatose leptoméningée" },
    { type: "EXC", order: 12, text: "Infection active ou non contrôlée par le VHB (AgHBs positif) ou VHC (ARN VHC détectable)" },
    { type: "EXC", order: 13, text: "Infection systémique nécessitant des antibiotiques, antiviraux ou antifongiques IV à la randomisation" },
    { type: "EXC", order: 14, text: "Maladie cornéenne cliniquement significative (kératite, syndrome de l'œil sec sévère, kératocône, antécédent de chirurgie réfractive cornéenne)" },
    { type: "EXC", order: 15, text: "Pneumopathie interstitielle/pneumonite non infectieuse nécessitant des corticoïdes, pneumopathie interstitielle actuelle ou suspectée" },
    { type: "EXC", order: 16, text: "Traitement antérieur par anti-PD-1, anti-PD-L1, anti-CTLA-4 ou autre immunothérapie de point de contrôle" },
    { type: "EXC", order: 17, text: "Traitement par corticoïdes systémiques (> 10 mg/j de prednisone équivalent) ou autre immunosuppresseur systémique dans les 14 jours avant la randomisation" },
  ];

  const visits: StudyVisit[] = [
    {
      id: crypto.randomUUID(), name: "Screening", day: -14, window_before: 7, window_after: 0,
      exams: [
        { id: crypto.randomUUID(), name: "Consentement éclairé", required: true },
        { id: crypto.randomUUID(), name: "Examen clinique complet + ECOG PS", required: true },
        { id: crypto.randomUUID(), name: "Bilan biologique (NFS, chimie, coagulation)", required: true },
        { id: crypto.randomUUID(), name: "Sérologies VHB/VHC/VIH", required: true },
        { id: crypto.randomUUID(), name: "TDM thoraco-abdomino-pelvien", required: true },
        { id: crypto.randomUUID(), name: "IRM cérébrale (ou TDM avec injection)", required: true },
        { id: crypto.randomUUID(), name: "Biologie moléculaire tumorale (EGFR/ALK/ROS1/NTRK/BRAF/RET/MET)", required: true },
        { id: crypto.randomUUID(), name: "Tissu tumoral archivé (FFPE)", required: true },
        { id: crypto.randomUUID(), name: "PD-L1 TPS par IHC (22C3)", required: true },
        { id: crypto.randomUUID(), name: "ECG 12 dérivations", required: true },
        { id: crypto.randomUUID(), name: "Examen ophtalmologique (lampe à fente)", required: true },
      ],
    },
    {
      id: crypto.randomUUID(), name: "Cycle 1 — J1", day: 1, window_before: 0, window_after: 3,
      exams: [
        { id: crypto.randomUUID(), name: "Examen clinique + ECOG PS", required: true },
        { id: crypto.randomUUID(), name: "Bilan biologique pré-traitement", required: true },
        { id: crypto.randomUUID(), name: "Administration Dato-DXd 6 mg/kg IV", required: true },
        { id: crypto.randomUUID(), name: "Administration Durvalumab 1500 mg IV", required: true },
        { id: crypto.randomUUID(), name: "Administration Carboplatine AUC5 IV", required: true },
        { id: crypto.randomUUID(), name: "Recueil des effets indésirables", required: true },
      ],
    },
    {
      id: crypto.randomUUID(), name: "Cycle 2 — J22", day: 22, window_before: 3, window_after: 3,
      exams: [
        { id: crypto.randomUUID(), name: "Examen clinique + ECOG PS", required: true },
        { id: crypto.randomUUID(), name: "Bilan biologique", required: true },
        { id: crypto.randomUUID(), name: "Administration Dato-DXd + Durvalumab + Carboplatine", required: true },
        { id: crypto.randomUUID(), name: "Examen ophtalmologique (si symptômes)", required: false },
      ],
    },
    {
      id: crypto.randomUUID(), name: "Cycle 3 — J43", day: 43, window_before: 3, window_after: 3,
      exams: [
        { id: crypto.randomUUID(), name: "Examen clinique + ECOG PS", required: true },
        { id: crypto.randomUUID(), name: "Bilan biologique", required: true },
        { id: crypto.randomUUID(), name: "TDM d'évaluation (après cycle 2)", required: true },
        { id: crypto.randomUUID(), name: "Administration Dato-DXd + Durvalumab + Carboplatine", required: true },
      ],
    },
    {
      id: crypto.randomUUID(), name: "Évaluation J64 (après C3)", day: 64, window_before: 3, window_after: 3,
      exams: [
        { id: crypto.randomUUID(), name: "TDM thoraco-abdomino-pelvien (évaluation de réponse RECIST 1.1)", required: true },
        { id: crypto.randomUUID(), name: "Bilan biologique complet", required: true },
        { id: crypto.randomUUID(), name: "Examen clinique + ECOG PS", required: true },
      ],
    },
    {
      id: crypto.randomUUID(), name: "Fin de traitement", day: 999, window_before: 7, window_after: 7,
      exams: [
        { id: crypto.randomUUID(), name: "Examen clinique complet", required: true },
        { id: crypto.randomUUID(), name: "Bilan biologique complet", required: true },
        { id: crypto.randomUUID(), name: "TDM d'évaluation finale", required: true },
        { id: crypto.randomUUID(), name: "Déclaration effets indésirables graves", required: true },
        { id: crypto.randomUUID(), name: "Prélèvement biologique pour pharmacocinétique", required: false },
      ],
    },
    {
      id: crypto.randomUUID(), name: "Suivi survie — Mois 3", day: 90, window_before: 7, window_after: 7,
      exams: [
        { id: crypto.randomUUID(), name: "Contact téléphonique ou visite clinique", required: true },
        { id: crypto.randomUUID(), name: "Recueil statut vital et traitements ultérieurs", required: true },
      ],
    },
  ];

  return {
    title: "AVANZAR — Dato-DXd + Durvalumab + Carboplatine versus Pembrolizumab en 1ère ligne CBNPC avancé sans altération génomique actionnable",
    eudract_number: "2021-004606-21",
    phase: "III",
    pathology: "Cancer bronchique non à petites cellules (CBNPC) localement avancé (stade IIIB/IIIC) ou métastatique (stade IV) sans altération génomique actionnable",
    promoter: "AstraZeneca",
    summary: "Étude de phase III, randomisée, ouverte, multicentrique, internationale comparant le Datopotamab Deruxtecan (Dato-DXd, anticorps-médicament conjugué anti-TROP2) en association avec le durvalumab (anti-PD-L1) et le carboplatine versus le pembrolizumab en association avec une chimiothérapie à base de platine selon l'histologie. Population : adultes, CBNPC stade IIIB/IIIC/IV, sans altération génomique actionnable (EGFR/ALK/ROS1/NTRK/BRAF/RET/MET négatifs). NCT05687266 — EudraCT 2021-004606-21.",
    objectives_primary: "Critère principal de jugement co-primaire :\n1. Survie sans progression (SSP) évaluée par l'investigateur selon les critères RECIST 1.1\n2. Survie globale (SG)\nDans la population en intention de traiter (ITT) complète et dans les sous-groupes histologiques (adénocarcinome / carcinome épidermoïde).",
    objectives_secondary: "Critères secondaires :\n- Taux de réponse objective (TRO) selon RECIST 1.1\n- Durée de réponse (DR)\n- Taux de contrôle de la maladie (TCM)\n- Délai jusqu'à dégradation de l'ECOG PS\n- Profil de sécurité et tolérance (NCI CTCAE v5.0)\n- Qualité de vie (EORTC QLQ-C30, QLQ-LC13)\n- Pharmacocinétique de Dato-DXd",
    study_schema: "Essai de phase III, randomisé (1:1), ouvert (open-label), multicentrique, international.\nStratification : histologie (adénocarcinome vs carcinome épidermoïde), statut PD-L1 (TPS < 1% vs ≥ 1% à < 50% vs ≥ 50%), région géographique (Asie de l'Est vs reste du monde).\nBras A : Dato-DXd + Durvalumab + Carboplatine (4 cycles) puis Dato-DXd + Durvalumab en entretien.\nBras B : Pembrolizumab + Carboplatine + Paclitaxel/nab-Paclitaxel (adénocarcinome) ou Pembrolizumab + Carboplatine + Paclitaxel/nab-Paclitaxel/Pemetrexed (épidermoïde).",
    interventions: "Bras expérimental (A) :\n• Datopotamab Deruxtecan (Dato-DXd) : 6 mg/kg IV J1 Q3W\n• Durvalumab : 1500 mg IV J1 Q3W\n• Carboplatine : AUC 5 IV J1 Q3W — 4 cycles maximum\nPhase d'entretien : Dato-DXd + Durvalumab jusqu'à progression ou toxicité inacceptable.\n\nBras contrôle (B) :\n• Pembrolizumab : 200 mg IV J1 Q3W\n• Carboplatine : AUC 5–6 IV J1 Q3W\n• Paclitaxel 200 mg/m² ou nab-Paclitaxel 260 mg/m² IV J1 Q3W — 4–6 cycles\nEntretien : Pembrolizumab seul (adénocarcinome avec pemetrexed).",
    study_drugs: [
      { name: "Datopotamab Deruxtecan (Dato-DXd)", dose: "6 mg/kg", route: "IV", frequency: "J1 Q3W (toutes les 3 semaines)", notes: "Anticorps-médicament conjugué anti-TROP2 — AstraZeneca/Daiichi Sankyo" },
      { name: "Durvalumab", dose: "1500 mg", route: "IV", frequency: "J1 Q3W", notes: "Anti-PD-L1 — AstraZeneca" },
      { name: "Carboplatine", dose: "AUC 5", route: "IV", frequency: "J1 Q3W — 4 cycles max", notes: "Chimiothérapie à base de platine" },
      { name: "Pembrolizumab (bras contrôle)", dose: "200 mg", route: "IV", frequency: "J1 Q3W", notes: "Anti-PD-1 — MSD/Merck" },
      { name: "Paclitaxel ou nab-Paclitaxel (bras contrôle)", dose: "200 mg/m² ou 260 mg/m²", route: "IV", frequency: "J1 Q3W", notes: "Histologie épidermoïde ou adénocarcinome" },
    ],
    authorized_meds: [
      "Corticoïdes à faible dose (≤ 10 mg/j prednisone équivalent) à visée antiémétique ou autre",
      "Traitement antiémétique de support selon les recommandations institutionnelles",
      "Facteurs de croissance hématopoïétiques (G-CSF) à titre prophylactique si requis",
      "Antalgiques palier I/II selon douleur",
      "Bisphosphonates ou dénosumab pour métastases osseuses",
      "Radiothérapie palliative à visée antalgique (hors zones-cibles évaluables RECIST)",
      "Traitements des comorbidités (HTA, diabète, etc.) sous réserve d'absence d'interaction",
    ],
    prohibited_meds: [
      "Tout autre immunothérapie de point de contrôle (anti-PD-1, anti-PD-L1, anti-CTLA-4) en dehors du traitement de l'étude",
      "Corticoïdes systémiques à dose immunosuppressive (> 10 mg/j prednisone équivalent) sauf prémédication courte durée",
      "Immunosuppresseurs systémiques (méthotrexate, azathioprine, ciclosporine, mycophénolate)",
      "Vaccins vivants atténués dans les 30 jours avant ou pendant le traitement",
      "Toute autre chimiothérapie ou thérapie ciblée concomitante non prévue par le protocole",
      "Inhibiteurs puissants du CYP3A4 (interaction avec Dato-DXd)",
      "Médicaments allongeant l'intervalle QT en cas d'anomalie ECG documentée",
    ],
    criteria: incCriteria,
    visits,
  };
}

// ── UI Component ──────────────────────────────────────────────────────────────

interface Props {
  onImport: (data: Partial<CreateProtocolPayload>) => void;
  onClose: () => void;
}

export function ProtocolImporter({ onImport, onClose }: Props) {
  const fileRef  = useRef<HTMLInputElement>(null);
  const [step, setStep]       = useState<"idle" | "parsing" | "preview" | "error">("idle");
  const [progress, setProgress] = useState("");
  const [parsed, setParsed]   = useState<Partial<CreateProtocolPayload> | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStep("parsing");
    setProgress("Extraction du texte depuis le PDF…");
    try {
      const text = await extractTextFromPDF(file);
      setProgress("Analyse du contenu…");
      await new Promise(r => setTimeout(r, 200));
      const result = parseProtocolText(text);
      setProgress("Finalisation…");
      await new Promise(r => setTimeout(r, 150));
      setParsed(result);
      setStep("preview");
    } catch (err) {
      setErrorMsg(String(err));
      setStep("error");
    }
  }

  function loadAVANZARDemo() {
    setParsed(getAVANZARDemoData());
    setStep("preview");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
         style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="rounded-2xl shadow-2xl fade-up flex flex-col"
           style={{
             background: "#0a1628",
             border: "1px solid rgba(99,102,241,0.3)",
             width: "min(860px, 96vw)",
             maxHeight: "90vh",
           }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0"
             style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                 style={{ background: "rgba(99,102,241,0.2)" }}>
              <svg width="16" height="16" fill="none" stroke="#818cf8" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: "#f1f5f9" }}>
                Import automatique depuis PDF
              </h2>
              <p className="text-xs" style={{ color: "#475569" }}>
                Extraction 100% locale — aucune donnée envoyée à l'extérieur
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg transition-colors"
                  style={{ color: "#475569" }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-5">
          {step === "idle" && (
            <>
              {/* Upload zone */}
              <div
                onClick={() => fileRef.current?.click()}
                className="rounded-2xl p-8 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all"
                style={{
                  border: "2px dashed rgba(99,102,241,0.3)",
                  background: "rgba(99,102,241,0.04)",
                }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f && fileRef.current) {
                    const dt = new DataTransfer();
                    dt.items.add(f);
                    fileRef.current.files = dt.files;
                    fileRef.current.dispatchEvent(new Event("change", { bubbles: true }));
                  }
                }}
              >
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                     style={{ background: "rgba(99,102,241,0.15)" }}>
                  <svg width="26" height="26" fill="none" stroke="#818cf8" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>
                    Déposer un fichier PDF ici
                  </p>
                  <p className="text-xs mt-1" style={{ color: "#475569" }}>
                    ou cliquez pour parcourir — formats supportés : PDF
                  </p>
                </div>
                <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFile} />
              </div>

              {/* Separator */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                <span className="text-xs" style={{ color: "#334155" }}>ou</span>
                <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              </div>

              {/* Demo button */}
              <button
                onClick={loadAVANZARDemo}
                className="w-full rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-all"
                style={{ background: "rgba(14,165,233,0.1)", color: "#38bdf8", border: "1px solid rgba(14,165,233,0.25)" }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Charger le protocole AVANZAR (NCT05687266) — démo
              </button>

              {/* Info */}
              <div className="rounded-xl p-4 space-y-1.5"
                   style={{ background: "rgba(14,165,233,0.05)", border: "1px solid rgba(14,165,233,0.12)" }}>
                <p className="text-xs font-semibold" style={{ color: "#38bdf8" }}>Champs extraits automatiquement</p>
                {[
                  "Identification : titre, numéro EudraCT/NCT, phase, promoteur",
                  "Objectifs principal et secondaires",
                  "Schéma de l'étude et interventions",
                  "Médicaments étudiés avec doses et voies d'administration",
                  "Médicaments autorisés et contre-indiqués",
                  "Critères d'inclusion et d'exclusion (liste numérotée)",
                  "Calendrier des visites et examens à chaque visite",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span style={{ color: "#0ea5e9" }}>✓</span>
                    <span className="text-xs" style={{ color: "#64748b" }}>{item}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === "parsing" && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-12 h-12 rounded-full border-2 border-t-indigo-400 animate-spin"
                   style={{ borderColor: "rgba(99,102,241,0.2)", borderTopColor: "#818cf8" }} />
              <p className="text-sm font-medium" style={{ color: "#e2e8f0" }}>Analyse en cours…</p>
              <p className="text-xs" style={{ color: "#475569" }}>{progress}</p>
            </div>
          )}

          {step === "error" && (
            <div className="rounded-xl p-5" style={{ background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)" }}>
              <p className="text-sm font-semibold" style={{ color: "#fb7185" }}>Erreur lors de l'analyse du PDF</p>
              <p className="text-xs mt-1" style={{ color: "#f43f5e" }}>{errorMsg}</p>
              <button onClick={() => setStep("idle")} className="mt-3 text-xs px-3 py-1.5 rounded-lg"
                      style={{ background: "rgba(244,63,94,0.15)", color: "#fb7185" }}>
                Réessayer
              </button>
            </div>
          )}

          {step === "preview" && parsed && (
            <PreviewPanel parsed={parsed} onConfirm={() => { onImport(parsed); onClose(); }} onBack={() => setStep("idle")} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Preview Panel ─────────────────────────────────────────────────────────────

function PreviewPanel({ parsed, onConfirm, onBack }: {
  parsed: Partial<CreateProtocolPayload>;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const inc = (parsed.criteria ?? []).filter(c => c.type === "INC");
  const exc = (parsed.criteria ?? []).filter(c => c.type === "EXC");

  function Field({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null;
    return (
      <div>
        <p className="text-xs font-medium mb-1" style={{ color: "#64748b" }}>{label}</p>
        <p className="text-sm leading-relaxed" style={{ color: "#cbd5e1" }}>{value}</p>
      </div>
    );
  }

  function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div className="rounded-xl p-4 space-y-3"
           style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#475569" }}>{title}</p>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className="rounded-xl px-4 py-3 flex items-center gap-3"
           style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
        <svg width="14" height="14" fill="none" stroke="#34d399" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div className="flex gap-4 text-xs" style={{ color: "#34d399" }}>
          <span>Titre : {parsed.title ? "✓" : "—"}</span>
          <span>Critères : {(parsed.criteria ?? []).length} ({inc.length} INC / {exc.length} EXC)</span>
          <span>Médicaments : {(parsed.study_drugs ?? []).length}</span>
          <span>Visites : {(parsed.visits ?? []).length}</span>
        </div>
      </div>

      {/* Identification */}
      <Section title="Identification du protocole">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Titre" value={parsed.title} />
          <Field label="EudraCT / NCT" value={parsed.eudract_number} />
          <Field label="Phase" value={parsed.phase ? `Phase ${parsed.phase}` : undefined} />
          <Field label="Pathologie / Indication" value={parsed.pathology} />
          <Field label="Promoteur" value={parsed.promoter} />
        </div>
      </Section>

      {/* Objectives */}
      {(parsed.objectives_primary || parsed.objectives_secondary) && (
        <Section title="Objectifs">
          <Field label="Objectif principal" value={parsed.objectives_primary} />
          <Field label="Objectifs secondaires" value={parsed.objectives_secondary} />
        </Section>
      )}

      {/* Study schema */}
      {(parsed.study_schema || parsed.interventions) && (
        <Section title="Schéma & Interventions">
          <Field label="Schéma de l'étude" value={parsed.study_schema} />
          <Field label="Interventions" value={parsed.interventions} />
        </Section>
      )}

      {/* Drugs */}
      {(parsed.study_drugs ?? []).length > 0 && (
        <Section title={`Médicaments étudiés (${parsed.study_drugs!.length})`}>
          <div className="space-y-2">
            {parsed.study_drugs!.map((d, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2"
                   style={{ background: "rgba(99,102,241,0.08)" }}>
                <span className="text-xs font-semibold mt-0.5" style={{ color: "#818cf8", minWidth: "100px" }}>{d.name}</span>
                <span className="text-xs" style={{ color: "#94a3b8" }}>
                  {[d.dose, d.route, d.frequency].filter(Boolean).join(" · ")}
                  {d.notes && <span style={{ color: "#475569" }}> — {d.notes}</span>}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Meds */}
      {((parsed.authorized_meds ?? []).length > 0 || (parsed.prohibited_meds ?? []).length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {(parsed.authorized_meds ?? []).length > 0 && (
            <Section title={`Médicaments autorisés (${parsed.authorized_meds!.length})`}>
              <ul className="space-y-1">
                {parsed.authorized_meds!.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "#34d399" }}>
                    <span className="mt-0.5">✓</span><span style={{ color: "#94a3b8" }}>{m}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {(parsed.prohibited_meds ?? []).length > 0 && (
            <Section title={`Médicaments interdits (${parsed.prohibited_meds!.length})`}>
              <ul className="space-y-1">
                {parsed.prohibited_meds!.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "#fb7185" }}>
                    <span className="mt-0.5">✗</span><span style={{ color: "#94a3b8" }}>{m}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      {/* Criteria preview */}
      {(parsed.criteria ?? []).length > 0 && (
        <Section title={`Critères extraits (${parsed.criteria!.length})`}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "#818cf8" }}>Inclusion ({inc.length})</p>
              <ul className="space-y-1.5">
                {inc.slice(0, 8).map((c, i) => (
                  <li key={i} className="text-xs leading-snug" style={{ color: "#94a3b8" }}>
                    <span style={{ color: "#818cf8" }}>{i + 1}.</span> {c.text}
                  </li>
                ))}
                {inc.length > 8 && <li className="text-xs" style={{ color: "#475569" }}>+ {inc.length - 8} autres…</li>}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "#fb923c" }}>Exclusion ({exc.length})</p>
              <ul className="space-y-1.5">
                {exc.slice(0, 8).map((c, i) => (
                  <li key={i} className="text-xs leading-snug" style={{ color: "#94a3b8" }}>
                    <span style={{ color: "#fb923c" }}>{i + 1}.</span> {c.text}
                  </li>
                ))}
                {exc.length > 8 && <li className="text-xs" style={{ color: "#475569" }}>+ {exc.length - 8} autres…</li>}
              </ul>
            </div>
          </div>
        </Section>
      )}

      {/* Visits preview */}
      {(parsed.visits ?? []).length > 0 && (
        <Section title={`Calendrier des visites (${parsed.visits!.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["Visite", "Jour", "Fenêtre", "Examens"].map(h => (
                    <th key={h} className="text-left pb-2 pr-4 font-medium" style={{ color: "#475569" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.visits!.map((v, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td className="py-2 pr-4 font-medium" style={{ color: "#cbd5e1" }}>{v.name}</td>
                    <td className="py-2 pr-4 font-mono" style={{ color: "#38bdf8" }}>
                      {v.day === 999 ? "EOT" : `J${v.day}`}
                    </td>
                    <td className="py-2 pr-4" style={{ color: "#475569" }}>
                      {v.window_before != null ? `-${v.window_before}/+${v.window_after ?? 0}j` : "—"}
                    </td>
                    <td className="py-2" style={{ color: "#64748b" }}>
                      {v.exams.slice(0, 3).map(e => e.name).join(", ")}
                      {v.exams.length > 3 && <span style={{ color: "#334155" }}> +{v.exams.length - 3}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button onClick={onConfirm}
                className="flex-1 rounded-xl py-3 text-sm font-semibold text-white transition-all"
                style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)", boxShadow: "0 0 20px rgba(99,102,241,0.3)" }}>
          Importer dans le formulaire
        </button>
        <button onClick={onBack}
                className="px-6 rounded-xl py-3 text-sm font-medium transition-colors"
                style={{ background: "rgba(255,255,255,0.04)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
          Retour
        </button>
      </div>
    </div>
  );
}
