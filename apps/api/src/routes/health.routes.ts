import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { ok } from '../lib/response.js';
import { metricsService } from '../services/metrics.service.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health/live', async () => ok({ status: 'ok', service: 'autopilotops-api', uptimeSeconds: Math.round(process.uptime()) }));

  app.get('/health/ready', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return ok({ status: 'ready', postgres: 'ok', redis: 'ok' });
    } catch {
      return reply.status(503).send({ error: { code: 'NOT_READY', message: 'Service dependencies are not ready.', requestId: request.id } });
    }
  });

  app.get('/metrics', { preHandler: [app.requireRole(Role.ADMIN)] }, async (request, reply) => {
    const tenantId = request.user.tenantId;
    const summary = await metricsService.tenantSummary(tenantId);
    reply.type('text/plain');
    return metricsService.toPrometheus(tenantId, summary);
  });
}
