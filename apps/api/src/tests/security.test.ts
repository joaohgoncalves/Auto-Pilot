import { describe, expect, it } from 'vitest';
import { passwordPolicyErrors, signAccessToken, verifyAccessToken } from '../lib/security.js';

describe('JWT access token helpers', () => {
  it('signs and verifies an access token with the current secret', () => {
    const token = signAccessToken({ sub: 'user_1', tenantId: 'tenant_1', role: 'ADMIN', sessionId: 'session_1' }, '1h');
    const payload = verifyAccessToken(token);
    expect(payload?.sub).toBe('user_1');
    expect(payload?.tenantId).toBe('tenant_1');
    expect(payload?.sessionId).toBe('session_1');
  });
});

describe('passwordPolicyErrors', () => {
  it('rejects weak passwords', () => {
    expect(passwordPolicyErrors('password123')).not.toHaveLength(0);
  });

  it('accepts a reasonably strong password', () => {
    expect(passwordPolicyErrors('S3guro!SenhaLonga')).toHaveLength(0);
  });
});
