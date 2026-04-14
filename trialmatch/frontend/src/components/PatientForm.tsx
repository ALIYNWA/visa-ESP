import { useState } from "react";
import type { PatientContext } from "@/types";

interface Props {
  onSubmit: (data: { pseudonym: string; context: PatientContext }) => Promise<void>;
  isLoading?: boolean;
  initialValues?: { pseudonym: string; context: PatientContext | null };
  submitLabel?: string;
}

const labelStyle = { color: "#64748b", fontSize: "0.75rem", fontWeight: 500, marginBottom: "6px", display: "block" as const };

export function PatientForm({ onSubmit, isLoading, initialValues, submitLabel }: Props) {
  const ctx = initialValues?.context;
  const [pseudonym, setPseudonym] = useState(initialValues?.pseudonym ?? "");
  const [age, setAge] = useState(ctx?.age != null ? String(ctx.age) : "");
  const [sexe, setSexe] = useState<"M" | "F" | "Autre" | "">(ctx?.sexe ?? "");
  const [diagnostic, setDiagnostic] = useState(ctx?.diagnostic_principal ?? "");
  const [stade, setStade] = useState(ctx?.stade ?? "");
  const [ecog, setEcog] = useState(ctx?.ecog_performance_status != null ? String(ctx.ecog_performance_status) : "");
  const [traitements, setTraitements] = useState(ctx?.traitements_en_cours?.join("\n") ?? "");
  const [antecedents, setAntecedents] = useState(ctx?.antecedents?.join("\n") ?? "");
  const [notesLibres, setNotesLibres] = useState(ctx?.notes_libres ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!pseudonym.trim()) e.pseudonym = "Le pseudonyme est requis";
    if (age && (isNaN(+age) || +age < 0 || +age > 150)) e.age = "Âge invalide (0–150)";
    if (ecog && (isNaN(+ecog) || +ecog < 0 || +ecog > 4)) e.ecog = "ECOG invalide (0–4)";
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const context: PatientContext = {
      ...(age ? { age: +age } : {}),
      ...(sexe ? { sexe } : {}),
      ...(diagnostic ? { diagnostic_principal: diagnostic } : {}),
      ...(stade ? { stade } : {}),
      ...(ecog ? { ecog_performance_status: +ecog } : {}),
      traitements_en_cours: traitements.split("\n").map(t => t.trim()).filter(Boolean),
      antecedents: antecedents.split("\n").map(a => a.trim()).filter(Boolean),
      ...(notesLibres ? { notes_libres: notesLibres } : {}),
    };
    await onSubmit({ pseudonym: pseudonym.trim(), context });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" data-testid="patient-form">
      {/* Pseudonyme */}
      <div>
        <label style={labelStyle}>Pseudonyme *</label>
        <input type="text" value={pseudonym} onChange={e => setPseudonym(e.target.value)}
               className="input-dark w-full rounded-xl px-4 py-2.5 text-sm font-mono"
               placeholder="P-2024-001" maxLength={100} data-testid="patient-pseudonym" />
        {errors.pseudonym && <p className="text-xs mt-1" style={{ color: "#fb7185" }} data-testid="error-pseudonym">{errors.pseudonym}</p>}
      </div>

      {/* Age / Sexe / ECOG */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label style={labelStyle}>Âge</label>
          <input type="number" value={age} onChange={e => setAge(e.target.value)} min={0} max={150}
                 className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" data-testid="patient-age" />
          {errors.age && <p className="text-xs mt-1" style={{ color: "#fb7185" }}>{errors.age}</p>}
        </div>
        <div>
          <label style={labelStyle}>Sexe</label>
          <select value={sexe} onChange={e => setSexe(e.target.value as "M"|"F"|"Autre"|"")}
                  className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" data-testid="patient-sexe">
            <option value="">–</option>
            <option value="M">M</option>
            <option value="F">F</option>
            <option value="Autre">Autre</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>ECOG PS (0–4)</label>
          <input type="number" value={ecog} onChange={e => setEcog(e.target.value)} min={0} max={4}
                 className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" data-testid="patient-ecog" />
          {errors.ecog && <p className="text-xs mt-1" style={{ color: "#fb7185" }}>{errors.ecog}</p>}
        </div>
      </div>

      {/* Diagnostic / Stade */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={labelStyle}>Diagnostic principal</label>
          <input type="text" value={diagnostic} onChange={e => setDiagnostic(e.target.value)}
                 className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={500} data-testid="patient-diagnostic" />
        </div>
        <div>
          <label style={labelStyle}>Stade</label>
          <input type="text" value={stade} onChange={e => setStade(e.target.value)}
                 className="input-dark w-full rounded-xl px-4 py-2.5 text-sm" maxLength={100} />
        </div>
      </div>

      {/* Traitements / Antécédents */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={labelStyle}>Traitements en cours <span style={{ opacity: .5 }}>(1 par ligne)</span></label>
          <textarea value={traitements} onChange={e => setTraitements(e.target.value)} rows={3}
                    className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none" data-testid="patient-traitements" />
        </div>
        <div>
          <label style={labelStyle}>Antécédents <span style={{ opacity: .5 }}>(1 par ligne)</span></label>
          <textarea value={antecedents} onChange={e => setAntecedents(e.target.value)} rows={3}
                    className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none" />
        </div>
      </div>

      {/* Notes libres */}
      <div>
        <label style={labelStyle}>Notes cliniques libres</label>
        <textarea value={notesLibres} onChange={e => setNotesLibres(e.target.value)} rows={3}
                  className="input-dark w-full rounded-xl px-4 py-2.5 text-sm resize-none"
                  maxLength={5000} data-testid="patient-notes" />
      </div>

      <button type="submit" disabled={isLoading}
              className="btn-primary w-full rounded-xl py-2.5 text-sm font-semibold text-white"
              data-testid="patient-submit">
        {isLoading ? "Enregistrement…" : (submitLabel ?? "Créer le patient")}
      </button>
    </form>
  );
}
