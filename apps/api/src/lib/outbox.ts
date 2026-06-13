import { OutboxEventStatus, type Prisma } from '@prisma/client';

type JsonObject = Record<string, unknown>;

export const OUTBOX_TYPES = {
  PROCESS_SIGNAL: 'signal.process',
  EXECUTE_ACTION: 'action.execute'
} as const;

export async function createOutboxEvent(tx: Prisma.TransactionClient, input: {
  tenantId: string;
  type: string;
  payload: JsonObject;
  dedupeKey: string;
  requestId?: string | null;
  correlationId?: string | null;
  availableAt?: Date;
  maxAttempts?: number;
}) {
  return tx.outboxEvent.upsert({
    where: {
      tenantId_type_dedupeKey: {
        tenantId: input.tenantId,
        type: input.type,
        dedupeKey: input.dedupeKey
      }
    },
    update: {
      // A processed outbox event is immutable. Failed/dead-letter events are intentionally not reset here;
      // reprocessing must go through the explicit admin endpoint.
    },
    create: {
      tenantId: input.tenantId,
      type: input.type,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
      status: OutboxEventStatus.PENDING,
      availableAt: input.availableAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
      requestId: input.requestId ?? undefined,
      correlationId: input.correlationId ?? undefined
    }
  });
}

export async function createDeadLetterEvent(tx: Prisma.TransactionClient, input: {
  tenantId: string;
  sourceType: string;
  sourceId: string;
  reason: string;
  attempts: number;
  payload: JsonObject;
  actionId?: string | null;
  signalId?: string | null;
  outboxEventId?: string | null;
  queueName?: string | null;
  jobName?: string | null;
  errorCode?: string | null;
  lastError?: string | null;
}) {
  return tx.deadLetterEvent.upsert({
    where: {
      tenantId_sourceType_sourceId: {
        tenantId: input.tenantId,
        sourceType: input.sourceType,
        sourceId: input.sourceId
      }
    },
    update: {
      reason: input.reason,
      attempts: input.attempts,
      payload: input.payload,
      actionId: input.actionId ?? undefined,
      signalId: input.signalId ?? undefined,
      outboxEventId: input.outboxEventId ?? undefined,
      queueName: input.queueName ?? undefined,
      jobName: input.jobName ?? undefined,
      errorCode: input.errorCode ?? undefined,
      lastError: input.lastError ?? undefined,
      status: 'OPEN'
    },
    create: {
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reason: input.reason,
      attempts: input.attempts,
      payload: input.payload,
      actionId: input.actionId ?? undefined,
      signalId: input.signalId ?? undefined,
      outboxEventId: input.outboxEventId ?? undefined,
      queueName: input.queueName ?? undefined,
      jobName: input.jobName ?? undefined,
      errorCode: input.errorCode ?? undefined,
      lastError: input.lastError ?? undefined
    }
  });
}
