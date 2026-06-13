import { env } from '../config/env.js';
import { asRecord } from '../lib/utils.js';
import type { ActionExecutionInput, ActionExecutionResult, ActionProvider, HealthCheckInput, HealthCheckResult } from './action-provider.types.js';

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function webhookUrl(payload: Record<string, unknown>) {
  const configuredUrl = typeof payload.webhookUrl === 'string' ? payload.webhookUrl : typeof payload.url === 'string' ? payload.url : undefined;
  return configuredUrl ?? env.WEBHOOK_PROVIDER_URL;
}

export class WebhookActionProvider implements ActionProvider {
  readonly name = 'webhook';

  async execute(input: ActionExecutionInput): Promise<ActionExecutionResult> {
    const payload = asRecord(input.action.payload);
    const url = webhookUrl(payload);
    if (!url) throw new Error('Webhook provider requires payload.webhookUrl or WEBHOOK_PROVIDER_URL.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.WEBHOOK_PROVIDER_TIMEOUT_MS);

    try {
      const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : 'POST';
      const headers = {
        'content-type': 'application/json',
        'x-autopilotops-action-id': input.action.id,
        'x-autopilotops-tenant-id': input.action.tenantId,
        ...(input.requestId ? { 'x-request-id': input.requestId } : {}),
        ...(env.WEBHOOK_PROVIDER_TOKEN ? { authorization: `Bearer ${env.WEBHOOK_PROVIDER_TOKEN}` } : {}),
        ...stringRecord(payload.headers)
      };

      const body = method === 'GET' || method === 'HEAD'
        ? undefined
        : JSON.stringify({
          actionId: input.action.id,
          tenantId: input.action.tenantId,
          type: input.action.type,
          title: input.action.title,
          riskLevel: input.action.riskLevel,
          payload: payload.body ?? payload,
          signal: input.signal ? { id: input.signal.id, type: input.signal.type, entity: input.signal.entity, entityId: input.signal.entityId, severity: input.signal.severity } : null
        });

      const response = await fetch(url, { method, headers, body, signal: controller.signal });
      const responseText = await response.text();
      if (!response.ok) throw new Error(`Webhook provider failed with HTTP ${response.status}: ${responseText.slice(0, 200)}`);

      return {
        provider: this.name,
        statusCode: response.status,
        externalId: response.headers.get('x-request-id') ?? response.headers.get('x-webhook-id') ?? undefined,
        message: responseText.slice(0, 500) || 'Webhook executed.',
        metadata: { url, method }
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async healthCheck(_input: HealthCheckInput): Promise<HealthCheckResult> {
    return { provider: this.name, healthy: Boolean(env.WEBHOOK_PROVIDER_URL), message: env.WEBHOOK_PROVIDER_URL ? 'Webhook URL configured.' : 'Webhook URL is not configured globally.' };
  }
}
