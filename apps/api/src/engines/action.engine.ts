import type { Action, Signal } from '@prisma/client';
import { actionExecutionService } from '../services/action-execution.service.js';
import { ensureApprovalRequest } from '../services/approval.service.js';
import type { ActionExecutionResult } from '../services/action.types.js';

export { ensureApprovalRequest };
export type { ActionExecutionResult };

export async function executeActionById(actionId: string, options: { actor?: string; requestId?: string; workerId?: string } = {}): Promise<ActionExecutionResult> {
  return actionExecutionService.executeActionById(actionId, options);
}

export async function executeAction(action: Action, signal?: Signal | null, options: { actor?: string; requestId?: string; workerId?: string } = {}) {
  return actionExecutionService.executeAction(action, signal, options);
}
