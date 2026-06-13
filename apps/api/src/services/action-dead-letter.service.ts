import { ActionStatus, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { auditWithTx } from '../lib/audit.js';
import { createDeadLetterEvent } from '../lib/outbox.js';
import { asRecord } from '../lib/utils.js';
import type { ActionWithSignal } from './action.types.js';

export interface MoveActionToDeadLetterInput {
  action: ActionWithSignal;
  reason: string;
  lastError: string;
  errorCode?: string;
  requestId?: string | null;
  attemptId?: string;
}

export class ActionDeadLetterService {
  async moveToDeadLetter(input: MoveActionToDeadLetterInput) {
    const signal = input.action.signal;
    await prisma.$transaction(async (tx) => {
      if (input.attemptId) {
        await tx.actionAttempt.updateMany({
          where: { id: input.attemptId },
          data: { status: 'FAILED', finishedAt: new Date(), errorCode: input.errorCode, errorMessage: input.lastError }
        });
      }

      await tx.action.update({
        where: { id: input.action.id },
        data: {
          status: ActionStatus.DEAD_LETTER,
          errorCode: input.errorCode ?? 'ACTION_DEAD_LETTER',
          errorMessage: input.lastError,
          lastError: input.lastError,
          failedAt: new Date(),
          deadLetteredAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          heartbeatAt: null,
          lockExpiresAt: null
        }
      });

      const deadLetter = await createDeadLetterEvent(tx, {
        tenantId: input.action.tenantId,
        sourceType: 'ACTION',
        sourceId: input.action.id,
        actionId: input.action.id,
        signalId: input.action.signalId,
        reason: input.reason,
        attempts: input.action.attemptCount,
        payload: asRecord(input.action.payload) as Prisma.InputJsonValue,
        queueName: 'action-execution',
        jobName: 'execute-action',
        errorCode: input.errorCode ?? 'ACTION_DEAD_LETTER',
        lastError: input.lastError
      });

      await auditWithTx(tx, {
        tenantId: input.action.tenantId,
        signalId: signal?.id ?? input.action.signalId,
        actor: 'action-worker',
        event: 'action.dead_lettered',
        message: `Action ${input.action.id} moved to dead-letter: ${input.lastError}`,
        resourceType: 'dead_letter_event',
        resourceId: deadLetter.id,
        requestId: input.requestId,
        correlationId: input.action.correlationId,
        metadata: { actionId: input.action.id, attempts: input.action.attemptCount, maxAttempts: input.action.maxAttempts, errorCode: input.errorCode }
      });
    });
  }
}

export async function moveActionToDeadLetter(input: MoveActionToDeadLetterInput) {
  return new ActionDeadLetterService().moveToDeadLetter(input);
}
