/**
 * DocumentManager — upload and manage study documents per protocol.
 *
 * Privacy guarantees:
 *  – Text extraction runs entirely in the browser (FileReader API, no external service)
 *  – Content is stored in-memory (demo) or encrypted at-rest in DB (real mode)
 *  – Only the local Ollama/Meditron endpoint receives document text, via the backend analysis prompt
 *  – No document data leaves the local network
 */
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { documentsApi } from "@/api/documents";
import type { DocumentCategory, StudyDocument } from "@/types";

interface Props { protocolId: string; }

const CATEGORY_LABELS: Record<DocumentCategory, { label: string; color: string; bg: string }> = {
  protocole:    { label: "Protocole",      color: "#818cf8", bg: "rgba(99,102,241,0.15)" },
  brochure_ib:  { label: "Brochure IB",    color: "#38bdf8", bg: "rgba(14,165,233,0.15)" },
  crf:          { label: "CRF",            color: "#34d399", bg: "rgba(16,185,129,0.15)" },
  consentement: { label: "Consentement",   color: "#fb923c", bg: "rgba(251,146,60,0.15)" },
  autre:        { label: "Autre",          color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024)       return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function DocumentManager({ protocolId }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<DocumentCategory>("protocole");
  const [name, setName] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<StudyDocument | null>(null);
  const [error, setError] = useState("");

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["documents", protocolId],
    queryFn: () => documentsApi.list(protocolId).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof documentsApi.create>[1]) =>
      documentsApi.create(protocolId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", protocolId] });
      setShowForm(false);
      setPastedText("");
      setName("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(protocolId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", protocolId] }),
  });

  /** Read a plain-text or markdown file entirely in-browser — no network call. */
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadingFile(true);
    setError("");
    try {
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        setError("PDF détecté — copiez-collez le texte pertinent dans le champ ci-dessous pour une extraction 100% locale.");
        setLoadingFile(false);
        return;
      }
      const text = await file.text();
      setPastedText(text.slice(0, 50_000)); // 50k char max
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
    } catch {
      setError("Impossible de lire le fichier.");
    } finally {
      setLoadingFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Le nom du document est requis."); return; }
    if (!pastedText.trim()) { setError("Le contenu textuel est requis."); return; }
    setError("");
    await createMutation.mutateAsync({
      name: name.trim(),
      category,
      content_text: pastedText.trim(),
      size_bytes: new Blob([pastedText]).size,
    });
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Documents d'étude
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
            Extraction 100 % locale — aucune donnée transmise à l'extérieur
          </p>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setError(""); }}
          data-testid="doc-toggle-form"
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl transition-all"
          style={{
            background: showForm ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.1)",
            color: "#818cf8",
            border: "1px solid rgba(99,102,241,0.25)",
          }}
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" strokeLinecap="round"/>
          </svg>
          {showForm ? "Annuler" : "Ajouter document"}
        </button>
      </div>

      {/* Privacy notice */}
      <div className="flex items-start gap-2.5 rounded-xl px-4 py-3"
           style={{ background: "rgba(13,148,136,0.08)", border: "1px solid rgba(13,148,136,0.2)" }}>
        <svg width="14" height="14" fill="none" stroke="#14b8a6" strokeWidth="2" viewBox="0 0 24 24" className="mt-0.5 shrink-0">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <p className="text-xs leading-relaxed" style={{ color: "#0d9488" }}>
          <strong>Sécurité on-premise :</strong> Le texte est extrait localement dans votre navigateur. Il est stocké chiffré (AES-256) sur le serveur local et n'est transmis qu'au modèle Meditron en local (localhost:11434). Aucun document ne quitte votre réseau.
        </p>
      </div>

      {/* Upload form */}
      {showForm && (
        <form onSubmit={handleSubmit}
              className="rounded-2xl p-5 space-y-4 fade-up"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(99,102,241,0.25)" }}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                Nom du document *
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex : Protocole AVANZAR v2.1"
                className="input-dark w-full rounded-xl px-4 py-2.5 text-sm"
                maxLength={200}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                Catégorie
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as DocumentCategory)}
                className="input-dark w-full rounded-xl px-4 py-2.5 text-sm"
              >
                {(Object.keys(CATEGORY_LABELS) as DocumentCategory[]).map(k => (
                  <option key={k} value={k}>{CATEGORY_LABELS[k].label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* File import or paste */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Contenu textuel *
              </label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={loadingFile}
                className="text-xs flex items-center gap-1 px-2.5 py-1 rounded-lg transition-colors"
                style={{ color: "#818cf8", background: "rgba(99,102,241,0.1)" }}
              >
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {loadingFile ? "Lecture…" : "Importer .txt / .md"}
              </button>
              <input ref={fileRef} type="file" accept=".txt,.md,.csv" className="hidden" onChange={handleFileSelect} />
            </div>
            <textarea
              value={pastedText}
              onChange={e => setPastedText(e.target.value)}
              rows={8}
              placeholder={`Collez ici le texte du document d'étude (critères d'éligibilité détaillés, définitions, notes de protocole…)\n\nPour les PDF : ouvrez le document et copiez-collez le texte pertinent directement ici.`}
              className="input-dark w-full rounded-xl px-4 py-3 text-xs resize-none font-mono leading-relaxed"
              maxLength={50_000}
            />
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {pastedText.length.toLocaleString()} / 50 000 caractères
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs"
                 style={{ background: "rgba(244,63,94,0.1)", color: "#fb7185", border: "1px solid rgba(244,63,94,0.2)" }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01" strokeLinecap="round"/>
              </svg>
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="btn-primary flex-1 rounded-xl py-2.5 text-sm font-semibold text-white"
            >
              {createMutation.isPending ? "Enregistrement…" : "Enregistrer le document"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(""); setPastedText(""); setName(""); }}
              className="px-5 rounded-xl py-2.5 text-sm font-medium transition-colors"
              style={{ background: "rgba(255,255,255,0.04)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            >
              Annuler
            </button>
          </div>
        </form>
      )}

      {/* Document list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 rounded-2xl"
             style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.07)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
               style={{ background: "rgba(255,255,255,0.04)" }}>
            <svg width="20" height="20" fill="none" stroke="#334155" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round"/>
            </svg>
          </div>
          <p className="text-sm" style={{ color: "#334155" }}>Aucun document importé</p>
          <p className="text-xs mt-1" style={{ color: "#1e293b" }}>Ajoutez le protocole officiel pour enrichir l'analyse</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {documents.map(doc => {
            const cat = CATEGORY_LABELS[doc.category];
            return (
              <li key={doc.id}
                  className="rounded-xl px-4 py-3.5 flex items-center gap-3 group transition-all"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                {/* Icon */}
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                     style={{ background: cat.bg }}>
                  <svg width="16" height="16" fill="none" stroke={cat.color} strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round"/>
                  </svg>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{doc.name}</p>
                    <span className="text-xs px-2 py-0.5 rounded-md font-medium shrink-0"
                          style={{ background: cat.bg, color: cat.color }}>
                      {cat.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {formatBytes(doc.size_bytes)}
                    </p>
                    <span style={{ color: "#1e293b" }}>·</span>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {new Date(doc.uploaded_at).toLocaleDateString("fr-FR")}
                    </p>
                    <span style={{ color: "#1e293b" }}>·</span>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {doc.content_text.length.toLocaleString()} caractères indexés
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setPreviewDoc(previewDoc?.id === doc.id ? null : doc)}
                    className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                    style={{ color: "#818cf8", background: "rgba(99,102,241,0.1)" }}
                    title="Aperçu"
                  >
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(doc.id)}
                    className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                    style={{ color: "#fb7185", background: "rgba(244,63,94,0.1)" }}
                    title="Supprimer"
                  >
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Preview panel */}
      {previewDoc && (
        <div className="rounded-2xl p-5 fade-up"
             style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(99,102,241,0.2)" }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold" style={{ color: "#818cf8" }}>
              Aperçu — {previewDoc.name}
            </p>
            <button onClick={() => setPreviewDoc(null)}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.04)" }}>
              ✕
            </button>
          </div>
          <pre className="text-xs whitespace-pre-wrap break-words leading-relaxed max-h-60 overflow-auto"
               style={{ color: "#94a3b8", fontFamily: "var(--font-mono, monospace)" }}>
            {previewDoc.content_text.slice(0, 3000)}{previewDoc.content_text.length > 3000 ? "\n…[tronqué]" : ""}
          </pre>
        </div>
      )}
    </div>
  );
}
