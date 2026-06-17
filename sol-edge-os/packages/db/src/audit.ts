import { prisma } from "./client";

export type AuditInput = {
  actor: string; // "user:<uuid>" | "system" | "worker"
  action: string;
  entity?: string;
  entityId?: string;
  data?: unknown;
  ip?: string;
  userAgent?: string;
};

/// Write an append-only audit row. This is the only sanctioned way to record
/// that something happened. Audit rows can never be updated or deleted.
export async function writeAudit(input: AuditInput) {
  return prisma.auditLog.create({
    data: {
      actor: input.actor,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      data: input.data === undefined ? undefined : (input.data as object),
      ip: input.ip,
      userAgent: input.userAgent,
    },
  });
}
