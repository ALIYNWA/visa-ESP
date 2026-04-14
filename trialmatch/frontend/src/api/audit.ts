import client from "./client";
import { isDemoMode, demoAuditLogs } from "./demoStore";
import type { AuditLog } from "@/types";

const wrap = <T>(data: T) => Promise.resolve({ data });

export const auditApi = {
  list: () =>
    isDemoMode()
      ? wrap<AuditLog[]>(demoAuditLogs.list())
      : client.get<AuditLog[]>("/audit"),
};
