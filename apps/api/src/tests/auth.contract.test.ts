import { describe, expect, it } from 'vitest';
import { splitRefreshToken, safeTokenPair, sha256 } from '../lib/security.js';

describe('auth token utilities', () => {
  it('splits refresh token session id and secret', () => {
    const token = safeTokenPair('session-1', 'secret-1');
    expect(splitRefreshToken(token)).toEqual({ sessionId: 'session-1', rawToken: 'secret-1' });
  });

  it('hashes tokens deterministically without storing raw secret', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe('abc');
  });
});
