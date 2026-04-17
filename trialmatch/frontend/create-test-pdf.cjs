// Script to generate a test protocol PDF using raw PDF format
// Run: node create-test-pdf.cjs

const fs = require('fs');
const path = require('path');

function createProtocolPDF() {
  // Protocol text content — simulates a real clinical trial PDF
  const lines = [
    "PROTOCOLE DE RECHERCHE CLINIQUE",
    "",
    "TITRE : TESTMATCH-001 — Essai de phase II du Pembrolizumab en monotherapie",
    "versus chimiotherapie dans le cancer bronchique avance",
    "",
    "EudraCT : 2023-001234-11",
    "NCT : NCT09876543",
    "Phase II",
    "Promoteur : CHU Test",
    "",
    "RESUME",
    "Etude de phase II randomisee evaluant l efficacite du pembrolizumab",
    "en monotherapie versus carboplatine plus paclitaxel chez des patients",
    "atteints d un CBNPC stade IV sans alteration genomique actionnable.",
    "",
    "OBJECTIF PRINCIPAL",
    "Survie sans progression (SSP) selon RECIST 1.1 evaluee par l investigateur.",
    "",
    "OBJECTIFS SECONDAIRES",
    "Survie globale (SG), Taux de reponse objective, Qualite de vie EORTC.",
    "",
    "SCHEMA DE L ETUDE",
    "Etude randomisee (1:1), ouverte, multicentrique, de phase II.",
    "Bras A : Pembrolizumab 200 mg IV J1 Q3W",
    "Bras B : Carboplatine AUC5 + Paclitaxel 175 mg/m2 IV J1 Q3W",
    "",
    "MEDICAMENTS DE L ETUDE",
    "Pembrolizumab 200 mg IV J1 Q3W anti-PD1 MSD",
    "Carboplatine AUC5 IV J1 Q3W chimiotherapie platine",
    "Paclitaxel 175 mg/m2 IV J1 Q3W taxane",
    "",
    "CRITERES D INCLUSION",
    "1. Age >= 18 ans au moment du screening",
    "2. CBNPC documente histologiquement stade IIIB ou IV",
    "3. Absence de mutation EGFR et de reárrangement ALK ROS1",
    "4. ECOG Performance Status 0 ou 1",
    "5. Tissu tumoral archive disponible",
    "6. Reserve medullaire et fonctions organiques adequates",
    "",
    "CRITERES D EXCLUSION",
    "1. Traitement anterieur par anti-PD1 PD-L1 CTLA4",
    "2. Metastases cerebrales actives non controlees",
    "3. Infection active par le VHB ou VHC",
    "4. Maladie auto-immune active necessitant traitement immunosuppresseur",
    "5. Toxicites grade > 1 d un traitement anterieur",
    "",
    "MEDICAMENTS AUTORISES",
    "Corticoides dose faible <= 10 mg/j prednisone equivalent",
    "G-CSF prophylactique si necessaire",
    "Bisphosphonates pour metastases osseuses",
    "",
    "MEDICAMENTS INTERDITS",
    "Anti-PD1 PD-L1 CTLA4 en dehors du traitement de l etude",
    "Immunosuppresseurs systemiques",
    "Vaccins vivants attenues",
    "",
    "CALENDRIER DES VISITES",
    "Visite Screening Jour -14 consentement examen clinique bilan bio IRm",
    "Visite 1 Jour 1 administration pembrolizumab bilan biologique ECOG",
    "Visite 2 Jour 22 administration cycle 2 bilan biologique",
    "Visite Evaluation Jour 64 scanner thoracique RECIST bilan bio",
    "Fin de traitement EOT examen clinique bilan bio scanner final",
  ];

  // Build PDF content stream
  const contentLines = lines.map((line, i) => {
    const y = 750 - (i * 14);
    if (y < 50) return ''; // skip overflow
    // Escape parentheses for PDF
    const escaped = line.replace(/\/g, '\\').replace(/\(/g, '\(').replace(/\)/g, '\)');
    if (i === 0) {
      return `BT\n/F1 14 Tf\n50 ${y} Td\n(${escaped}) Tj\nET`;
    }
    return `BT\n/F1 10 Tf\n50 ${y} Td\n(${escaped}) Tj\nET`;
  }).filter(Boolean);

  // Split into pages (50 lines per page)
  const pageSize = 50;
  const pages = [];
  for (let i = 0; i < contentLines.length; i += pageSize) {
    pages.push(contentLines.slice(i, i + pageSize).join('\n'));
  }

  let pdf = '%PDF-1.4\n%\xff\xfe\n';
  const objOffsets = [];
  let objCount = 0;

  function addObj(content) {
    objCount++;
    objOffsets.push(pdf.length);
    pdf += `${objCount} 0 obj\n${content}\nendobj\n`;
    return objCount;
  }

  // Object 1: Catalog (placeholder — we'll set it after)
  const catalogIdx = objCount + 1;
  objOffsets.push(pdf.length);
  pdf += `${objCount + 1} 0 obj\n<<>>\nendobj\n`; // placeholder
  objCount++;

  // Object 2: Pages (placeholder)
  const pagesIdx = objCount + 1;
  objOffsets.push(pdf.length);
  pdf += `${objCount + 1} 0 obj\n<<>>\nendobj\n`;
  objCount++;

  // Object 3: Font
  const fontIdx = objCount + 1;
  objOffsets.push(pdf.length);
  pdf += `${objCount + 1} 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding>>\nendobj\n`;
  objCount++;

  // Build page content objects
  const pageObjIds = [];
  for (const pageContent of pages) {
    const streamBytes = Buffer.from(pageContent, 'utf8');
    const contentIdx = objCount + 1;
    objOffsets.push(pdf.length);
    pdf += `${contentIdx} 0 obj\n<</Length ${streamBytes.length}>>\nstream\n${pageContent}\nendstream\nendobj\n`;
    objCount++;

    const pageIdx = objCount + 1;
    objOffsets.push(pdf.length);
    pdf += `${pageIdx} 0 obj\n<</Type /Page /Parent ${pagesIdx} 0 R /MediaBox [0 0 612 842] /Contents ${contentIdx} 0 R /Resources <</Font <</F1 ${fontIdx} 0 R>>>>>>\nendobj\n`;
    objCount++;
    pageObjIds.push(pageIdx);
  }

  // Now fix the catalog and pages objects by rebuilding the pdf
  // Easier: rebuild from scratch with correct references
  pdf = '%PDF-1.4\n';
  const offsets2 = [];

  function writeObj(num, content) {
    offsets2[num] = pdf.length;
    pdf += `${num} 0 obj\n${content}\nendobj\n`;
  }

  const totalObjs = 3 + pages.length * 2; // catalog + pages dict + font + (content+page)*numPages
  const fontObjNum = 3;
  let nextObj = 4;
  const contentObjNums = [];
  const pageObjNums = [];

  for (let i = 0; i < pages.length; i++) {
    contentObjNums.push(nextObj++);
    pageObjNums.push(nextObj++);
  }

  // 1: Catalog
  writeObj(1, `<</Type /Catalog /Pages 2 0 R>>`);
  // 2: Pages
  writeObj(2, `<</Type /Pages /Kids [${pageObjNums.map(n => `${n} 0 R`).join(' ')}] /Count ${pageObjNums.length}>>`);
  // 3: Font
  writeObj(3, `<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>`);

  for (let i = 0; i < pages.length; i++) {
    const content = pages[i];
    const len = Buffer.byteLength(content, 'utf8');
    writeObj(contentObjNums[i], `<</Length ${len}>>\nstream\n${content}\nendstream`);
    writeObj(pageObjNums[i], `<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents ${contentObjNums[i]} 0 R /Resources <</Font <</F1 3 0 R>>>>>>`);
  }

  // xref
  const allNums = [1, 2, 3, ...contentObjNums, ...pageObjNums];
  const maxObj = Math.max(...allNums);
  const xrefOffset = pdf.length;

  pdf += `xref\n0 ${maxObj + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= maxObj; i++) {
    const off = offsets2[i] ?? 0;
    pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<</Size ${maxObj + 1} /Root 1 0 R>>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

const pdfBuffer = createProtocolPDF();
const outPath = path.join(__dirname, 'public', 'test-protocol.pdf');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, pdfBuffer);
console.log(`PDF créé : ${outPath} (${pdfBuffer.length} bytes)`);
