import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sections = [
  { text: 'PROTOCOLE DE RECHERCHE CLINIQUE', size: 12, bold: true },
  { text: 'TITRE : SERENA-4 Etude de phase III randomisee double aveugle AZD9833 camizestrant plus palbociclib versus anastrozole plus palbociclib cancer du sein ER-positif HER2-negatif avance 1ere ligne', size: 9 },
  { text: 'NCT : NCT04711252', size: 9 },
  { text: 'EudraCT : 2020-002276-12', size: 9 },
  { text: 'Phase : Phase III', size: 9 },
  { text: 'Promoteur : AstraZeneca', size: 9 },
  { text: '' },
  { text: 'RESUME', size: 10, bold: true },
  { text: 'Etude de phase III randomisee multicentrique internationale en double aveugle comparant AZD9833 camizestrant', size: 9 },
  { text: '75 mg oral SERD nouvelle generation plus palbociclib versus anastrozole plus palbociclib en 1ere ligne', size: 9 },
  { text: 'cancer du sein localement avance ou metastatique ER-positif HER2-negatif. Randomisation 1:1. N=1370 patientes.', size: 9 },
  { text: '' },
  { text: 'OBJECTIF PRINCIPAL', size: 10, bold: true },
  { text: 'Survie sans progression SSP evaluee par investigateur selon criteres RECIST version 1.1 depuis la', size: 9 },
  { text: 'randomisation jusqu a la progression de la maladie ou au deces toutes causes confondues.', size: 9 },
  { text: '' },
  { text: 'OBJECTIFS SECONDAIRES', size: 10, bold: true },
  { text: 'Survie globale SG. Survie sans progression 2 SSP2. Taux de reponse objective TRO selon RECIST 1.1.', size: 9 },
  { text: 'Duree de reponse. Delai jusqu a chimiotherapie. Qualite de vie EORTC QLQ-C30 et QLQ-BR45.', size: 9 },
  { text: '' },
  { text: 'SCHEMA DE L ETUDE', size: 10, bold: true },
  { text: 'Phase III randomisee 1:1 multicentrique internationale en double aveugle.', size: 9 },
  { text: 'Stratification : statut menopausique et presence metastases viscerales uniquement osseuses ou autres.', size: 9 },
  { text: 'Bras A experimental : AZD9833 camizestrant 75 mg PO/j + palbociclib 125 mg J1-21 Q4W + placebo anastrozole.', size: 9 },
  { text: 'Bras B comparateur : Anastrozole 1 mg PO/j + palbociclib 125 mg J1-21 Q4W + placebo AZD9833.', size: 9 },
  { text: 'Agoniste LHRH mensuel si premenopause ou homme dans les deux bras.', size: 9 },
  { text: '' },
  { text: 'MEDICAMENTS DE L ETUDE', size: 10, bold: true },
  { text: 'AZD9833 camizestrant|75 mg|oral|une fois par jour en continu', size: 9 },
  { text: 'Palbociclib|125 mg|oral|J1-21 Q4W toutes les 4 semaines', size: 9 },
  { text: 'Anastrozole|1 mg|oral|une fois par jour en continu bras controle', size: 9 },
  { text: 'Agoniste LHRH gosereline ou leuprolide|dose standard|SC|mensuel si premenopause', size: 9 },
  { text: '' },
  { text: 'CRITERES D INCLUSION', size: 10, bold: true },
  { text: '1. Femme pre perimenopausee ou homme acceptant agoniste LHRH en concomitant tout au long traitement', size: 9 },
  { text: '2. Cancer du sein ER-positif HER2-negatif confirme histologiquement ou cytologiquement', size: 9 },
  { text: '3. Maladie localement avancee non resecable ou metastatique stade IV de novo OU recidive apres minimum', size: 9 },
  { text: '   24 mois hormonotherapie adjuvante standard sans progression depuis 12 mois derniere dose inhibiteur aromatase', size: 9 },
  { text: '4. Aucun traitement systemique anticancereux anterieur pour maladie locorегionale recidivante ou metastatique', size: 9 },
  { text: '5. Maladie mesurable selon RECIST v1.1 ou au moins une lesion osseuse lytique evaluable par TDM ou IRM', size: 9 },
  { text: '6. ECOG Performance Status 0 ou 1', size: 9 },
  { text: '7. Fonctions organiques et medullaires adequates bilan biologique complet requis', size: 9 },
  { text: '8. Age superieur ou egal a 18 ans au moment de la signature du consentement eclaire', size: 9 },
  { text: '' },
  { text: 'CRITERES D EXCLUSION', size: 10, bold: true },
  { text: '1. Traitement anterieur par inhibiteur aromatase avec ou sans CDK4/6 avec recidive dans les 12 mois', size: 9 },
  { text: '2. Exposition anterieure a AZD9833 SERD investigationnels ou fulvestrant', size: 9 },
  { text: '3. Participation autre etude avec traitement investigationnel dans les 4 semaines avant randomisation', size: 9 },
  { text: '4. Atteinte viscerale symptomatique avancee a risque de crise viscerale imminente', size: 9 },
  { text: '5. Metastases cerebrales actives non controlees symptomatiques ou maladie leptomeningee', size: 9 },
  { text: '6. Maladie cardiaque symptomatique cliniquement significative', size: 9 },
  { text: '7. Grossesse confirmee par test ou allaitement en cours', size: 9 },
  { text: '8. Maladie systemique severe non controlee ou transplantation renale ou trouble hemorragique actif', size: 9 },
  { text: '9. Traitement anticancereux concomitant en dehors de l essai', size: 9 },
  { text: '10. Infection active tuberculose hepatite B ou hepatite C', size: 9 },
  { text: '' },
  { text: 'MEDICAMENTS AUTORISES', size: 10, bold: true },
  { text: 'Bisphosphonates ou denosumab pour metastases osseuses', size: 9 },
  { text: 'Corticoides a faible dose pour indication non oncologique', size: 9 },
  { text: 'Traitements des comorbidites sans interaction documentee avec palbociclib', size: 9 },
  { text: 'Antiemetiques selon protocole institutionnel', size: 9 },
  { text: '' },
  { text: 'MEDICAMENTS INTERDITS', size: 10, bold: true },
  { text: 'Inhibiteurs puissants CYP3A4 ketoconazole itraconazole clarithromycine', size: 9 },
  { text: 'Inducteurs puissants CYP3A4 rifampicine phenytoine carbamazepine millepertuis', size: 9 },
  { text: 'Hormones sexuelles replacement hormonal estrogenes androgenes progestatifs', size: 9 },
  { text: '' },
  { text: 'CALENDRIER DES VISITES', size: 10, bold: true },
  { text: 'Visite Screening Jour -28 consentement examen clinique bilan biologique TDM ECG serologies statut ER HER2 test grossesse', size: 9 },
  { text: 'Visite 1 Jour 1 randomisation initiation AZD9833 palbociclib anastrozole bilan biologique ECOG', size: 9 },
  { text: 'Visite 2 Jour 29 cycle 2 bilan biologique NFS neutropenie evaluation tolerance', size: 9 },
  { text: 'Evaluation Jour 57 TDM RECIST 1.1 bilan biologique complet qualite de vie EORTC', size: 9 },
  { text: 'Evaluation Jour 113 TDM RECIST 1.1 bilan biologique qualite de vie ctDNA optionnel', size: 9 },
  { text: 'Fin de traitement EOT examen clinique complet bilan biologique TDM final qualite de vie', size: 9 },
];

const pdfDoc = await PDFDocument.create();
const font      = await pdfDoc.embedFont(StandardFonts.Helvetica);
const fontBold  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

let page = pdfDoc.addPage([595, 842]);
const margin = 35;
let y = 800;
const lineHeight = 13;

for (const item of sections) {
  if (!item.text) { y -= 6; continue; }

  if (y < 50) {
    page = pdfDoc.addPage([595, 842]);
    y = 800;
  }

  const f    = item.bold ? fontBold : font;
  const size = item.size ?? 9;
  const text = item.text.replace(/[^\x20-\x7E]/g, '');

  page.drawText(text, {
    x: margin,
    y,
    size,
    font: f,
    color: rgb(0, 0, 0),
    maxWidth: 595 - margin * 2,
  });
  y -= lineHeight;
}

const pdfBytes = await pdfDoc.save();
const outPath  = path.join(__dirname, 'public', 'serena4-protocol.pdf');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, pdfBytes);
console.log(`PDF SERENA-4 cree avec pdf-lib : ${outPath} (${pdfBytes.length} bytes)`);
