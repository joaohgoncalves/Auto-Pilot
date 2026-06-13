import { describe, expect, it } from 'vitest';
import { signAccessToken } from '../lib/security.js';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe.runIf(runIntegration).sequential('production workflow integration contracts', () => {
  it('signal processing is idempotent and writes action execution through the outbox before marking processed', async () => {
    const { prisma } = await import('../lib/prisma.js');
    const { dispatchOutboxBatch } = await import('../workers/outbox.dispatcher.js');
    const { startSignalWorker } = await import('../workers/signal.worker.js');
    const id = suffix();

    await prisma.outboxEvent.deleteMany({ where: { status: { in: ['PENDING', 'FAILED', 'PROCESSING'] } } });
    const tenant = await prisma.tenant.create({ data: { name: `Integration Tenant ${id}`, slug: `integration-tenant-${id}` } });

    const signal = await prisma.signal.create({
      data: {
        tenantId: tenant.id,
        idempotencyKey: `integration-signal-${id}`,
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
      await signalWorker.waitUntilReady();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        await dispatchOutboxBatch(1000);
        const current = await prisma.signal.findUniqueOrThrow({ where: { id: signal.id }, select: { status: true } });
        if (current.status === 'PROCESSED') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      await signalWorker.close();
    }

    const processed = await prisma.signal.findUniqueOrThrow({ where: { id: signal.id }, include: { actions: true } });
    const outboxActions = await prisma.outboxEvent.count({ where: { tenantId: tenant.id, type: 'action.execute' } });
    expect(processed.status).toBe('PROCESSED');
    expect(processed.actions.length).toBeGreaterThan(0);
    expect(outboxActions).toBeGreaterThan(0);
  }, 15000);

  it('handles a controlled concurrent idempotency burst for the same signal', async () => {
    const { buildApp } = await import('../app.js');
    const { prisma } = await import('../lib/prisma.js');
    const id = suffix();
    const tenant = await prisma.tenant.create({ data: { name: `Load Tenant ${id}`, slug: `load-tenant-${id}` } });
    const user = await prisma.user.create({ data: { name: `Load User ${id}`, email: `load-${id}@example.test`, passwordHash: 'not-used' } });
    await prisma.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'OPERATOR' } });

    const token = signAccessToken({ sub: user.id, tenantId: tenant.id, role: 'OPERATOR' });
    const app = buildApp();
    const idempotencyKey = `same-signal-${id}`;

    try {
      const responses = await Promise.all(Array.from({ length: 12 }, () => app.inject({
        method: 'POST',
        url: '/signals',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          source: 'load-test',
          type: 'inventory.stockout_risk',
          entity: 'sku',
          entityId: 'sku-123',
          severity: 'warning',
          idempotencyKey,
          data: {
            productName: 'Test SKU',
            currentStock: 2,
            dailySalesAverage: 10,
            supplierLeadTimeDays: 2
          }
        }
      })));

      expect(responses.every((response) => response.statusCode === 202)).toBe(true);
      const signalIds = new Set(responses.map((response) => response.json().data.signalId));
      expect(signalIds.size).toBe(1);
      await expect(prisma.signal.count({ where: { tenantId: tenant.id, idempotencyKey } })).resolves.toBe(1);
      await expect(prisma.outboxEvent.count({ where: { tenantId: tenant.id, type: 'signal.process' } })).resolves.toBe(1);
    } finally {
      await app.close();
    }
  });

  it('dispatches a controlled outbox burst once under concurrent dispatchers', async () => {
    const { prisma } = await import('../lib/prisma.js');
    const { dispatchOutboxBatch } = await import('../workers/outbox.dispatcher.js');
    const id = suffix();
    const tenant = await prisma.tenant.create({ data: { name: `Outbox Tenant ${id}`, slug: `outbox-tenant-${id}` } });
    await prisma.outboxEvent.deleteMany({ where: { status: { in: ['PENDING', 'FAILED', 'PROCESSING'] } } });

    await prisma.outboxEvent.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        tenantId: tenant.id,
        type: 'action.execute',
        payload: { actionId: `load-action-${id}-${index}`, reason: 'load-test' },
        dedupeKey: `load-action-${id}-${index}`,
        maxAttempts: 3
      }))
    });

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await Promise.all(Array.from({ length: 6 }, () => dispatchOutboxBatch(1000)));
      const processed = await prisma.outboxEvent.count({ where: { tenantId: tenant.id, status: 'PROCESSED' } });
      if (processed === 30) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const events = await prisma.outboxEvent.findMany({ where: { tenantId: tenant.id }, select: { status: true, attempts: true } });
    expect(events).toHaveLength(30);
    expect(events.every((event) => event.status === 'PROCESSED')).toBe(true);
    expect(events.reduce((sum, event) => sum + event.attempts, 0)).toBe(30);
  }, 15000);

  it('allows only one concurrent worker to execute the same action', async () => {
    const { prisma } = await import('../lib/prisma.js');
    const { executeActionById } = await import('../engines/action.engine.js');
    const id = suffix();
    const tenant = await prisma.tenant.create({ data: { name: `Worker Tenant ${id}`, slug: `worker-tenant-${id}` } });
    const action = await prisma.action.create({
      data: {
        tenantId: tenant.id,
        type: 'create_operational_task',
        title: 'Concurrent worker action',
        riskLevel: 'LOW',
        status: 'PENDING',
        dedupeKey: `worker-action-${id}`,
        payload: { title: 'Concurrent task', description: 'Created once despite concurrent workers.' },
        maxAttempts: 3
      }
    });

    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => executeActionById(action.id, {
      workerId: `test-worker-${index}`,
      requestId: `test-request-${index}`
    })));

    const executed = results.filter((result) => result.executed).length;
    const stored = await prisma.action.findUniqueOrThrow({ where: { id: action.id }, include: { attempts: true, task: true } });
    expect(executed).toBe(1);
    expect(stored.status).toBe('EXECUTED');
    expect(stored.attempts).toHaveLength(1);
    expect(stored.task).toBeTruthy();
  });
});

describe.skipIf(runIntegration)('integration workflow tests', () => {
  it('requires Docker Postgres/Redis and RUN_INTEGRATION_TESTS=true', () => {
    expect(runIntegration).toBe(false);
  });
});
