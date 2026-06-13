import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { toPagination } from '../lib/pagination.js';
import { audit } from '../lib/audit.js';
import { ok, paginated } from '../lib/response.js';
import { notFound } from '../lib/errors.js';
import { ruleConditionsSchema } from '../engines/condition.engine.js';
import { ruleActionsSchema } from '../engines/rule.engine.js';
import { ruleEngineService } from '../services/rule-engine.service.js';
import { env } from '../config/env.js';

const createRuleSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(500).optional(),
  triggerType: z.string().min(1).max(160),
  conditions: ruleConditionsSchema,
  actions: ruleActionsSchema,
  priority: z.number().int().min(1).max(9999).default(100),
  isActive: z.boolean().default(true)
});

const updateRuleSchema = createRuleSchema.partial();

export async function rulesRoutes(app: FastifyInstance) {
  app.get('/rules', { preHandler: [app.requireRole(Role.VIEWER)] }, async (request) => {
    const page = toPagination(request.query);
    const [items, total] = await Promise.all([
      prisma.rule.findMany({
        where: { tenantId: request.user.tenantId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        skip: page.skip,
        take: page.take,
        select: { id: true, name: true, description: true, triggerType: true, conditions: true, actions: true, priority: true, isActive: true, createdAt: true, updatedAt: true }
      }),
      prisma.rule.count({ where: { tenantId: request.user.tenantId } })
    ]);
    return paginated({ items, total, page: page.page, limit: page.limit });
  });

  app.post('/rules', {
    preHandler: [app.requireRole(Role.ADMIN)],
    config: { rateLimit: { max: env.RULE_RATE_LIMIT_MAX, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const body = createRuleSchema.parse(request.body);
    const rule = await prisma.rule.create({
      data: {
        tenantId: request.user.tenantId,
        name: body.name,
        description: body.description,
        triggerType: body.triggerType,
        conditions: body.conditions,
        actions: body.actions,
        priority: body.priority,
        isActive: body.isActive,
        createdById: request.user.sub,
        updatedById: request.user.sub
      }
    });
    await ruleEngineService.invalidateRules(request.user.tenantId, rule.triggerType);
    await audit({
      tenantId: request.user.tenantId,
      actor: 'api',
      actorUserId: request.user.sub,
      event: 'rule.created',
      message: `Rule ${rule.name} created.`,
      resourceType: 'rule',
      resourceId: rule.id,
      requestId: request.id,
      metadata: { triggerType: rule.triggerType, priority: rule.priority }
    });
    return reply.status(201).send(ok(rule));
  });

  app.patch('/rules/:id', {
    preHandler: [app.requireRole(Role.ADMIN)],
    config: { rateLimit: { max: env.RULE_RATE_LIMIT_MAX, timeWindow: '1 minute' } }
  }, async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = updateRuleSchema.parse(request.body ?? {});
    const current = await prisma.rule.findFirst({ where: { id, tenantId: request.user.tenantId } });
    if (!current) throw notFound('Rule not found.');

    const rule = await prisma.rule.update({ where: { id }, data: { ...body, updatedById: request.user.sub } });
    await ruleEngineService.invalidateRules(request.user.tenantId, current.triggerType);
    if (rule.triggerType !== current.triggerType) await ruleEngineService.invalidateRules(request.user.tenantId, rule.triggerType);
    await audit({
      tenantId: request.user.tenantId,
      actor: 'api',
      actorUserId: request.user.sub,
      event: 'rule.updated',
      message: `Rule ${rule.name} updated.`,
      resourceType: 'rule',
      resourceId: rule.id,
      requestId: request.id,
      metadata: body
    });
    return ok(rule);
  });
}
