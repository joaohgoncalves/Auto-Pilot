import { describe, expect, it } from 'vitest';
import { classifyActionError } from '../services/action-error-classifier.js';

describe('classifyActionError', () => {
  it('marks unknown action type as fatal', () => {
    const result = classifyActionError(new Error('Unknown action type: x'));
    expect(result.kind).toBe('UNKNOWN_ACTION_TYPE');
    expect(result.retryable).toBe(false);
  });

  it('marks external dependency errors as retryable', () => {
    const result = classifyActionError(new Error('timeout calling provider'));
    expect(result.kind).toBe('EXTERNAL_DEPENDENCY_ERROR');
    expect(result.retryable).toBe(true);
  });

  it('sanitizes validation errors', () => {
    const result = classifyActionError(new Error('invalid payload: missing required serviceName'));
    expect(result.kind).toBe('VALIDATION_ERROR');
    expect(result.retryable).toBe(false);
    expect(result.safeMessage).toBe('Action payload failed validation.');
  });
});
