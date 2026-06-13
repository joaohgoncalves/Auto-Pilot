import { ActionStatus, RiskLevel, Severity, type Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookActionProvider } from '../providers/webhook.provider.js';
import type { ActionWithSignal } from '../services/action.types.js';

function action(payload: Record<string, unknown>): ActionWithSignal {
  const now = new Date();
  return {
    id: 'action_1',
    tenantId: 'tenant_1',
    signalId: 'signal_1',
    ruleId: null,
    type: 'generic_webhook',
    title: 'Call webhook',
    riskLevel: RiskLevel.LOW,
    status: ActionStatus.RUNNING,
    requiresApproval: false,
    approvalReason: null,
    dedupeKey: 'action_1',
    payload: payload as Prisma.JsonValue,
    errorMessage: null,
    errorCode: null,
    lastError: null,
    attemptCount: 1,
    maxAttempts: 3,
    lockedAt: now,
    lockedBy: 'worker_1',
    heartbeatAt: now,
    lockExpiresAt: now,
    executedAt: null,
    failedAt: null,
    deadLetteredAt: null,
    createdAt: now,
    updatedAt: now,
    createdById: null,
    requestId: 'request_1',
    correlationId: 'correlation_1',
    signal: {
      id: 'signal_1',
      tenantId: 'tenant_1',
      idempotencyKey: 'idem_1',
      source: 'test',
      type: 'test.signal',
      entity: 'service',
      entityId: 'payments',
      severity: Severity.INFO,
      payload: {},
      diagnosis: null,
      riskLevel: null,
      status: 'PROCESSED',
      receivedAt: now,
      processedAt: now,
      failedAt: null,
      failureReason: null,
      createdById: null,
      requestId: 'request_1',
      correlationId: 'correlation_1'
    }
  };
}

describe('WebhookActionProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts action and signal context to a configured webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('accepted', { status: 202, headers: { 'x-webhook-id': 'external_1' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new WebhookActionProvider().execute({
      action: action({ webhookUrl: 'https://example.test/hooks/autopilot', body: { ok: true }, headers: { 'x-custom': 'yes' } }),
      signal: action({}).signal,
      requestId: 'request_1',
      workerId: 'worker_1'
    });

    expect(result).toMatchObject({ provider: 'webhook', statusCode: 202, externalId: 'external_1' });
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/hooks/autopilot', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'content-type': 'application/json',
        'x-autopilotops-action-id': 'action_1',
        'x-autopilotops-tenant-id': 'tenant_1',
        'x-request-id': 'request_1',
        'x-custom': 'yes'
      })
    }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      actionId: 'action_1',
      tenantId: 'tenant_1',
      type: 'generic_webhook',
      payload: { ok: true },
      signal: { id: 'signal_1', type: 'test.signal' }
    });
  });

  it('fails loudly when no webhook URL is configured', async () => {
    await expect(new WebhookActionProvider().execute({ action: action({}) })).rejects.toThrow('Webhook provider requires');
  });
});
