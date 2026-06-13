import { ActionStatus } from '@prisma/client';
import { env } from '../config/env.js';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';
import { moveActionToDeadLetter } from './action-dead-letter.service.js';
import type { ActionWithSignal } from './action.types.js';

export interface ClaimActionOptions {
  workerId?: string;
  requestId?: string;
}

export class ActionClaimService {
  async claim(actionId: string, options: ClaimActionOptions = {}): Promise<ActionWithSignal | null> {
    const now = new Date();
    const current = await prisma.action.findUnique({ where: { id: actionId }, include: { signal: true } });
    if (!current) return null;

    if (current.requiresApproval || current.status === ActionStatus.WAITING_APPROVAL) return null;
    if ([ActionStatus.EXECUTED, ActionStatus.SKIPPED, ActionStatus.CANCELED, ActionStatus.REJECTED, ActionStatus.DEAD_LETTER].includes(current.status)) return null;

    if (current.attemptCount >= current.maxAttempts) {
      await moveActionToDeadLetter({
        action: current,
        reason: `Action exceeded max attempts (${current.maxAttempts}).`,
        lastError: current.lastError ?? current.errorMessage ?? 'Max attempts exceeded.',
        errorCode: current.errorCode ?? 'MAX_ATTEMPTS_EXCEEDED',
        requestId: options.requestId
      });
      return null;
    }

    const lockExpiresAt = new Date(Date.now() + env.ACTION_LOCK_TTL_SECONDS * 1000);
    const staleRunning = current.status === ActionStatus.RUNNING && current.lockExpiresAt !== null && current.lockExpiresAt.getTime() <= now.getTime();

    const claimed = await prisma.action.updateMany({
      where: {
        id: actionId,
        requiresApproval: false,
        attemptCount: { lt: current.maxAttempts },
        OR: [
          { status: ActionStatus.PENDING },
          { status: ActionStatus.FAILED },
          { status: ActionStatus.RUNNING, lockExpiresAt: { lte: now } }
        ]
      },
      data: {
        status: ActionStatus.RUNNING,
        lockedAt: now,
        lockedBy: options.workerId,
        heartbeatAt: now,
        lockExpiresAt,
        errorMessage: null,
        errorCode: null,
        lastError: null,
        attemptCount: { increment: 1 }
      }
    });

    if (claimed.count !== 1) return null;

    const claimedAction = await prisma.action.findUnique({ where: { id: actionId }, include: { signal: true } });

    if (claimedAction && staleRunning) {
      await audit({
        tenantId: claimedAction.tenantId,
        signalId: claimedAction.signalId,
        actor: 'action-worker',
        event: 'action.expired_lock_recovered',
        message: `Expired RUNNING lock for action ${claimedAction.id} was reclaimed by ${options.workerId ?? 'unknown worker'}.`,
        resourceType: 'action',
        resourceId: claimedAction.id,
        requestId: options.requestId,
        correlationId: claimedAction.correlationId,
        metadata: { previousLockedBy: current.lockedBy, previousLockExpiresAt: current.lockExpiresAt?.toISOString() }
      });
    }

    return claimedAction;
  }

  async heartbeat(actionId: string, workerId?: string) {
    const now = new Date();
    const lockExpiresAt = new Date(Date.now() + env.ACTION_LOCK_TTL_SECONDS * 1000);
    return prisma.action.updateMany({
      where: { id: actionId, status: ActionStatus.RUNNING, ...(workerId ? { lockedBy: workerId } : {}) },
      data: { heartbeatAt: now, lockExpiresAt }
    });
  }
}

export async function claimAction(actionId: string, options: ClaimActionOptions = {}) {
  return new ActionClaimService().claim(actionId, options);
}
