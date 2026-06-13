import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { auditWithTx } from '../lib/audit.js';
import { createOutboxEvent, OUTBOX_TYPES } from '../lib/outbox.js';
import { ok } from '../lib/response.js';

async function createDemoSignal(input: { tenantId: string; userId: string; requestId: string; kind: 'technical-regression' | 'retail-stockout' }) {
  const technical = input.kind === 'technical-regression';
  return prisma.$transaction(async (tx) => {
    const signal = await tx.signal.create({
      data: {
        tenantId: input.tenantId,
        source: technical ? 'deploy-monitor' : 'market-pos',
        type: technical ? 'service.error_rate_spike' : 'inventory.stockout_risk',
        entity: technical ? 'service' : 'product',
        entityId: technical ? 'payments-api' : 'SKU-COCA-2L',
        severity: technical ? 'CRITICAL' : 'WARNING',
        createdById: input.userId,
        requestId: input.requestId,
        payload: technical
          ? {
              serviceName: 'Payments API',
              errorRateBefore: 0.8,
              errorRateNow: 17.4,
              lastDeploymentMinutesAgo: 6,
              queueDepth: 14300,
              environment: 'production',
              deploymentVersion: '2026.06.09-1842'
            }
          : {
              productName: 'Coca-Cola 2L',
              currentStock: 6,
              dailySalesAverage: 22,
              supplierLeadTimeDays: 1,
              minimumDisplayStock: 8,
              primarySupplier: 'Distribuidora Alfa'
            }
      }
    });

    await auditWithTx(tx, {
      tenantId: input.tenantId,
      signalId: signal.id,
      actor: 'api.demo',
      actorUserId: input.userId,
      event: 'signal.received',
      message: `Demo signal ${signal.type} was created.`,
      resourceType: 'signal',
      resourceId: signal.id,
      requestId: input.requestId,
      correlationId: signal.correlationId
    });

    await createOutboxEvent(tx, {
      tenantId: input.tenantId,
      type: OUTBOX_TYPES.PROCESS_SIGNAL,
      payload: { signalId: signal.id },
      dedupeKey: `signal.process:${signal.id}`,
      requestId: input.requestId,
      correlationId: signal.correlationId
    });

    return signal;
  });
}

export async function demoRoutes(app: FastifyInstance) {
  app.post('/demo/technical-regression', { preHandler: [app.requireRole(Role.OPERATOR)] }, async (request, reply) => {
    const signal = await createDemoSignal({ tenantId: request.user.tenantId, userId: request.user.sub, requestId: request.id, kind: 'technical-regression' });
    return reply.status(202).send(ok({ signalId: signal.id, demo: 'technical-regression', correlationId: signal.correlationId, queuedViaOutbox: true }));
  });

  app.post('/demo/retail-stockout', { preHandler: [app.requireRole(Role.OPERATOR)] }, async (request, reply) => {
    const signal = await createDemoSignal({ tenantId: request.user.tenantId, userId: request.user.sub, requestId: request.id, kind: 'retail-stockout' });
    return reply.status(202).send(ok({ signalId: signal.id, demo: 'retail-stockout', correlationId: signal.correlationId, queuedViaOutbox: true }));
  });
}
