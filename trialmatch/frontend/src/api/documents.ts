import client from "./client";
import { isDemoMode, demoDocuments } from "./demoStore";
import type { StudyDocument } from "@/types";

const wrap = <T>(data: T) => Promise.resolve({ data });

export const documentsApi = {
  list: (protocolId: string) =>
    isDemoMode()
      ? wrap<StudyDocument[]>(demoDocuments.list(protocolId))
      : client.get<StudyDocument[]>(`/protocols/${protocolId}/documents`),

  create: (protocolId: string, payload: {
    name: string;
    category: StudyDocument["category"];
    content_text: string;
    size_bytes: number;
  }) =>
    isDemoMode()
      ? wrap<StudyDocument>(demoDocuments.create(protocolId, payload))
      : client.post<StudyDocument>(`/protocols/${protocolId}/documents`, payload),

  delete: (protocolId: string, documentId: string) =>
    isDemoMode()
      ? (demoDocuments.delete(documentId), wrap<void>(undefined))
      : client.delete(`/protocols/${protocolId}/documents/${documentId}`),
};
