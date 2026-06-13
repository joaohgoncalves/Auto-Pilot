import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isAllowedCorsOrigin, isProduction } from '../config/env.js';
import { forbidden } from './errors.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLIC_MUTATION_EXCEPTIONS = new Set<string>(['/auth/login']);
const CSRF_COOKIE = 'csrfToken';
const CSRF_HEADER = 'x-csrf-token';

function parseOrigin(value?: string) {
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

function requestPath(request: FastifyRequest) {
  const raw = request.url.startsWith('http') ? request.url : `http://localhost${request.url}`;
  return new URL(raw).pathname;
}

export function issueCsrfToken(reply: FastifyReply) {
  const token = crypto.randomBytes(32).toString('base64url');
  reply.setCookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24
  });
  return token;
}

export function clearCsrfToken(reply: FastifyReply) {
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

function validateDoubleSubmit(request: FastifyRequest) {
  const cookieToken = request.cookies[CSRF_COOKIE];
  const headerToken = request.headers[CSRF_HEADER]?.toString();
  if (!cookieToken || !headerToken) throw forbidden('CSRF validation failed: missing CSRF token.');
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw forbidden('CSRF validation failed: invalid CSRF token.');
}

export function validateCsrfForCookieAuth(request: FastifyRequest) {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return;
  if (PUBLIC_MUTATION_EXCEPTIONS.has(requestPath(request))) return;

  const hasCookieAuth = Boolean(request.cookies.accessToken ?? request.cookies.refreshToken);
  const hasBearerAuth = request.headers.authorization?.toLowerCase().startsWith('bearer ') ?? false;
  if (!hasCookieAuth && hasBearerAuth) return;

  const origin = parseOrigin(request.headers.origin?.toString()) ?? parseOrigin(request.headers.referer?.toString());
  if (!origin) throw forbidden('CSRF validation failed: missing Origin/Referer header for mutating cookie-auth request.');
  if (!isAllowedCorsOrigin(origin)) throw forbidden('CSRF validation failed: Origin/Referer is not allowed.');
  if (hasCookieAuth) validateDoubleSubmit(request);
}
