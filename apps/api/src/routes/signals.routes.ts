import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role, Severity, SignalStatus, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { auditWithTx } from '../lib/audit.js';
import { createOutboxEvent, OUTBOX_TYPES } from '../lib/outbox.js';
import { toPagination } from '../lib/pagination.js';
import { ok, paginated } from '../lib/response.js';
import { env } from '../config/env.js';

const signalSchema = z.object({
  source: z.string().min(1).max(120),
  type: z.string().min(1).max(160),
  entity: z.string().min(1).max(120),
  entityId: z.string().min(1).max(160),
  severity: z.enum(['info', 'warning', 'high', 'critical']),
  data: z.record(z.unknown()),
  idempotencyKey: z.string().min(8).max(160).optional()
});

const listSignalsQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  status: z.nativeEnum(SignalStatus).optional(),
  type: z.string().optional(),
  severity: z.nativeEnum(Severity).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

function toSeverity(value: string): Severity {
  const map: Record<string, Severity> = {
    info: Severity.INFO,
    warning: Severity.WARNING,
    high: Severity.HIGH,
    critical: Severity.CRITICAL
  };
  return map[value] ?? Severity.INFO;
}

export async function signalsRoutes(app: FastifyInstance) {
  app.post('/signals', { preHandler: [app.requireRole(Role.OPERATOR)], config: { rateLimit: { max: env.SIGNAL_RATE_LIMIT_MAX, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = signalSchema.parse(request.body);
    const tenantId = request.user.tenantId;

    if (body.idempotencyKey) {
      const existing = await prisma.signal.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: body.idempotencyKey } }
      });
      if (existing) {
        return reply.status(202).send(ok({
          signalId: existing.id,
          status: existing.status,
          correlationId: existing.correlationId,
          idempotentReplay: true
        }));
      }
    }

    const signal = await prisma.$transaction(async (tx) => {
      const created = await tx.signal.create({
        data: {
          tenantId,
          idempotencyKey: body.idempotencyKey,
          source: body.source,
          type: body.type,
          entity: body.entity,
          entityId: body.entityId,
          severity: toSeverity(body.severity),
          payload: body.data as Prisma.InputJsonValue,
          status: SignalStatus.RECEIVED,
          createdById: request.user.sub,
          requestId: request.id
        }
      });

      await auditWithTx(tx, {
        tenantId,
        signalId: created.id,
        actor: 'api',
        actorUserId: request.user.sub,
        event: 'signal.received',
        message: `Signal ${body.type} received from ${body.source}.`,
        resourceType: 'signal',
        resourceId: created.id,
        requestId: request.id,
        correlationId: created.correlationId,
        metadata: { entity: body.entity, entityId: body.entityId }
      });

      await createOutboxEvent(tx, {
        tenantId,
        type: OUTBOX_TYPES.PROCESS_SIGNAL,
        payload: { signalId: created.id },
        dedupeKey: `signal.process:${created.id}`,
        requestId: request.id,
        correlationId: created.correlationId
      });

      return created;
    });

    return reply.status(202).send(ok({ signalId: signal.id, status: 'received', correlationId: signal.correlationId }));
  });

  app.get('/signals', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const query = listSignalsQuerySchema.parse(request.query ?? {});
    const page = toPagination(query);
    const where = {
      tenantId: request.user.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...((query.from || query.to) ? { receivedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {})
    };
    const [items, total] = await Promise.all([
      prisma.signal.findMany({ where, orderBy: { receivedAt: 'desc' }, skip: page.skip, take: page.take }),
      prisma.signal.count({ where })
    ]);
    return paginated({ items, page: page.page, limit: page.limit, total });
  });

  app.get('/signals/:id', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const signal = await prisma.signal.findFirst({
      where: { id, tenantId: request.user.tenantId },
      include: { actions: { include: { approval: true, attempts: true }, orderBy: { createdAt: 'asc' } }, audits: { orderBy: { createdAt: 'desc' } } }
    });
    if (!signal) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Signal not found.', requestId: request.id } });
    return ok(signal);
  });
}
