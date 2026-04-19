/**
 * ProtocolDocumentImporter
 * Documents tab — "Protocole" rubric: upload a PDF and auto-configure all fields.
 * Keeps DocumentManager below for other files.
 */
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { protocolsApi } from "@/api/protocols";
import { DocumentManager } from "@/components/DocumentManager";
import { extractTextFromPDF, parseProtocolText, getAVANZARDemoData } from "@/components/ProtocolImporter";
import type { Protocol, CreateProtocolPayload, StudyDrug, StudyVisit } from "@/types";

interface Props {
  protocol: Protocol;
  onUpdated: (p: Protocol) => void;
}

type Status = "idle" | "extracting" | "preview" | "applying" | "done" | "error";

// ─── Small helpers ────────────────────────────────────────────────────────────

function SectionRow({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-2 border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
      <span className="text-xs shrink-0 font-medium w-36" style={{ color: "#475569" }}>{label}</span>
      <span className="text-xs flex-1" style={{ color: "#cbd5e1" }}>{value.slice(0, 200)}{value.length > 200 ? "…" : ""}</span>
    </div>
  );
}

function CountChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
          style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
      {count} {label}
    </span>
  );
}

// ─── Preview Panel ────────────────────────────────────────────────────────────

function ParsedPreview({ data }: { data: Partial<CreateProtocolPayload> }) {
  const criteria = (data.criteria ?? []);
  const inc = criteria.filter(c => c.type === "INC");
  const exc = criteria.filter(c => c.type === "EXC");
  const drugs: StudyDrug[] = (data.study_drugs ?? []);
  const visits: StudyVisit[] = (data.visits ?? []);

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {data.title    && <CountChip label="titre" count={1}            color="#818cf8" />}
        {data.phase    && <CountChip label="phase" count={1}            color="#38bdf8" />}
        {inc.length > 0 && <CountChip label="critères INC" count={inc.length} color="#34d399" />}
        {exc.length > 0 && <CountChip label="critères EXC" count={exc.length} color="#fb7185" />}
        {drugs.length > 0 && <CountChip label="médicaments"  count={drugs.length} color="#a78bfa" />}
        {visits.length > 0 && <CountChip label="visites"     count={visits.length} color="#2dd4bf" />}
        {(data.authorized_meds?.length ?? 0) > 0 && <CountChip label="méds autorisés"  count={data.authorized_meds!.length} color="#34d399" />}
        {(data.prohibited_meds?.length ?? 0) > 0 && <CountChip label="méds interdits"  count={data.prohibited_meds!.length} color="#fb7185" />}
      </div>

      {/* Fields */}
      <div className="rounded-xl overflow-hidden"
           style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="px-4 py-2.5" style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#475569" }}>Identification</p>
        </div>
        <div className="px-4 py-1">
          <SectionRow label="Titre"       value={data.title} />
          <SectionRow label="EudraCT/NCT" value={data.eudract_number} />
          <SectionRow label="Phase"       value={data.phase ? `Phase ${data.phase}` : undefined} />
          <SectionRow label="Pathologie"  value={data.pathology} />
          <SectionRow label="Promoteur"   value={data.promoter} />
          <SectionRow label="Résumé"      value={data.summary} />
        </div>
      </div>

      {(data.objectives_primary || data.objectives_secondary || data.study_schema) && (
        <div className="rounded-xl overflow-hidden"
             style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-4 py-2.5" style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#475569" }}>Objectifs & Schéma</p>
          </div>
          <div className="px-4 py-1">
            <SectionRow label="Objectif principal"    value={data.objectives_primary} />
            <SectionRow label="Objectifs secondaires" value={data.objectives_secondary} />
            <SectionRow label="Schéma de l'étude"     value={data.study_schema} />
            <SectionRow label="Interventions"         value={data.interventions} />
          </div>
        </div>
      )}

      {drugs.length > 0 && (
        <div className="rounded-xl overflow-hidden"
             style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-4 py-2.5" style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#a78bfa" }}>
              Médicaments étudiés ({drugs.length})
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            {drugs.map((d, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2">
                <span className="text-xs font-medium w-32 shrink-0" style={{ color: "#a78bfa" }}>{d.name}</span>
                <span className="text-xs" style={{ color: "#94a3b8" }}>
                  {[d.dose, d.route, d.frequency].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(inc.length > 0 || exc.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {inc.length > 0 && (
            <div className="rounded-xl overflow-hidden"
                 style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.12)" }}>
              <div className="px-4 py-2.5" style={{ background: "rgba(16,185,129,0.06)", borderBottom: "1px solid rgba(16,185,129,0.1)" }}>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#34d399" }}>
                  Inclusion ({inc.length})
                </p>
              </div>
              <ul className="px-4 py-2 space-y-1.5">
                {inc.map((c, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span style={{ color: "#34d399", minWidth: "14px" }}>{i + 1}.</span>
                    <span style={{ color: "#94a3b8" }}>{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {exc.length > 0 && (
            <div className="rounded-xl overflow-hidden"
                 style={{ background: "rgba(244,63,94,0.04)", border: "1px solid rgba(244,63,94,0.12)" }}>
              <div className="px-4 py-2.5" style={{ background: "rgba(244,63,94,0.06)", borderBottom: "1px solid rgba(244,63,94,0.1)" }}>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#fb7185" }}>
                  Exclusion ({exc.length})
                </p>
              </div>
              <ul className="px-4 py-2 space-y-1.5">
                {exc.map((c, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <span style={{ color: "#fb7185", minWidth: "14px" }}>{i + 1}.</span>
                    <span style={{ color: "#94a3b8" }}>{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {visits.length > 0 && (
        <div className="rounded-xl overflow-hidden"
             style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="px-4 py-2.5" style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#2dd4bf" }}>
              Calendrier des visites ({visits.length})
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            {visits.map((v, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-2 text-xs">
                <span className="font-mono w-8 shrink-0" style={{ color: "#2dd4bf" }}>
                  {v.day === 999 ? "EOT" : `J${v.day}`}
                </span>
                <span className="flex-1" style={{ color: "#cbd5e1" }}>{v.name}</span>
                <span style={{ color: "#475569" }}>{v.exams.length} exam{v.exams.length !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProtocolDocumentImporter({ protocol, onUpdated }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [parsed, setParsed] = useState<Partial<CreateProtocolPayload> | null>(null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [applyLog, setApplyLog] = useState<string[]>([]);

  // ── Process a file (real PDF upload) ──────────────────────────────────────
  async function handleFile(file: File) {
    if (!file.name.endsWith(".pdf") && file.type !== "application/pdf") {
      setErrorMsg("Seuls les fichiers PDF sont acceptés.");
      setStatus("error");
      return;
    }
    setFileName(file.name);
    setStatus("extracting");
    setErrorMsg("");
    setParsed(null);
    try {
      const text = await extractTextFromPDF(file);
      const result = parseProtocolText(text);
      setParsed(result);
      setStatus("preview");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Erreur lors de l'extraction du PDF.");
      setStatus("error");
    }
  }

  // ── Load AVANZAR demo data ─────────────────────────────────────────────────
  function loadAVANZARDemo() {
    setFileName("AVANZAR-NCT05687266-demo.pdf");
    setParsed(getAVANZARDemoData());
    setStatus("preview");
    setErrorMsg("");
  }

  // ── Apply parsed data to protocol ─────────────────────────────────────────
  async function applyToProtocol() {
    if (!parsed) return;
    setStatus("applying");
    setApplyLog([]);
    const log: string[] = [];

    try {
      // 1. Update scalar fields (no criteria / visits here)
      const scalarUpdate: Partial<CreateProtocolPayload> = {};
      const fields: Array<keyof CreateProtocolPayload> = [
        "title", "eudract_number", "phase", "pathology", "promoter", "summary",
        "objectives_primary", "objectives_secondary", "study_schema", "interventions",
        "study_drugs", "authorized_meds", "prohibited_meds",
      ];
      for (const f of fields) {
        if (parsed[f] !== undefined) {
          (scalarUpdate as any)[f] = parsed[f];
        }
      }
      if (Object.keys(scalarUpdate).length > 0) {
        await protocolsApi.update!(protocol.id, scalarUpdate);
        log.push(`✓ Champs mis à jour : ${Object.keys(scalarUpdate).join(", ")}`);
      }

      // 2. Add criteria (append to existing ones)
      const newCriteria = parsed.criteria ?? [];
      if (newCriteria.length > 0) {
        let added = 0;
        const existingTexts = new Set(protocol.criteria.map(c => c.text.toLowerCase().trim()));
        for (const c of newCriteria) {
          // Skip if a very similar criterion already exists
          if (existingTexts.has(c.text.toLowerCase().trim())) continue;
          await protocolsApi.addCriterion(protocol.id, { type: c.type, text: c.text, order: c.order });
          added++;
        }
        log.push(`✓ ${added} critère${added !== 1 ? "s" : ""} ajouté${added !== 1 ? "s" : ""} (${newCriteria.length - (newCriteria.length - added)} doublons ignorés)`);
      }

      // 3. Update visits
      const newVisits = parsed.visits ?? [];
      if (newVisits.length > 0) {
        await protocolsApi.update!(protocol.id, { visits: newVisits } as any);
        log.push(`✓ Calendrier mis à jour : ${newVisits.length} visite${newVisits.length !== 1 ? "s" : ""}`);
      }

      // 4. Reload protocol
      const refreshed = await protocolsApi.get(protocol.id);
      onUpdated(refreshed.data);
      qc.invalidateQueries({ queryKey: ["protocols"] });

      setApplyLog(log);
      setStatus("done");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Erreur lors de l'application au protocole.");
      setApplyLog(log);
      setStatus("error");
    }
  }

  function reset() {
    setStatus("idle");
    setParsed(null);
    setFileName("");
    setErrorMsg("");
    setApplyLog([]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Protocole source rubric ── */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
               style={{ background: "rgba(99,102,241,0.15)" }}>
            <svg width="13" height="13" fill="none" stroke="#818cf8" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <h4 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>
              Protocole source
            </h4>
            <p className="text-xs" style={{ color: "#475569" }}>
              Chargez le PDF officiel du protocole pour configurer automatiquement tous les champs
            </p>
          </div>
          <span className="ml-auto text-xs px-2.5 py-1 rounded-full"
                style={{ background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}>
            100% local · aucun envoi réseau
          </span>
        </div>

        {/* ── IDLE: dropzone ── */}
        {status === "idle" && (
          <div className="space-y-3">
            {/* Drag-and-drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault(); setDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
              onClick={() => inputRef.current?.click()}
              className="rounded-2xl flex flex-col items-center justify-center gap-3 py-10 cursor-pointer transition-all"
              style={{
                border: `2px dashed ${dragging ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.1)"}`,
                background: dragging ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.02)",
              }}
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                   style={{ background: "rgba(99,102,241,0.12)" }}>
                <svg width="22" height="22" fill="none" stroke="#818cf8" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium" style={{ color: "#e2e8f0" }}>
                  Déposez le PDF du protocole ici
                </p>
                <p className="text-xs mt-1" style={{ color: "#475569" }}>
                  ou cliquez pour parcourir · PDF uniquement
                </p>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>

            {/* AVANZAR demo button */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
              <span className="text-xs" style={{ color: "#334155" }}>ou</span>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
            </div>
            <button
              onClick={loadAVANZARDemo}
              className="w-full flex items-center justify-center gap-2.5 rounded-xl py-3 text-sm font-medium transition-all"
              style={{
                background: "rgba(14,165,233,0.08)",
                border: "1px solid rgba(14,165,233,0.2)",
                color: "#38bdf8",
              }}
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Charger les données AVANZAR (NCT05687266) — démo
            </button>
          </div>
        )}

        {/* ── EXTRACTING: spinner ── */}
        {status === "extracting" && (
          <div className="flex flex-col items-center justify-center gap-4 py-12 rounded-2xl"
               style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                 style={{ background: "rgba(99,102,241,0.15)" }}>
              <svg className="animate-spin" width="18" height="18" fill="none" stroke="#818cf8" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M4 12a8 8 0 018-8V4m0 0a8 8 0 018 8" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: "#e2e8f0" }}>Extraction en cours…</p>
              <p className="text-xs mt-1" style={{ color: "#475569" }}>{fileName}</p>
            </div>
          </div>
        )}

        {/* ── PREVIEW: show parsed data + confirm button ── */}
        {(status === "preview" || status === "applying") && parsed && (
          <div className="space-y-4">
            {/* File + action header */}
            <div className="flex items-center gap-3 rounded-xl px-4 py-3"
                 style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.15)" }}>
              <svg width="14" height="14" fill="none" stroke="#34d399" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium" style={{ color: "#34d399" }}>Extraction réussie</p>
                <p className="text-xs truncate" style={{ color: "#475569" }}>{fileName}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={reset}
                  className="text-xs px-3 py-1.5 rounded-lg"
                  style={{ color: "#64748b" }}
                >
                  Changer
                </button>
                <button
                  onClick={applyToProtocol}
                  disabled={status === "applying"}
                  className="flex items-center gap-2 text-xs px-4 py-2 rounded-xl font-semibold text-white transition-all"
                  style={{
                    background: status === "applying" ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.85)",
                    cursor: status === "applying" ? "wait" : "pointer",
                  }}
                >
                  {status === "applying" ? (
                    <>
                      <svg className="animate-spin" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M4 12a8 8 0 018-8V4" strokeLinecap="round"/>
                      </svg>
                      Application…
                    </>
                  ) : (
                    <>
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Appliquer au protocole
                    </>
                  )}
                </button>
              </div>
            </div>

            <ParsedPreview data={parsed} />
          </div>
        )}

        {/* ── DONE ── */}
        {status === "done" && (
          <div className="space-y-3">
            <div className="rounded-xl px-4 py-4"
                 style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                     style={{ background: "rgba(16,185,129,0.2)" }}>
                  <svg width="14" height="14" fill="none" stroke="#34d399" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#34d399" }}>
                    Protocole configuré avec succès
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
                    Toutes les données ont été importées depuis {fileName}
                  </p>
                </div>
              </div>
              <ul className="space-y-1 pl-11">
                {applyLog.map((l, i) => (
                  <li key={i} className="text-xs" style={{ color: "#94a3b8" }}>{l}</li>
                ))}
              </ul>
            </div>
            <button
              onClick={reset}
              className="text-xs px-4 py-2 rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)", color: "#64748b", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              Charger un autre PDF
            </button>
          </div>
        )}

        {/* ── ERROR ── */}
        {status === "error" && (
          <div className="space-y-3">
            <div className="rounded-xl px-4 py-3 flex items-center gap-3"
                 style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.2)" }}>
              <svg width="14" height="14" fill="none" stroke="#fb7185" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round"/>
              </svg>
              <p className="text-xs flex-1" style={{ color: "#fb7185" }}>{errorMsg}</p>
              <button onClick={reset} className="text-xs px-3 py-1.5 rounded-lg"
                      style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}>
                Réessayer
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Separator ── */}
      <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

      {/* ── Other documents (existing DocumentManager) ── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <svg width="13" height="13" fill="none" stroke="#475569" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#475569" }}>
            Autres documents
          </p>
        </div>
        <DocumentManager protocolId={protocol.id} />
      </section>

    </div>
  );
}
