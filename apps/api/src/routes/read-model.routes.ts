import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IncidentStatus, RecommendationStatus, Role, Severity, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { toPagination } from '../lib/pagination.js';
import { ok, paginated } from '../lib/response.js';

const periodQuerySchema = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

export async function readModelRoutes(app: FastifyInstance) {
  app.get('/dashboard/summary', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const tenantId = request.user.tenantId;
    const [signals, incidentsOpen, approvalsPending, recommendationsOpen, tasksOpen, actionsWaiting, failedActions] = await Promise.all([
      prisma.signal.count({ where: { tenantId } }),
      prisma.incident.count({ where: { tenantId, status: { in: ['OPEN', 'INVESTIGATING', 'MITIGATING'] } } }),
      prisma.approvalRequest.count({ where: { tenantId, status: 'PENDING' } }),
      prisma.purchaseRecommendation.count({ where: { tenantId, status: 'OPEN' } }),
      prisma.operationalTask.count({ where: { tenantId, status: 'OPEN' } }),
      prisma.action.count({ where: { tenantId, status: 'WAITING_APPROVAL' } }),
      prisma.action.count({ where: { tenantId, status: 'FAILED' } })
    ]);
    return ok({ signals, incidentsOpen, approvalsPending, recommendationsOpen, tasksOpen, actionsWaiting, failedActions });
  });

  app.get('/incidents', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const query = periodQuerySchema.extend({ status: z.nativeEnum(IncidentStatus).optional(), severity: z.nativeEnum(Severity).optional() }).parse(request.query ?? {});
    const page = toPagination(query);
    const where = {
      tenantId: request.user.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...((query.from || query.to) ? { startedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {})
    };
    const [items, total] = await Promise.all([
      prisma.incident.findMany({ where, orderBy: { startedAt: 'desc' }, skip: page.skip, take: page.take }),
      prisma.incident.count({ where })
    ]);
    return paginated({ items, total, page: page.page, limit: page.limit });
  });

  app.get('/incidents/:id', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const item = await prisma.incident.findFirst({ where: { id, tenantId: request.user.tenantId } });
    if (!item) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Incident not found.', requestId: request.id } });
    return ok(item);
  });

  app.get('/purchase-recommendations', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const query = periodQuerySchema.extend({ status: z.nativeEnum(RecommendationStatus).optional() }).parse(request.query ?? {});
    const page = toPagination(query);
    const where = {
      tenantId: request.user.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...((query.from || query.to) ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {})
    };
    const [items, total] = await Promise.all([
      prisma.purchaseRecommendation.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
      prisma.purchaseRecommendation.count({ where })
    ]);
    return paginated({ items, total, page: page.page, limit: page.limit });
  });

  app.get('/tasks', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const query = periodQuerySchema.extend({ status: z.nativeEnum(TaskStatus).optional() }).parse(request.query ?? {});
    const page = toPagination(query);
    const where = {
      tenantId: request.user.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...((query.from || query.to) ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {})
    };
    const [items, total] = await Promise.all([
      prisma.operationalTask.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
      prisma.operationalTask.count({ where })
    ]);
    return paginated({ items, total, page: page.page, limit: page.limit });
  });

  app.get('/audit', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const query = periodQuerySchema.extend({ event: z.string().optional(), resourceType: z.string().optional() }).parse(request.query ?? {});
    const page = toPagination(query);
    const where = {
      tenantId: request.user.tenantId,
      ...(query.event ? { event: query.event } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...((query.from || query.to) ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {})
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.take }),
      prisma.auditLog.count({ where })
    ]);
    return paginated({ items, total, page: page.page, limit: page.limit });
  });
}
