import { useState } from "react";

interface Props {
  analysisId: string;
  isValidated: boolean;
  validatedAt?: string | null;
  canValidate: boolean;
  onValidate: (note?: string) => Promise<void>;
}

export function InvestigatorValidation({
  isValidated,
  validatedAt,
  canValidate,
  onValidate,
}: Props) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleValidate() {
    setLoading(true);
    setError("");
    try {
      await onValidate(note || undefined);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur lors de la validation");
    } finally {
      setLoading(false);
    }
  }

  if (isValidated) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-4"
        data-testid="validation-status-validated"
      >
        <span className="text-green-600 text-xl">✓</span>
        <div>
          <p className="text-sm font-medium text-green-800">Fiche RCP validée</p>
          {validatedAt && (
            <p className="text-xs text-green-600">
              {new Date(validatedAt).toLocaleString("fr-FR")}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
      data-testid="validation-panel"
    >
      <h3 className="text-sm font-semibold text-gray-700">
        Validation par l'investigateur
      </h3>
      <p className="text-xs text-gray-500">
        En validant cette fiche, vous certifiez avoir examiné les résultats de l'analyse
        et les données cliniques du patient.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Commentaire de validation (optionnel)"
        rows={2}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        disabled={!canValidate}
        data-testid="validation-note"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={handleValidate}
        disabled={!canValidate || loading}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-white font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="validation-submit"
      >
        {loading ? "Validation…" : "Signer et valider"}
      </button>
      {!canValidate && (
        <p className="text-xs text-gray-400 text-center">
          Seuls les investigateurs principaux peuvent valider les fiches.
        </p>
      )}
    </div>
  );
}
