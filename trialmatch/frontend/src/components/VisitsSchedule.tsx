/**
 * VisitsSchedule — display and edit the study calendar (visits + exams).
 */
import { useState } from "react";
import type { StudyVisit } from "@/types";

interface Props {
  visits: StudyVisit[];
  canEdit?: boolean;
  onChange?: (visits: StudyVisit[]) => void;
}

function uuid() { return crypto.randomUUID(); }

export function VisitsSchedule({ visits, canEdit = false, onChange }: Props) {
  const [expanded, setExpanded] = useState<string | null>(visits[0]?.id ?? null);
  const [addingVisit, setAddingVisit] = useState(false);
  const [newVisit, setNewVisit] = useState({ name: "", day: "", window_before: "3", window_after: "3" });

  function update(updated: StudyVisit[]) {
    onChange?.(updated);
  }

  function addVisit() {
    if (!newVisit.name.trim() || !newVisit.day.trim()) return;
    const v: StudyVisit = {
      id: uuid(),
      name: newVisit.name.trim(),
      day: parseInt(newVisit.day),
      window_before: parseInt(newVisit.window_before) || 3,
      window_after: parseInt(newVisit.window_after) || 3,
      exams: [],
    };
    const sorted = [...visits, v].sort((a, b) => a.day - b.day);
    update(sorted);
    setNewVisit({ name: "", day: "", window_before: "3", window_after: "3" });
    setAddingVisit(false);
    setExpanded(v.id);
  }

  function deleteVisit(id: string) {
    update(visits.filter(v => v.id !== id));
    if (expanded === id) setExpanded(null);
  }

  function addExam(visitId: string, examName: string) {
    if (!examName.trim()) return;
    update(visits.map(v =>
      v.id !== visitId ? v : {
        ...v,
        exams: [...v.exams, { id: uuid(), name: examName.trim(), required: true }],
      }
    ));
  }

  function toggleExamRequired(visitId: string, examId: string) {
    update(visits.map(v =>
      v.id !== visitId ? v : {
        ...v,
        exams: v.exams.map(e => e.id !== examId ? e : { ...e, required: !e.required }),
      }
    ));
  }

  function deleteExam(visitId: string, examId: string) {
    update(visits.map(v =>
      v.id !== visitId ? v : { ...v, exams: v.exams.filter(e => e.id !== examId) }
    ));
  }

  if (!visits.length && !canEdit) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <svg width="32" height="32" fill="none" stroke="#334155" strokeWidth="1.5" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round"/>
        </svg>
        <p className="text-sm" style={{ color: "#334155" }}>Aucun calendrier de visite défini</p>
        <p className="text-xs" style={{ color: "#1e293b" }}>Importez un PDF ou ajoutez manuellement</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Timeline header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#475569" }}>
          Calendrier — {visits.length} visite{visits.length !== 1 ? "s" : ""}
        </p>
        {canEdit && (
          <button onClick={() => setAddingVisit(true)}
                  className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                  style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>
            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
            </svg>
            Ajouter une visite
          </button>
        )}
      </div>

      {/* Horizontal day axis */}
      <div className="rounded-xl p-4 overflow-x-auto"
           style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-0 relative" style={{ minWidth: `${visits.length * 90}px` }}>
          {/* Connecting line */}
          <div className="absolute top-1/2 left-0 right-0 h-px" style={{ background: "rgba(99,102,241,0.2)" }} />
          {visits.map((v, i) => {
            const isActive = expanded === v.id;
            return (
              <div key={v.id} className="flex-1 flex flex-col items-center relative z-10 cursor-pointer"
                   onClick={() => setExpanded(isActive ? null : v.id)}>
                {/* Day label */}
                <span className="text-xs font-mono mb-2" style={{ color: "#475569" }}>
                  {v.day === 999 ? "EOT" : `J${v.day}`}
                </span>
                {/* Circle */}
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all"
                     style={{
                       background: isActive ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.05)",
                       borderColor: isActive ? "#818cf8" : "rgba(255,255,255,0.15)",
                       color: isActive ? "#818cf8" : "#64748b",
                     }}>
                  {i + 1}
                </div>
                {/* Visit name */}
                <span className="text-xs text-center mt-2 leading-tight"
                      style={{ color: isActive ? "#e2e8f0" : "#64748b", maxWidth: "80px" }}>
                  {v.name}
                </span>
                {/* Exam count badge */}
                {v.exams.length > 0 && (
                  <span className="text-xs mt-1" style={{ color: "#334155" }}>
                    {v.exams.length} exam{v.exams.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Visit detail */}
      {visits.map(v => expanded === v.id && (
        <div key={v.id} className="rounded-xl p-5 space-y-4 fade-up"
             style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.2)" }}>
          <div className="flex items-start justify-between">
            <div>
              <h4 className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>{v.name}</h4>
              <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: "#475569" }}>
                <span>Jour {v.day === 999 ? "EOT" : v.day}</span>
                {v.window_before != null && (
                  <span>Fenêtre : -{v.window_before} / +{v.window_after ?? 0} j</span>
                )}
                <span>{v.exams.length} examen{v.exams.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
            {canEdit && (
              <button onClick={() => deleteVisit(v.id)}
                      className="text-xs px-2.5 py-1 rounded-lg"
                      style={{ background: "rgba(244,63,94,0.1)", color: "#fb7185" }}>
                Supprimer visite
              </button>
            )}
          </div>

          {/* Exams list */}
          <div className="space-y-2">
            {v.exams.length === 0 && (
              <p className="text-xs" style={{ color: "#334155" }}>Aucun examen défini pour cette visite.</p>
            )}
            {v.exams.map(e => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg px-3 py-2"
                   style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                {/* Required toggle */}
                <button onClick={() => canEdit && toggleExamRequired(v.id, e.id)}
                        className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold shrink-0"
                        style={{
                          background: e.required ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.05)",
                          color: e.required ? "#34d399" : "#475569",
                          border: `1px solid ${e.required ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.1)"}`,
                          cursor: canEdit ? "pointer" : "default",
                        }}>
                  {e.required ? "✓" : "○"}
                </button>
                <span className="text-xs flex-1" style={{ color: "#cbd5e1" }}>{e.name}</span>
                <span className="text-xs" style={{ color: e.required ? "#34d399" : "#475569" }}>
                  {e.required ? "Obligatoire" : "Optionnel"}
                </span>
                {canEdit && (
                  <button onClick={() => deleteExam(v.id, e.id)} className="text-xs" style={{ color: "#475569" }}>✕</button>
                )}
              </div>
            ))}
          </div>

          {/* Add exam */}
          {canEdit && (
            <AddExamRow visitId={v.id} onAdd={addExam} />
          )}
        </div>
      ))}

      {/* Add visit form */}
      {addingVisit && (
        <div className="rounded-xl p-4 space-y-3"
             style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(99,102,241,0.3)" }}>
          <p className="text-xs font-medium" style={{ color: "#818cf8" }}>Nouvelle visite</p>
          <div className="grid grid-cols-4 gap-3">
            <input value={newVisit.name} onChange={e => setNewVisit(v => ({ ...v, name: e.target.value }))}
                   placeholder="Nom (ex: Visite 1)" className="col-span-2 input-dark rounded-xl px-3 py-2 text-sm" />
            <input value={newVisit.day} onChange={e => setNewVisit(v => ({ ...v, day: e.target.value }))}
                   placeholder="Jour (ex: 1)" type="number" className="input-dark rounded-xl px-3 py-2 text-sm" />
            <input value={newVisit.window_before} onChange={e => setNewVisit(v => ({ ...v, window_before: e.target.value }))}
                   placeholder="Fenêtre" type="number" className="input-dark rounded-xl px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={addVisit} className="text-xs px-3 py-1.5 rounded-lg text-white"
                    style={{ background: "rgba(99,102,241,0.8)" }}>Ajouter</button>
            <button onClick={() => setAddingVisit(false)} className="text-xs px-3 py-1.5 rounded-lg"
                    style={{ color: "#94a3b8" }}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddExamRow({ visitId, onAdd }: { visitId: string; onAdd: (vid: string, name: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-center gap-2">
      <input value={val} onChange={e => setVal(e.target.value)}
             onKeyDown={e => { if (e.key === "Enter") { onAdd(visitId, val); setVal(""); } }}
             placeholder="Ajouter un examen (Entrée pour valider)"
             className="input-dark flex-1 rounded-xl px-3 py-2 text-xs" />
      <button onClick={() => { onAdd(visitId, val); setVal(""); }}
              className="text-xs px-3 py-2 rounded-lg"
              style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
        + Ajouter
      </button>
    </div>
  );
}
