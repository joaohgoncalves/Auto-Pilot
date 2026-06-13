import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ActionStatus, ApprovalStatus, OutboxEventStatus, RiskLevel, Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { toPagination } from '../lib/pagination.js';
import { audit, auditWithTx } from '../lib/audit.js';
import { assertRole } from '../middleware/authz.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { createOutboxEvent, OUTBOX_TYPES } from '../lib/outbox.js';
import { env } from '../config/env.js';
import { ok, paginated } from '../lib/response.js';

const RETRYABLE_ACTION_STATUSES: readonly ActionStatus[] = [
  ActionStatus.FAILED,
  ActionStatus.PENDING,
  ActionStatus.DEAD_LETTER
];

const listActionsQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  status: z.nativeEnum(ActionStatus).optional(),
  type: z.string().optional(),
  riskLevel: z.nativeEnum(RiskLevel).optional()
});

const decisionSchema = z.object({ reason: z.string().max(500).optional() });
const paramsSchema = z.object({ id: z.string().min(1) });

export async function actionsRoutes(app: FastifyInstance) {
  app.get('/actions', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const query = listActionsQuerySchema.parse(request.query ?? {});
    const page = toPagination(query);
    const where = {
      tenantId: request.user.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.riskLevel ? { riskLevel: query.riskLevel } : {})
    };
    const [items, total] = await Promise.all([
      prisma.action.findMany({ where, include: { approval: true, attempts: true }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
      prisma.action.count({ where })
    ]);
    return paginated({ items, total, page: page.page, limit: page.limit });
  });

  app.get('/actions/:id', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const action = await prisma.action.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: { signal: true, approval: true, attempts: { orderBy: { attemptNo: 'asc' } }, incident: true, recommendation: true, task: true, notificationDeliveries: true, deadLetters: true }
    });
    if (!action) throw notFound('Action not found.');
    return ok(action);
  });

  app.get('/actions/:id/attempts', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const action = await prisma.action.findFirst({ where: { id, tenantId: request.user.tenantId }, select: { id: true } });
    if (!action) throw notFound('Action not found.');
    const attempts = await prisma.actionAttempt.findMany({ where: { actionId: id, tenantId: request.user.tenantId }, orderBy: { attemptNo: 'asc' } });
    return ok(attempts);
  });

  app.post('/actions/:id/retry', { preHandler: [app.requireRole(Role.ADMIN)], config: { rateLimit: { max: env.ADMIN_RATE_LIMIT_MAX, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const body = decisionSchema.parse(request.body ?? {});
    const action = await prisma.action.findFirst({ where: { id, tenantId: request.user.tenantId } });
    if (!action) throw notFound('Action not found.');
    if (!RETRYABLE_ACTION_STATUSES.includes(action.status)) {
      throw conflict(`Action cannot be retried from status ${action.status}.`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.action.update({
        where: { id },
        data: {
          status: ActionStatus.PENDING,
          errorMessage: null,
          errorCode: null,
          lastError: null,
          lockedAt: null,
          lockedBy: null,
          heartbeatAt: null,
          lockExpiresAt: null,
          deadLetteredAt: null,
          maxAttempts: env.ACTION_MAX_ATTEMPTS,
          ...(action.status === ActionStatus.DEAD_LETTER ? { attemptCount: 0 } : {})
        }
      });
      await createOutboxEvent(tx, {
        tenantId: request.user.tenantId,
        type: OUTBOX_TYPES.EXECUTE_ACTION,
        payload: { actionId: id, reason: `manual-retry:${request.id}` },
        dedupeKey: `action.execute:${id}:manual-retry:${request.id}`,
        requestId: request.id,
        correlationId: action.correlationId
      });
      await auditWithTx(tx, {
        tenantId: request.user.tenantId,
        signalId: action.signalId,
        actor: 'api',
        actorUserId: request.user.sub,
        event: 'action.retry_requested',
        message: `Manual retry requested for action ${id}.`,
        resourceType: 'action',
        resourceId: id,
        requestId: request.id,
        correlationId: action.correlationId,
        metadata: { reason: body.reason }
      });
    });

    return reply.status(202).send(ok({ status: 'queued_via_outbox', actionId: id }));
  });

  app.get('/approvals', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const page = toPagination(request.query);
    const where = { tenantId: request.user.tenantId };
    const [items, total] = await Promise.all([
      prisma.approvalRequest.findMany({ where, include: { action: true }, orderBy: { requestedAt: 'desc' }, skip: page.skip, take: page.take }),
      prisma.approvalRequest.count({ where })
    ]);
    return paginated({ items, total, page: page.page, limit: page.limit });
  });

  app.post('/approvals/expire-pending', { preHandler: [app.requireRole(Role.ADMIN)], config: { rateLimit: { max: env.APPROVAL_RATE_LIMIT_MAX, timeWindow: '1 minute' } } }, async (request) => {
    const expired = await prisma.approvalRequest.findMany({
      where: { tenantId: request.user.tenantId, status: ApprovalStatus.PENDING, expiresAt: { lte: new Date() } },
      include: { action: true }
    });

    for (const approval of expired) {
      await prisma.$transaction(async (tx) => {
        await tx.approvalRequest.update({
          where: { id: approval.id },
          data: { status: ApprovalStatus.EXPIRED, decidedAt: new Date(), decisionReason: 'Expired by administrative cleanup.' }
        });
        await tx.action.update({ where: { id: approval.actionId }, data: { status: ActionStatus.CANCELED, errorMessage: 'Approval expired.' } });
        await auditWithTx(tx, {
          tenantId: request.user.tenantId,
          signalId: approval.action.signalId,
          actor: 'approval-workflow',
          actorUserId: request.user.sub,
          event: 'approval.expired',
          message: `Approval ${approval.id} expired.`,
          resourceType: 'approval',
          resourceId: approval.id,
          requestId: request.id,
          correlationId: approval.action.correlationId,
          metadata: { actionId: approval.actionId }
        });
      });
    }

    return ok({ expired: expired.length });
  });

  app.post('/approvals/:id/approve', { preHandler: [app.requireRole(Role.MANAGER)], config: { rateLimit: { max: env.APPROVAL_RATE_LIMIT_MAX, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const body = decisionSchema.parse(request.body ?? {});
    const approval = await prisma.approvalRequest.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: { action: true }
    });

    if (!approval) throw notFound('Approval not found.');
    assertRole(request.user.role, approval.minApproverRole);
    if (approval.status !== ApprovalStatus.PENDING) throw conflict('Approval already decided.');
    if (approval.expiresAt && approval.expiresAt.getTime() <= Date.now()) {
      await prisma.$transaction(async (tx) => {
        await tx.approvalRequest.update({ where: { id }, data: { status: ApprovalStatus.EXPIRED, decidedAt: new Date(), decisionReason: 'Expired before decision.' } });
        await tx.action.update({ where: { id: approval.actionId }, data: { status: ActionStatus.CANCELED, errorMessage: 'Approval expired.' } });
      });
      throw conflict('Approval is expired.');
    }
    if (!approval.selfApprovalAllowed && approval.requestedById === request.user.sub) {
      throw forbidden('The requester cannot approve this action.');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const decision = await tx.approvalRequest.updateMany({
        where: { id, tenantId: request.user.tenantId, status: ApprovalStatus.PENDING },
        data: { status: ApprovalStatus.APPROVED, decidedAt: new Date(), decidedById: request.user.sub, decisionReason: body.reason }
      });
      if (decision.count !== 1) return false;
      await tx.action.update({
        where: { id: approval.actionId },
        data: { status: ActionStatus.PENDING, requiresApproval: false, errorMessage: null, errorCode: null, lastError: null }
      });
      await createOutboxEvent(tx, {
        tenantId: request.user.tenantId,
        type: OUTBOX_TYPES.EXECUTE_ACTION,
        payload: { actionId: approval.actionId, reason: 'approval-approved' },
        dedupeKey: `action.execute:${approval.actionId}:approval-approved`,
        requestId: request.id,
        correlationId: approval.action.correlationId
      });
      await auditWithTx(tx, {
        tenantId: request.user.tenantId,
        actor: 'approval-workflow',
        actorUserId: request.user.sub,
        event: 'approval.approved',
        message: `Approval ${id} approved. Action was registered for asynchronous execution through the outbox.`,
        resourceType: 'approval',
        resourceId: id,
        requestId: request.id,
        correlationId: approval.action.correlationId,
        metadata: { actionId: approval.actionId, reason: body.reason }
      });
      return true;
    });
    if (!updated) throw conflict('Approval was already decided.');

    return reply.status(202).send(ok({ status: 'approved', actionId: approval.actionId, queuedViaOutbox: true }));
  });

  app.post('/approvals/:id/reject', { preHandler: [app.requireRole(Role.MANAGER)], config: { rateLimit: { max: env.APPROVAL_RATE_LIMIT_MAX, timeWindow: '1 minute' } } }, async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const body = decisionSchema.parse(request.body ?? {});
    const approval = await prisma.approvalRequest.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: { action: true }
    });

    if (!approval) throw notFound('Approval not found.');
    assertRole(request.user.role, approval.minApproverRole);
    if (approval.status !== ApprovalStatus.PENDING) throw conflict('Approval already decided.');

    const updated = await prisma.$transaction(async (tx) => {
      const decision = await tx.approvalRequest.updateMany({
        where: { id, tenantId: request.user.tenantId, status: ApprovalStatus.PENDING },
        data: { status: ApprovalStatus.REJECTED, decidedAt: new Date(), decidedById: request.user.sub, decisionReason: body.reason }
      });
      if (decision.count !== 1) return false;
      await tx.action.update({ where: { id: approval.actionId }, data: { status: ActionStatus.CANCELED, errorMessage: 'Approval rejected.' } });
      return true;
    });

    if (!updated) throw conflict('Approval was already decided.');

    await audit({
      tenantId: request.user.tenantId,
      actor: 'approval-workflow',
      actorUserId: request.user.sub,
      event: 'approval.rejected',
      message: `Approval ${id} rejected.`,
      resourceType: 'approval',
      resourceId: id,
      requestId: request.id,
      correlationId: approval.action.correlationId,
      metadata: { actionId: approval.actionId, reason: body.reason }
    });

    return ok({ status: 'rejected', actionId: approval.actionId });
  });

  app.get('/dead-letter', { preHandler: [app.requireRole(Role.ADMIN)] }, async (request) => {
    const page = toPagination(request.query);
    const where = { tenantId: request.user.tenantId };
    const [items, total] = await Promise.all([
      prisma.deadLetterEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
      prisma.deadLetterEvent.count({ where })
    ]);
    return paginated({ items, total, page: page.page, limit: page.limit });
  });

  app.post('/dead-letter/:id/reprocess', { preHandler: [app.requireRole(Role.ADMIN)], config: { rateLimit: { max: env.ADMIN_RATE_LIMIT_MAX, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const body = decisionSchema.parse(request.body ?? {});
    const deadLetter = await prisma.deadLetterEvent.findFirst({ where: { id, tenantId: request.user.tenantId } });
    if (!deadLetter) throw notFound('Dead-letter event not found.');
    if (deadLetter.status === 'REPROCESSED') throw conflict('Dead-letter event was already reprocessed.');

    await prisma.$transaction(async (tx) => {
      if (deadLetter.sourceType === 'ACTION' && deadLetter.actionId) {
        const action = await tx.action.findFirst({ where: { id: deadLetter.actionId, tenantId: request.user.tenantId } });
        if (!action) throw notFound('Action linked to dead-letter event was not found.');
        await tx.action.update({
          where: { id: action.id },
          data: {
            status: ActionStatus.PENDING,
            attemptCount: 0,
            maxAttempts: env.ACTION_MAX_ATTEMPTS,
            errorMessage: null,
            errorCode: null,
            lastError: null,
            lockedAt: null,
            lockedBy: null,
            heartbeatAt: null,
            lockExpiresAt: null,
            deadLetteredAt: null
          }
        });
        await createOutboxEvent(tx, {
          tenantId: request.user.tenantId,
          type: OUTBOX_TYPES.EXECUTE_ACTION,
          payload: { actionId: action.id, reason: `dead-letter-reprocess:${deadLetter.id}` },
          dedupeKey: `action.execute:${action.id}:dead-letter-reprocess:${deadLetter.id}`,
          requestId: request.id,
          correlationId: action.correlationId
        });
      } else if (deadLetter.sourceType === 'OUTBOX' && deadLetter.outboxEventId) {
        await tx.outboxEvent.update({
          where: { id: deadLetter.outboxEventId },
          data: { status: OutboxEventStatus.PENDING, attempts: 0, lastError: null, availableAt: new Date(), processedAt: null }
        });
      } else {
        throw conflict(`Unsupported dead-letter source type ${deadLetter.sourceType}.`);
      }

      await tx.deadLetterEvent.update({
        where: { id: deadLetter.id },
        data: { status: 'REPROCESSED', reprocessedAt: new Date() }
      });
      await auditWithTx(tx, {
        tenantId: request.user.tenantId,
        signalId: deadLetter.signalId,
        actor: 'api',
        actorUserId: request.user.sub,
        event: 'dead_letter.reprocess_requested',
        message: `Dead-letter event ${deadLetter.id} was scheduled for reprocessing.`,
        resourceType: 'dead_letter_event',
        resourceId: deadLetter.id,
        requestId: request.id,
        metadata: { reason: body.reason, sourceType: deadLetter.sourceType, sourceId: deadLetter.sourceId }
      });
    });

    return reply.status(202).send(ok({ status: 'reprocess_scheduled', deadLetterId: deadLetter.id }));
  });
}
