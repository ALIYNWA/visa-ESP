import client from "./client";
import { isDemoMode, demoProtocols } from "./demoStore";
import type {
  CreateProtocolPayload,
  Criterion,
  Protocol,
  ProtocolListItem,
} from "@/types";

const wrap = <T>(data: T) => Promise.resolve({ data });

export const protocolsApi = {
  list: (isActive?: boolean) =>
    isDemoMode()
      ? wrap<ProtocolListItem[]>(demoProtocols.list().filter(p => isActive === undefined || p.is_active === isActive))
      : client.get<ProtocolListItem[]>("/protocols", {
          params: isActive !== undefined ? { is_active: isActive } : {},
        }),

  get: (id: string) =>
    isDemoMode()
      ? wrap<Protocol>(demoProtocols.get(id))
      : client.get<Protocol>(`/protocols/${id}`),

  create: (payload: CreateProtocolPayload) =>
    isDemoMode()
      ? wrap<Protocol>(demoProtocols.create(payload))
      : client.post<Protocol>("/protocols", payload),

  update: (id: string, payload: Partial<CreateProtocolPayload>) =>
    isDemoMode()
      ? wrap<Protocol>(demoProtocols.update(id, payload))
      : client.put<Protocol>(`/protocols/${id}`, payload),

  newVersion: (id: string) =>
    isDemoMode()
      ? wrap<Protocol>(demoProtocols.update(id, { version: demoProtocols.get(id).version + 1 }))
      : client.post<Protocol>(`/protocols/${id}/version`),

  listCriteria: (protocolId: string) =>
    isDemoMode()
      ? wrap<Criterion[]>(demoProtocols.get(protocolId).criteria)
      : client.get<Criterion[]>(`/protocols/${protocolId}/criteria`),

  addCriterion: (
    protocolId: string,
    payload: { type: "INC" | "EXC"; text: string; order: number }
  ) =>
    isDemoMode()
      ? wrap<Criterion>(demoProtocols.addCriterion(protocolId, payload))
      : client.post<Criterion>(`/protocols/${protocolId}/criteria`, payload),

  updateCriterion: (
    protocolId: string,
    criterionId: string,
    payload: { type?: "INC" | "EXC"; text?: string; order?: number }
  ) =>
    isDemoMode()
      ? wrap<Criterion>(demoProtocols.updateCriterion(protocolId, criterionId, payload))
      : client.put<Criterion>(
          `/protocols/${protocolId}/criteria/${criterionId}`,
          payload
        ),

  deleteCriterion: (protocolId: string, criterionId: string) =>
    isDemoMode()
      ? (demoProtocols.deleteCriterion(protocolId, criterionId), wrap<void>(undefined))
      : client.delete(`/protocols/${protocolId}/criteria/${criterionId}`),
};
