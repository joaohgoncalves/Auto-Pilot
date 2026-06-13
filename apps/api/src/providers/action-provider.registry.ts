import type { Action } from '@prisma/client';
import { asRecord } from '../lib/utils.js';
import type { ActionProvider } from './action-provider.types.js';
import { WebhookActionProvider } from './webhook.provider.js';

const providers = new Map<string, ActionProvider>([
  ['webhook', new WebhookActionProvider()]
]);

export function registerActionProvider(name: string, provider: ActionProvider) {
  providers.set(name, provider);
}

export function resolveActionProvider(action: Action): ActionProvider | null {
  const payload = asRecord(action.payload);
  const providerName = typeof payload.provider === 'string'
    ? payload.provider
    : action.type === 'webhook' || action.type === 'generic_webhook'
      ? 'webhook'
      : undefined;

  return providerName ? providers.get(providerName) ?? null : null;
}

export function listActionProviders() {
  return [...providers.keys()];
}
