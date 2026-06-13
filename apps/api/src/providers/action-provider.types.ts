import type { Action, Signal } from '@prisma/client';

export interface ActionExecutionInput {
  action: Action;
  signal?: Signal | null;
  requestId?: string | null;
  actor?: string;
  workerId?: string;
}

export interface ActionExecutionResult {
  provider: string;
  externalId?: string;
  statusCode?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface RollbackInput {
  action: Action;
  externalId?: string;
  reason?: string;
  requestId?: string | null;
}

export interface RollbackResult {
  provider: string;
  rolledBack: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface HealthCheckInput {
  tenantId?: string;
}

export interface HealthCheckResult {
  provider: string;
  healthy: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface ActionProvider {
  execute(input: ActionExecutionInput): Promise<ActionExecutionResult>;
  rollback?(input: RollbackInput): Promise<RollbackResult>;
  healthCheck?(input: HealthCheckInput): Promise<HealthCheckResult>;
}
