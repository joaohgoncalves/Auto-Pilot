import { OutboxEventStatus, SignalStatus, type Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { actionJobId, actionQueue } from '../queues/action.queue.js';
import { signalJobId, signalQueue } from '../queues/signal.queue.js';
import { prisma } from '../lib/prisma.js';
import { createDeadLetterEvent, OUTBOX_TYPES } from '../lib/outbox.js';
import { auditWithTx } from '../lib/audit.js';
import { asRecord, safeErrorMessage } from '../lib/utils.js';

const DEFAULT_BATCH_SIZE = 25;
const OUTBOX_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const dispatcherId = `outbox-dispatcher:${process.pid}:${Math.random().toString(36).slice(2)}`;

function backoffForAttempt(attempts: number) {
  const seconds = Math.min(300, Math.pow(2, Math.max(0, attempts - 1)) * 5);
  return new Date(Date.now() + seconds * 1000);
}

async function dispatchEvent(event: { id: string; type: string; payload: unknown }) {
  const payload = asRecord(event.payload);

  if (event.type === OUTBOX_TYPES.PROCESS_SIGNAL) {
    const signalId = String(payload.signalId ?? '');
    if (!signalId) throw new Error('Outbox signal.process event is missing payload.signalId');
    await signalQueue.add('process-signal', { signalId }, { jobId: signalJobId(signalId) });
    await prisma.signal.updateMany({ where: { id: signalId, status: SignalStatus.RECEIVED }, data: { status: SignalStatus.QUEUED } });
    return;
  }

  if (event.type === OUTBOX_TYPES.EXECUTE_ACTION) {
    const actionId = String(payload.actionId ?? '');
    const reason = String(payload.reason ?? 'execute');
    if (!actionId) throw new Error('Outbox action.execute event is missing payload.actionId');
    await actionQueue.add('execute-action', { actionId, reason }, { jobId: actionJobId(actionId, reason) });
    return;
  }

  throw new Error(`Unknown outbox event type: ${event.type}`);
}

async function claimOutboxEvent(candidate: { id: string; maxAttempts: number }) {
  const now = new Date();
  const staleProcessingBefore = new Date(now.getTime() - OUTBOX_PROCESSING_TIMEOUT_MS);
  const claimed = await prisma.outboxEvent.updateMany({
    where: {
      id: candidate.id,
      attempts: { lt: candidate.maxAttempts },
      OR: [
        { status: { in: [OutboxEventStatus.PENDING, OutboxEventStatus.FAILED] }, availableAt: { lte: now } },
        { status: OutboxEventStatus.PROCESSING, processingStartedAt: { lte: staleProcessingBefore } }
      ]
    },
    data: { status: OutboxEventStatus.PROCESSING, attempts: { increment: 1 }, lastError: null, processingStartedAt: now, claimedBy: dispatcherId }
  });
  if (claimed.count !== 1) return null;
  return prisma.outboxEvent.findUnique({ where: { id: candidate.id } });
}

export async function dispatchOutboxBatch(batchSize = DEFAULT_BATCH_SIZE) {
  const now = new Date();
  const staleProcessingBefore = new Date(now.getTime() - OUTBOX_PROCESSING_TIMEOUT_MS);
  const candidates = await prisma.outboxEvent.findMany({
    where: {
      attempts: { lt: 1000 },
      OR: [
        { status: { in: [OutboxEventStatus.PENDING, OutboxEventStatus.FAILED] }, availableAt: { lte: now } },
        { status: OutboxEventStatus.PROCESSING, processingStartedAt: { lte: staleProcessingBefore } }
      ]
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize
  });

  let processed = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const candidate of candidates) {
    const event = await claimOutboxEvent(candidate);
    if (!event) continue;

    try {
      await dispatchEvent(event);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxEventStatus.PROCESSED, processedAt: new Date(), lastError: null, processingStartedAt: null, claimedBy: null }
      });
      processed += 1;
    } catch (error) {
      const message = safeErrorMessage(error, 'Unknown outbox dispatch error');
      const attemptsAfterClaim = event.attempts;
      const shouldDeadLetter = attemptsAfterClaim >= event.maxAttempts;

      await prisma.$transaction(async (tx) => {
        if (shouldDeadLetter) {
          await tx.outboxEvent.update({ where: { id: event.id }, data: { status: OutboxEventStatus.DEAD_LETTER, lastError: message, processingStartedAt: null, claimedBy: null } });
          await createDeadLetterEvent(tx, {
            tenantId: event.tenantId,
            sourceType: 'OUTBOX',
            sourceId: event.id,
            outboxEventId: event.id,
            reason: `Outbox dispatch failed after ${attemptsAfterClaim} attempts.`,
            attempts: attemptsAfterClaim,
            payload: asRecord(event.payload) as Prisma.InputJsonValue,
            queueName: event.type.startsWith('action.') ? 'action-execution' : 'signal-processing',
            jobName: event.type,
            lastError: message,
            errorCode: 'OUTBOX_DISPATCH_FAILED'
          });
          await auditWithTx(tx, {
            tenantId: event.tenantId,
            actor: 'outbox-dispatcher',
            event: 'outbox.dead_lettered',
            message: `Outbox event ${event.id} moved to dead-letter: ${message}`,
            resourceType: 'outbox_event',
            resourceId: event.id,
            requestId: event.requestId ?? undefined,
            correlationId: event.correlationId ?? undefined,
            metadata: { type: event.type, attempts: attemptsAfterClaim, dispatcherId }
          });
        } else {
          await tx.outboxEvent.update({
            where: { id: event.id },
            data: { status: OutboxEventStatus.FAILED, lastError: message, availableAt: backoffForAttempt(attemptsAfterClaim), processingStartedAt: null, claimedBy: null }
          });
        }
      });

      if (shouldDeadLetter) deadLettered += 1;
      else failed += 1;
    }
  }

  return { processed, failed, deadLettered };
}

export function startOutboxDispatcher() {
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await dispatchOutboxBatch(env.OUTBOX_DISPATCH_BATCH_SIZE);
    } catch (error) {
      console.error('Outbox dispatcher failed', error);
    } finally {
      running = false;
    }
  };

  const interval = setInterval(tick, env.OUTBOX_DISPATCH_INTERVAL_MS);
  void tick();

  return {
    async close() {
      stopped = true;
      clearInterval(interval);
      while (running) await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
}
