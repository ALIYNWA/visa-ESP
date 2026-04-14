import { useState } from "react";
import type { CreateProtocolPayload, ProtocolPhase } from "@/types";

interface Props {
  onSubmit: (payload: CreateProtocolPayload) => Promise<void>;
  initialValues?: Partial<CreateProtocolPayload>;
  isLoading?: boolean;
}

const PHASES: ProtocolPhase[] = ["I", "II", "III", "IV"];

const fieldStyle = {
  label: { color: "#64748b", fontSize: "0.75rem", fontWeight: 500, marginBottom: "6px", display: "block" },
};

export function ProtocolForm({ onSubmit, initialValues, isLoading }: Props) {
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [eudract, setEudract] = useState(initialValues?.eudract_number ?? "");
  const [phase, setPhase] = useState<ProtocolPhase>(initialValues?.phase ?? "II");
  const [pathology, setPathology] = useState(initialValues?.pathology ?? "");
  const [summary, setSummary] = useState(initialValues?.summary ?? "");
  const [promoter, setPromoter] = useState(initialValues?.promoter ?? "");
  const [arcReferent, setArcReferent] = useState(initialValues?.arc_referent ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Le titre est requis";
    if (!pathology.trim()) e.pathology = "La pathologie est requise";
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit({ title: title.trim(), eudract_number: eudract.trim() || undefined, phase, pathology: pathology.trim(), summary: summary.trim() || undefined, promoter: promoter.trim() || undefined, arc_referent: arcReferent.trim() || undefined, criteria: [] });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" data-testid="protocol-form">
      <div>
        <label style={fieldStyle.label}>Titre du protocole *</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)}
               className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={500} data-testid="protocol-title" />
        {errors.title && <p className="text-xs mt-1" style={{ color: "#fb7185" }} data-testid="error-title">{errors.title}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={fieldStyle.label}>Numéro EudraCT</label>
          <input type="text" value={eudract} onChange={e => setEudract(e.target.value)}
                 placeholder="2024-000000-00"
                 className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={50} data-testid="protocol-eudract" />
        </div>
        <div>
          <label style={fieldStyle.label}>Phase *</label>
          <select value={phase} onChange={e => setPhase(e.target.value as ProtocolPhase)}
                  className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" data-testid="protocol-phase">
            {PHASES.map(p => <option key={p} value={p}>Phase {p}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label style={fieldStyle.label}>Pathologie *</label>
        <input type="text" value={pathology} onChange={e => setPathology(e.target.value)}
               className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={255} data-testid="protocol-pathology" />
        {errors.pathology && <p className="text-xs mt-1" style={{ color: "#fb7185" }} data-testid="error-pathology">{errors.pathology}</p>}
      </div>

      <div>
        <label style={fieldStyle.label}>Résumé</label>
        <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3}
                  className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none" data-testid="protocol-summary" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={fieldStyle.label}>Promoteur</label>
          <input type="text" value={promoter} onChange={e => setPromoter(e.target.value)}
                 className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={255} />
        </div>
        <div>
          <label style={fieldStyle.label}>ARC référent</label>
          <input type="text" value={arcReferent} onChange={e => setArcReferent(e.target.value)}
                 className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={255} />
        </div>
      </div>

      <button type="submit" disabled={isLoading}
              className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold text-white"
              data-testid="protocol-submit">
        {isLoading ? "Enregistrement…" : "Créer le protocole"}
      </button>
    </form>
  );
}
