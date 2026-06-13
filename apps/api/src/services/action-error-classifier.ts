export const ACTION_ERROR_CODES = {
  RETRYABLE: 'RETRYABLE',
  FATAL: 'FATAL',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  EXTERNAL_DEPENDENCY_ERROR: 'EXTERNAL_DEPENDENCY_ERROR',
  TENANT_POLICY_ERROR: 'TENANT_POLICY_ERROR',
  UNKNOWN_ACTION_TYPE: 'UNKNOWN_ACTION_TYPE',
  LOCK_EXPIRED: 'LOCK_EXPIRED',
  OUTBOX_DISPATCH_FAILED: 'OUTBOX_DISPATCH_FAILED',
  ACTION_EXECUTION_FAILED: 'ACTION_EXECUTION_FAILED',
  MAX_ATTEMPTS_EXCEEDED: 'MAX_ATTEMPTS_EXCEEDED'
} as const;

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[keyof typeof ACTION_ERROR_CODES];
export type ActionErrorKind =
  | 'RETRYABLE'
  | 'FATAL'
  | 'VALIDATION_ERROR'
  | 'EXTERNAL_DEPENDENCY_ERROR'
  | 'TENANT_POLICY_ERROR'
  | 'UNKNOWN_ACTION_TYPE'
  | 'LOCK_EXPIRED'
  | 'OUTBOX_DISPATCH_FAILED';

export interface ClassifiedActionError {
  kind: ActionErrorKind;
  code: ActionErrorCode;
  retryable: boolean;
  safeMessage: string;
  cause?: string;
  context: Record<string, unknown>;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown action execution error';
}

export function classifyActionError(error: unknown, context: Record<string, unknown> = {}): ClassifiedActionError {
  const message = messageOf(error);
  const lowered = message.toLowerCase();

  if (lowered.includes('unknown action type')) {
    return { kind: 'UNKNOWN_ACTION_TYPE', code: ACTION_ERROR_CODES.UNKNOWN_ACTION_TYPE, retryable: false, safeMessage: message, cause: message, context };
  }

  if (lowered.includes('validation') || lowered.includes('invalid payload') || lowered.includes('missing required')) {
    return { kind: 'VALIDATION_ERROR', code: ACTION_ERROR_CODES.VALIDATION_ERROR, retryable: false, safeMessage: 'Action payload failed validation.', cause: message, context };
  }

  if (lowered.includes('tenant policy') || lowered.includes('not allowed by policy')) {
    return { kind: 'TENANT_POLICY_ERROR', code: ACTION_ERROR_CODES.TENANT_POLICY_ERROR, retryable: false, safeMessage: 'Action is not allowed by tenant policy.', cause: message, context };
  }

  if (lowered.includes('lock expired')) {
    return { kind: 'LOCK_EXPIRED', code: ACTION_ERROR_CODES.LOCK_EXPIRED, retryable: true, safeMessage: 'Action lock expired while processing.', cause: message, context };
  }

  if (lowered.includes('outbox')) {
    return { kind: 'OUTBOX_DISPATCH_FAILED', code: ACTION_ERROR_CODES.OUTBOX_DISPATCH_FAILED, retryable: true, safeMessage: 'Outbox dispatch failed.', cause: message, context };
  }

  if (lowered.includes('timeout') || lowered.includes('econn') || lowered.includes('rate limit') || lowered.includes('temporar')) {
    return { kind: 'EXTERNAL_DEPENDENCY_ERROR', code: ACTION_ERROR_CODES.EXTERNAL_DEPENDENCY_ERROR, retryable: true, safeMessage: 'External dependency failed while executing action.', cause: message, context };
  }

  return { kind: 'RETRYABLE', code: ACTION_ERROR_CODES.ACTION_EXECUTION_FAILED, retryable: true, safeMessage: message, cause: message, context };
}
