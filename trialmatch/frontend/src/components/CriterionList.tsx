import { useState } from "react";
import type { Criterion, CriterionType } from "@/types";

interface Props {
  criteria: Criterion[];
  canEdit: boolean;
  onAdd: (payload: { type: CriterionType; text: string; order: number }) => Promise<void>;
  onDelete: (criterionId: string) => Promise<void>;
  onReorder: (criterionId: string, newOrder: number) => Promise<void>;
}

export function CriterionList({ criteria, canEdit, onAdd, onDelete }: Props) {
  const [newType, setNewType] = useState<CriterionType>("INC");
  const [newText, setNewText] = useState("");
  const [addError, setAddError] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const inclusion = criteria.filter(c => c.type === "INC").sort((a, b) => a.order - b.order);
  const exclusion = criteria.filter(c => c.type === "EXC").sort((a, b) => a.order - b.order);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim()) { setAddError("Le texte du critère est requis"); return; }
    setAddError("");
    setIsAdding(true);
    try {
      const maxOrder = criteria.reduce((m, c) => Math.max(m, c.order), -1);
      await onAdd({ type: newType, text: newText.trim(), order: maxOrder + 1 });
      setNewText("");
    } finally { setIsAdding(false); }
  }

  function Group({ items, type }: { items: Criterion[]; type: CriterionType }) {
    const isInc = type === "INC";
    return (
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: isInc ? "#818cf8" : "#fb923c" }}>
            {isInc ? "Critères d'inclusion" : "Critères d'exclusion"}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: isInc ? "rgba(99,102,241,0.15)" : "rgba(251,146,60,0.15)",
                         color: isInc ? "#818cf8" : "#fb923c" }}>
            {items.length}
          </span>
        </div>
        {items.length === 0 ? (
          <p className="text-sm italic px-1" style={{ color: "#334155" }}>Aucun critère</p>
        ) : (
          <ul className="space-y-2" data-testid={`criterion-list-${type}`}>
            {items.map((crit, i) => (
              <li key={crit.id}
                  className="flex items-start justify-between rounded-xl px-4 py-3 group"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  data-testid={`criterion-item-${crit.id}`}>
                <div className="flex items-start gap-3">
                  <span className="text-xs font-mono mt-0.5 shrink-0" style={{ color: "#334155" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm" style={{ color: "#cbd5e1" }}>{crit.text}</span>
                </div>
                {canEdit && (
                  <button onClick={() => onDelete(crit.id)}
                          className="ml-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg"
                          style={{ color: "#fb7185", background: "rgba(244,63,94,0.1)" }}
                          data-testid={`delete-criterion-${crit.id}`}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div data-testid="criterion-list">
      <Group items={inclusion} type="INC" />
      <Group items={exclusion} type="EXC" />

      {canEdit && (
        <form onSubmit={handleAdd}
              className="mt-4 flex gap-3 items-end p-4 rounded-xl"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)" }}
              data-testid="add-criterion-form">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "#64748b" }}>Type</label>
            <select value={newType} onChange={e => setNewType(e.target.value as CriterionType)}
                    className="input-dark rounded-xl px-3 py-2 text-sm" data-testid="new-criterion-type">
              <option value="INC">Inclusion</option>
              <option value="EXC">Exclusion</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1.5" style={{ color: "#64748b" }}>Texte du critère</label>
            <input type="text" value={newText} onChange={e => setNewText(e.target.value)}
                   className="input-dark w-full rounded-xl px-4 py-2 text-sm"
                   placeholder="Saisir le critère…" maxLength={1000} data-testid="new-criterion-text" />
            {addError && <p className="text-xs mt-1" style={{ color: "#fb7185" }}>{addError}</p>}
          </div>
          <button type="submit" disabled={isAdding}
                  className="btn-primary rounded-xl px-4 py-2 text-sm font-medium text-white shrink-0"
                  data-testid="add-criterion-btn">
            {isAdding ? "…" : "+ Ajouter"}
          </button>
        </form>
      )}
    </div>
  );
}
