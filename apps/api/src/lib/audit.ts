import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

export interface AuditInput {
  tenantId: string;
  signalId?: string | null;
  actor: string;
  actorUserId?: string | null;
  event: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  requestId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

function toAuditCreate(input: AuditInput): Prisma.AuditLogUncheckedCreateInput {
  return {
    tenantId: input.tenantId,
    signalId: input.signalId ?? undefined,
    actor: input.actor,
    actorUserId: input.actorUserId ?? undefined,
    event: input.event,
    message: input.message,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    requestId: input.requestId ?? undefined,
    correlationId: input.correlationId ?? undefined,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonValue
  };
}

export async function audit(input: AuditInput) {
  return prisma.auditLog.create({ data: toAuditCreate(input) });
}

export async function auditWithTx(tx: Prisma.TransactionClient, input: AuditInput) {
  return tx.auditLog.create({ data: toAuditCreate(input) });
}
