// TrialMatch — TypeScript type definitions

export type ProtocolPhase = "I" | "II" | "III" | "IV";
export type CriterionType = "INC" | "EXC";
export type Verdict = "eligible" | "non_eligible" | "incomplet";
export type CriterionStatus = "satisfait" | "non_satisfait" | "inconnu";
export type OverrideStatus = "satisfait" | "non_satisfait";
export type UserRole =
  | "admin"
  | "investigateur_principal"
  | "co_investigateur"
  | "arc"
  | "tec";

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
  role: UserRole;
}

export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
}

// ── Protocol ──────────────────────────────────────────────────────────────────

export interface Criterion {
  id: string;
  protocol_id: string;
  type: CriterionType;
  text: string;
  order: number;
  created_at: string;
}

export interface Protocol {
  id: string;
  title: string;
  eudract_number: string | null;
  phase: ProtocolPhase;
  pathology: string;
  summary: string | null;
  promoter: string | null;
  arc_referent: string | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  criteria: Criterion[];
}

export interface ProtocolListItem {
  id: string;
  title: string;
  eudract_number: string | null;
  phase: ProtocolPhase;
  pathology: string;
  version: number;
  is_active: boolean;
  created_at: string;
  criteria_count: number;
}

export interface CreateProtocolPayload {
  title: string;
  eudract_number?: string;
  phase: ProtocolPhase;
  pathology: string;
  summary?: string;
  promoter?: string;
  arc_referent?: string;
  criteria: Array<{ type: CriterionType; text: string; order: number }>;
}

// ── Patient ───────────────────────────────────────────────────────────────────

export interface PatientContext {
  age?: number;
  sexe?: "M" | "F" | "Autre";
  diagnostic_principal?: string;
  stade?: string;
  ecog_performance_status?: number;
  traitements_en_cours?: string[];
  biologie?: Record<string, string | number>;
  antecedents?: string[];
  notes_libres?: string;
}

export interface Patient {
  id: string;
  pseudonym: string;
  context: PatientContext | null;
  created_by: string;
  created_at: string;
}

export interface PatientListItem {
  id: string;
  pseudonym: string;
  created_at: string;
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface CriterionResult {
  id: string;
  criterion_id: string;
  criterion_text: string;
  criterion_type: CriterionType;
  status: CriterionStatus;
  reasoning: string | null;
  overridden_by: string | null;
  overridden_at: string | null;
  override_note: string | null;
  override_status: OverrideStatus | null;
}

export interface Analysis {
  id: string;
  protocol_id: string;
  protocol_version: number;
  patient_id: string;
  verdict: Verdict;
  score_pct: number;
  resume: string | null;
  points_attention: string[] | null;
  missing_data_points: MissingDataPoint[] | null;
  prompt_hash: string;
  model_name: string;
  model_version: string | null;
  latency_ms: number | null;
  created_at: string;
  created_by: string;
  validated_by: string | null;
  validated_at: string | null;
  criterion_results: CriterionResult[];
}

// ── Study Documents ───────────────────────────────────────────────────────────

export type DocumentCategory = "protocole" | "brochure_ib" | "crf" | "consentement" | "autre";

export interface StudyDocument {
  id: string;
  protocol_id: string;
  name: string;
  category: DocumentCategory;
  size_bytes: number;
  /** Plain text extracted from the document — stays 100% local, never sent externally */
  content_text: string;
  uploaded_by: string;
  uploaded_at: string;
}

export interface MissingDataPoint {
  criterion_id: string;
  criterion_text: string;
  missing_field: string;
  suggestion: string;
}

export interface DashboardStats {
  total_protocols: number;
  active_protocols: number;
  total_patients: number;
  total_analyses: number;
  analyses_last_7_days: number;
  eligible_rate_pct: number;
  pending_validation: number;
  per_protocol: ProtocolStats[];
}

export interface ProtocolStats {
  protocol_id: string;
  protocol_title: string;
  total: number;
  eligible: number;
  non_eligible: number;
  incomplet: number;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export type AuditAction = "create" | "update" | "delete" | "validate" | "override" | "login";
export type AuditEntity = "protocol" | "patient" | "analysis" | "document" | "criterion";

export interface AuditLog {
  id: string;
  timestamp: string;
  user_id: string;
  username: string;
  action: AuditAction;
  entity: AuditEntity;
  entity_id: string | null;
  description: string;
}
