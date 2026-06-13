import type { Action, Signal } from '@prisma/client';

export type ActionWithSignal = Action & { signal?: Signal | null };

export interface ActionExecutionResult {
  skipped?: boolean;
  executed?: boolean;
  failed?: boolean;
  retryable?: boolean;
  reason?: string;
}

export interface ActionWorkerOptions {
  actor?: string;
  requestId?: string | null;
  workerId?: string;
}
