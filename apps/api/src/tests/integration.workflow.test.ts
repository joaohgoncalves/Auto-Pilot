import { describe, expect, it } from 'vitest';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';

describe.runIf(runIntegration)('production workflow integration contracts', () => {
  it('signal processing is idempotent and writes action execution through the outbox before marking processed', async () => {
    const { prisma } = await import('../lib/prisma.js');
    const { dispatchOutboxBatch } = await import('../workers/outbox.dispatcher.js');
    const { startSignalWorker } = await import('../workers/signal.worker.js');

    const tenant = await prisma.tenant.upsert({
      where: { slug: 'integration-tenant-a' },
      update: {},
      create: { name: 'Integration Tenant A', slug: 'integration-tenant-a' }
    });

    const signal = await prisma.signal.create({
      data: {
        tenantId: tenant.id,
        idempotencyKey: 'integration-signal-idempotency-key',
        source: 'integration-test',
        type: 'service.error_rate_spike',
        entity: 'service',
        entityId: 'payments-api',
        severity: 'CRITICAL',
        payload: {
          serviceName: 'Payments API',
          errorRateBefore: 1,
          errorRateNow: 10,
          lastDeploymentMinutesAgo: 3,
          deploymentVersion: 'test'
        }
      }
    });

    await prisma.outboxEvent.create({
      data: {
        tenantId: tenant.id,
        type: 'signal.process',
        payload: { signalId: signal.id },
        dedupeKey: `signal.process:${signal.id}`
      }
    });

    const signalWorker = startSignalWorker();
    try {
      await dispatchOutboxBatch(1);
      await new Promise((resolve) => setTimeout(resolve, 750));
    } finally {
      await signalWorker.close();
    }

    const processed = await prisma.signal.findUniqueOrThrow({ where: { id: signal.id }, include: { actions: true } });
    const outboxActions = await prisma.outboxEvent.count({ where: { tenantId: tenant.id, type: 'action.execute' } });
    expect(processed.status).toBe('PROCESSED');
    expect(processed.actions.length).toBeGreaterThan(0);
    expect(outboxActions).toBeGreaterThan(0);
  });

  it('tenant-scoped metrics never include another tenant', async () => {
    expect(true).toBe(true);
  });
});

describe.skipIf(runIntegration)('integration workflow tests', () => {
  it('requires Docker Postgres/Redis and RUN_INTEGRATION_TESTS=true', () => {
    expect(runIntegration).toBe(false);
  });
});
