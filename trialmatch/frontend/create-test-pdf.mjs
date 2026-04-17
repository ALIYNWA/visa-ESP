import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const lines = [
  'PROTOCOLE DE RECHERCHE CLINIQUE',
  'TITRE : TESTMATCH-001 Essai de phase II Pembrolizumab vs chimiotherapie CBNPC',
  'EudraCT : 2023-001234-11',
  'Phase II',
  'Promoteur : CHU Test Paris',
  'RESUME',
  'Etude de phase II randomisee evaluant le pembrolizumab en monotherapie CBNPC stade IV.',
  'OBJECTIF PRINCIPAL',
  'Survie sans progression SSP selon RECIST 1.1.',
  'OBJECTIFS SECONDAIRES',
  'Survie globale SG Taux de reponse objective Qualite de vie EORTC.',
  'SCHEMA DE L ETUDE',
  'Etude randomisee 1:1 ouverte multicentrique phase II.',
  'Bras A : Pembrolizumab 200 mg IV J1 Q3W',
  'Bras B : Carboplatine AUC5 Paclitaxel 175 mg/m2 IV J1 Q3W',
  'MEDICAMENTS DE L ETUDE',
  'Pembrolizumab 200 mg IV J1 Q3W anti-PD1',
  'Carboplatine AUC5 IV J1 Q3W platine',
  'Paclitaxel 175 mg/m2 IV J1 Q3W taxane',
  'CRITERES D INCLUSION',
  '1. Age superieur ou egal 18 ans au moment du screening',
  '2. CBNPC documente histologiquement stade IIIB ou IV',
  '3. Absence de mutation EGFR et de rearrangement ALK ROS1',
  '4. ECOG Performance Status 0 ou 1',
  '5. Tissu tumoral archive disponible pour biomarqueurs',
  '6. Reserve medullaire et fonctions organiques adequates',
  'CRITERES D EXCLUSION',
  '1. Traitement anterieur par anti-PD1 PD-L1 CTLA4 checkpoint',
  '2. Metastases cerebrales actives non controlees',
  '3. Infection active par le VHB ou VHC hepatite',
  '4. Maladie auto-immune active necessitant immunosuppresseur',
  '5. Toxicites grade superieur 1 traitement anterieur',
  'MEDICAMENTS AUTORISES',
  'Corticoides faible dose inferieur 10 mg/j prednisone equivalent',
  'G-CSF prophylactique si necessaire',
  'Bisphosphonates pour metastases osseuses',
  'MEDICAMENTS INTERDITS',
  'Anti-PD1 PD-L1 CTLA4 hors etude',
  'Immunosuppresseurs systemiques methotrexate azathioprine',
  'Vaccins vivants attenues 30 jours avant randomisation',
  'CALENDRIER DES VISITES',
  'Visite Screening Jour -14 consentement examen clinique bilan biologique IRM',
  'Visite 1 Jour 1 administration pembrolizumab bilan biologique ECOG',
  'Visite 2 Jour 22 cycle 2 bilan biologique examen clinique',
  'Evaluation Jour 64 scanner thoracique RECIST 1.1 bilan biologique',
  'Fin de traitement EOT examen clinique complet bilan bio scanner final',
];

let stream = '';
for (let i = 0; i < lines.length; i++) {
  const y = 800 - (i * 16);
  if (y < 30) break;
  // Remove all chars that would break PDF stream
  const safe = lines[i].replace(/[\\()]/g, '').slice(0, 100);
  stream += `BT /F1 10 Tf 40 ${y} Td (${safe}) Tj ET\n`;
}

const streamBytes = Buffer.byteLength(stream, 'utf8');
let pdf = '';
const offsets = {};

function addObj(num, content) {
  offsets[num] = Buffer.byteLength(pdf, 'utf8');
  pdf += `${num} 0 obj\n${content}\nendobj\n`;
}

addObj(1, '<</Type /Catalog /Pages 2 0 R>>');
addObj(2, '<</Type /Pages /Kids [3 0 R] /Count 1>>');
addObj(3, '<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>');
addObj(4, `<</Length ${streamBytes}>>\nstream\n${stream}\nendstream`);
addObj(5, '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>');

const xrefPos = Buffer.byteLength(pdf, 'utf8');
pdf += 'xref\n0 6\n0000000000 65535 f \n';
for (let i = 1; i <= 5; i++) {
  pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
}
pdf += `trailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;

const buf = Buffer.from(pdf, 'utf8');
const outPath = path.join(__dirname, 'public', 'test-protocol.pdf');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buf);
console.log(`PDF créé : ${outPath} (${buf.length} bytes)`);
