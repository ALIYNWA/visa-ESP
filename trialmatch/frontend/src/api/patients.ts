import client from "./client";
import { isDemoMode, demoPatients } from "./demoStore";
import type { Patient, PatientContext, PatientListItem } from "@/types";

const wrap = <T>(data: T) => Promise.resolve({ data });

export const patientsApi = {
  list: () =>
    isDemoMode()
      ? wrap<PatientListItem[]>(demoPatients.list())
      : client.get<PatientListItem[]>("/patients"),

  get: (id: string) =>
    isDemoMode()
      ? wrap<Patient>(demoPatients.get(id))
      : client.get<Patient>(`/patients/${id}`),

  create: (payload: { pseudonym: string; context: PatientContext }) =>
    isDemoMode()
      ? wrap<Patient>(demoPatients.create(payload))
      : client.post<Patient>("/patients", payload),

  update: (
    id: string,
    payload: { pseudonym?: string; context?: PatientContext }
  ) =>
    isDemoMode()
      ? wrap<Patient>(demoPatients.update(id, payload))
      : client.put<Patient>(`/patients/${id}`, payload),

  delete: (id: string) =>
    isDemoMode()
      ? (demoPatients.delete(id), wrap<void>(undefined))
      : client.delete(`/patients/${id}`),

  matchAll: (patientId: string) =>
    isDemoMode()
      ? wrap<unknown>(null)
      : client.post(`/patients/${patientId}/match-all`),
};
