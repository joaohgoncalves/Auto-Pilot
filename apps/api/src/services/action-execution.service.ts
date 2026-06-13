import { ActionStatus, type Action, type Signal } from '@prisma/client';
import { auditWithTx, audit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';
import { ApprovalService } from './approval.service.js';
import { ActionClaimService } from './action-claim.service.js';
import { moveActionToDeadLetter } from './action-dead-letter.service.js';
import { classifyActionError } from './action-error-classifier.js';
import { ActionSideEffectsService, markExecuted } from './action-side-effects.js';
import type { ActionExecutionResult, ActionWorkerOptions } from './action.types.js';

export class ActionExecutionService {
  constructor(
    private readonly claimService = new ActionClaimService(),
    private readonly sideEffects = new ActionSideEffectsService(),
    private readonly approvalService = new ApprovalService()
  ) {}

  async executeActionById(actionId: string, options: ActionWorkerOptions = {}): Promise<ActionExecutionResult> {
    const claimed = await this.claimService.claim(actionId, options);
    if (!claimed) {
      const current = await prisma.action.findUnique({ where: { id: actionId } });
      if (!current) return { skipped: true, reason: 'Action not found.' };
      if (current.status === ActionStatus.WAITING_APPROVAL || current.requiresApproval) {
        await this.approvalService.ensureApprovalRequest({ action: current, requestId: options.requestId, reason: current.approvalReason ?? undefined });
        return { skipped: true, reason: 'Action requires approval.' };
      }
      return { skipped: true, reason: `Action is ${current.status}.` };
    }

    const action = claimed;
    const attemptNo = action.attemptCount;
    const attempt = await prisma.actionAttempt.create({
      data: { tenantId: action.tenantId, actionId: action.id, attemptNo, workerId: options.workerId, requestId: options.requestId }
    });

    const heartbeatTimer = options.workerId
      ? setInterval(() => void this.claimService.heartbeat(action.id, options.workerId), 30_000)
      : null;

    try {
      await this.sideEffects.execute(action, options);
      await prisma.actionAttempt.update({ where: { id: attempt.id }, data: { status: 'SUCCEEDED', finishedAt: new Date() } });
      await markExecuted(action);
      await audit({
        tenantId: action.tenantId,
        signalId: action.signal?.id,
        actor: options.actor ?? 'action-engine',
        event: 'action.executed',
        message: `Action ${action.id} executed idempotently.`,
        resourceType: 'action',
        resourceId: action.id,
        requestId: options.requestId,
        correlationId: action.correlationId,
        metadata: { attemptId: attempt.id }
      });
      return { skipped: false, executed: true };
    } catch (error) {
      const classified = classifyActionError(error, { actionId: action.id, actionType: action.type, attemptNo, maxAttempts: action.maxAttempts });
      const isFinalAttempt = !classified.retryable || attemptNo >= action.maxAttempts;

      if (isFinalAttempt) {
        await moveActionToDeadLetter({
          action,
          attemptId: attempt.id,
          reason: classified.retryable ? `Action failed after ${attemptNo} attempts.` : `Fatal action failure: ${classified.kind}.`,
          lastError: classified.safeMessage,
          errorCode: classified.code,
          requestId: options.requestId
        });
        return { skipped: false, failed: true, retryable: false, reason: classified.safeMessage };
      }

      await prisma.$transaction(async (tx) => {
        await tx.actionAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', finishedAt: new Date(), errorCode: classified.code, errorMessage: classified.safeMessage } });
        await tx.action.update({
          where: { id: action.id },
          data: {
            status: ActionStatus.FAILED,
            errorCode: classified.code,
            errorMessage: classified.safeMessage,
            lastError: classified.safeMessage,
            failedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            heartbeatAt: null,
            lockExpiresAt: null
          }
        });
        await auditWithTx(tx, {
          tenantId: action.tenantId,
          signalId: action.signal?.id,
          actor: 'action-engine',
          event: 'action.failed',
          message: `Action ${action.id} failed: ${classified.safeMessage}`,
          resourceType: 'action',
          resourceId: action.id,
          requestId: options.requestId,
          correlationId: action.correlationId,
          metadata: { errorCode: classified.code, errorKind: classified.kind, retryable: classified.retryable, attemptNo, maxAttempts: action.maxAttempts }
        });
      });
      return { skipped: false, failed: true, retryable: true, reason: classified.safeMessage };
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  async executeAction(action: Action, _signal?: Signal | null, options: ActionWorkerOptions = {}) {
    return this.executeActionById(action.id, options);
  }
}

export const actionExecutionService = new ActionExecutionService();
