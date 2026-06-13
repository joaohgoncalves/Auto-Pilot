import crypto from 'node:crypto';
import { env, jwtSecrets } from '../config/env.js';

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  role: string;
  sessionId?: string;
  exp?: number;
  iat?: number;
}

export function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeTokenPair(sessionId: string, rawToken: string) {
  return `${sessionId}.${rawToken}`;
}

export function splitRefreshToken(token: string) {
  const [sessionId, rawToken] = token.split('.');
  if (!sessionId || !rawToken) return null;
  return { sessionId, rawToken };
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseTtlSeconds(ttl: string) {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return 15 * 60;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 's') return value;
  if (unit === 'm') return value * 60;
  if (unit === 'h') return value * 60 * 60;
  return value * 24 * 60 * 60;
}

function signHmac(input: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>, ttl = env.JWT_ACCESS_TOKEN_TTL) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body: AccessTokenPayload = { ...payload, iat: now, exp: now + parseTtlSeconds(ttl) };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(body)}`;
  return `${signingInput}.${signHmac(signingInput, env.JWT_SECRET)}`;
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signature] = parts;
    const signingInput = `${headerPart}.${payloadPart}`;
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') return null;

    const valid = jwtSecrets.some((secret) => {
      const expected = signHmac(signingInput, secret);
      return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    });
    if (!valid) return null;

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as AccessTokenPayload;
    if (!payload.sub || !payload.tenantId || !payload.role) return null;
    if (payload.exp && payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function passwordPolicyErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push('Password must have at least 12 characters.');
  if (!/[a-z]/.test(password)) errors.push('Password must include a lowercase letter.');
  if (!/[A-Z]/.test(password)) errors.push('Password must include an uppercase letter.');
  if (!/\d/.test(password)) errors.push('Password must include a number.');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Password must include a symbol.');
  if (/^(password|senha|admin|autopilotops|123456|qwerty)/i.test(password)) errors.push('Password is too obvious.');
  return errors;
}
