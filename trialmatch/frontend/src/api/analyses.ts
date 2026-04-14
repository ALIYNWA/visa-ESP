import client from "./client";
import { isDemoMode, demoAnalyses } from "./demoStore";
import type { Analysis, DashboardStats } from "@/types";

const wrap = <T>(data: T) => Promise.resolve({ data });

export const analysesApi = {
  create: (payload: { protocol_id: string; patient_id: string }) =>
    isDemoMode()
      ? wrap<Analysis>(demoAnalyses.create(payload))
      : client.post<Analysis>("/analyses", payload),

  get: (id: string) =>
    isDemoMode()
      ? wrap<Analysis>(demoAnalyses.get(id))
      : client.get<Analysis>(`/analyses/${id}`),

  list: (params?: { patient_id?: string; protocol_id?: string }) =>
    isDemoMode()
      ? wrap<Analysis[]>(demoAnalyses.list(params))
      : client.get<Analysis[]>("/analyses", { params }),

  validate: (id: string, _note?: string) =>
    isDemoMode()
      ? wrap<Analysis>(demoAnalyses.validate(id))
      : client.post<Analysis>(`/analyses/${id}/validate`, {
          signature_note: _note,
        }),

  overrideCriterion: (
    analysisId: string,
    criterionResultId: string,
    payload: { override_status: "satisfait" | "non_satisfait"; override_note: string }
  ) =>
    isDemoMode()
      ? wrap<Analysis>(demoAnalyses.override(analysisId, criterionResultId, payload))
      : client.put<Analysis>(
          `/analyses/${analysisId}/criteria/${criterionResultId}/override`,
          payload
        ),

  dashboardStats: () =>
    isDemoMode()
      ? wrap<DashboardStats>(demoAnalyses.dashboardStats())
      : client.get<DashboardStats>("/dashboard/stats"),
};
