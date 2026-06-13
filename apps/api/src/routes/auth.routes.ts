import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { ok } from '../lib/response.js';
import { randomToken, safeTokenPair, sha256, signAccessToken, splitRefreshToken } from '../lib/security.js';
import { audit } from '../lib/audit.js';
import { clearCsrfToken, issueCsrfToken } from '../lib/csrf.js';

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
  tenantSlug: z.string().min(1).optional()
});

const refreshSchema = z.object({ refreshToken: z.string().min(20).optional() });
const logoutSchema = z.object({ refreshToken: z.string().min(20).optional() });
const sessionParamsSchema = z.object({ id: z.string().min(1) });

type AuthMembership = {
  tenantId: string;
  role: Role;
  tenant: { id: string; name: string; slug: string };
};

function toAvailableTenant(item: AuthMembership) {
  return { id: item.tenant.id, name: item.tenant.name, slug: item.tenant.slug, role: item.role };
}

function requestIp(request: FastifyRequest) {
  return request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? request.ip;
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

function setAuthCookies(reply: FastifyReply, tokens: { accessToken: string; refreshToken: string }) {
  reply
    .setCookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: parseTtlSeconds(env.JWT_ACCESS_TOKEN_TTL)
    })
    .setCookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/auth',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60
    });
  issueCsrfToken(reply);
}

function clearAuthCookies(reply: FastifyReply) {
  reply
    .clearCookie('accessToken', { path: '/' })
    .clearCookie('refreshToken', { path: '/auth' });
  clearCsrfToken(reply);
}

async function issueTokens(input: {
  userId: string;
  tenantId: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}) {
  const rawRefreshToken = randomToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  const session = await prisma.refreshSession.create({
    data: {
      userId: input.userId,
      tenantId: input.tenantId,
      tokenHash: sha256(rawRefreshToken),
      expiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent
    }
  });

  const accessToken = signAccessToken({ sub: input.userId, tenantId: input.tenantId, role: input.role, sessionId: session.id });

  return {
    accessToken,
    refreshToken: safeTokenPair(session.id, rawRefreshToken),
    expiresIn: env.JWT_ACCESS_TOKEN_TTL,
    refreshExpiresAt: expiresAt.toISOString(),
    sessionId: session.id
  };
}

async function auditRefreshReuse(input: { tenantId: string; userId: string; sessionId: string; requestId: string; ipAddress?: string }) {
  await prisma.$transaction(async (tx) => {
    await tx.refreshSession.updateMany({
      where: { userId: input.userId, tenantId: input.tenantId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' }
    });
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actor: 'auth',
        actorUserId: input.userId,
        event: 'auth.refresh_reuse_detected',
        message: 'Refresh token reuse detected. All active sessions for this tenant were revoked.',
        requestId: input.requestId,
        resourceType: 'refresh_session',
        resourceId: input.sessionId,
        metadata: { ipAddress: input.ipAddress }
      }
    });
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', {
    config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      include: { memberships: { where: { isActive: true }, include: { tenant: true }, orderBy: { createdAt: 'asc' } } }
    });

    const passwordMatches = user ? await bcrypt.compare(body.password, user.passwordHash) : false;
    if (!user || !passwordMatches) {
      if (user?.memberships[0]) {
        await audit({
          tenantId: user.memberships[0].tenantId,
          actor: 'auth',
          actorUserId: user.id,
          event: 'auth.login_failed',
          message: 'Login failed with invalid credentials.',
          requestId: request.id,
          metadata: { ipAddress: requestIp(request) }
        });
      }
      return reply.status(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.', requestId: request.id } });
    }

    const membership = body.tenantSlug
      ? (user.memberships as AuthMembership[]).find((item) => item.tenant.slug === body.tenantSlug)
      : (user.memberships as AuthMembership[])[0];

    if (!membership) throw forbidden('No active membership found for tenant.');

    const tokens = await issueTokens({
      userId: user.id,
      tenantId: membership.tenantId,
      role: membership.role,
      ipAddress: requestIp(request),
      userAgent: request.headers['user-agent']
    });

    await audit({
      tenantId: membership.tenantId,
      actor: 'auth',
      actorUserId: user.id,
      event: 'auth.login_succeeded',
      message: `User ${user.email} logged in.`,
      requestId: request.id,
      resourceType: 'refresh_session',
      resourceId: tokens.sessionId,
      metadata: { ipAddress: requestIp(request) }
    });

    setAuthCookies(reply, tokens);
    return reply.send(ok({
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email },
      tenant: { id: membership.tenant.id, name: membership.tenant.name, slug: membership.tenant.slug },
      role: membership.role,
      availableTenants: (user.memberships as AuthMembership[]).map(toAvailableTenant)
    }));
  });

  app.post('/auth/refresh', {
    config: { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const body = refreshSchema.parse(request.body ?? {});
    const refreshToken = body.refreshToken ?? request.cookies.refreshToken;
    const parsedToken = refreshToken ? splitRefreshToken(refreshToken) : null;
    if (!parsedToken) throw unauthorized('Invalid refresh token.');

    const session = await prisma.refreshSession.findUnique({
      where: { id: parsedToken.sessionId },
      include: { user: true, tenant: true }
    });

    if (!session || session.tokenHash !== sha256(parsedToken.rawToken)) throw unauthorized('Invalid refresh token.');
    if (session.revokedAt) {
      if (session.revokedReason === 'ROTATED') {
        await auditRefreshReuse({
          tenantId: session.tenantId,
          userId: session.userId,
          sessionId: session.id,
          requestId: request.id,
          ipAddress: requestIp(request)
        });
      }
      throw unauthorized('Invalid refresh token.');
    }
    if (session.expiresAt.getTime() <= Date.now()) throw unauthorized('Invalid refresh token.');

    const membership = await prisma.membership.findUnique({
      where: { userId_tenantId: { userId: session.userId, tenantId: session.tenantId } }
    });
    if (!membership || !membership.isActive) throw forbidden('User is not an active member of this tenant.');

    const newRawRefreshToken = randomToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const rotatedSession = await prisma.$transaction(async (tx) => {
      const next = await tx.refreshSession.create({
        data: {
          userId: session.userId,
          tenantId: session.tenantId,
          tokenHash: sha256(newRawRefreshToken),
          expiresAt,
          ipAddress: requestIp(request),
          userAgent: request.headers['user-agent']
        }
      });
      const revoked = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED', replacedBySessionId: next.id, lastUsedAt: new Date() }
      });
      if (revoked.count !== 1) throw unauthorized('Invalid refresh token.');
      return next;
    });

    const accessToken = signAccessToken({ sub: session.userId, tenantId: session.tenantId, role: membership.role, sessionId: rotatedSession.id });

    await audit({
      tenantId: session.tenantId,
      actor: 'auth',
      actorUserId: session.userId,
      event: 'auth.refresh_rotated',
      message: 'Refresh token rotated.',
      requestId: request.id,
      resourceType: 'refresh_session',
      resourceId: rotatedSession.id,
      metadata: { previousSessionId: session.id, nextSessionId: rotatedSession.id }
    });

    const tokens = {
      accessToken,
      refreshToken: safeTokenPair(rotatedSession.id, newRawRefreshToken),
      expiresIn: env.JWT_ACCESS_TOKEN_TTL,
      refreshExpiresAt: expiresAt.toISOString()
    };
    setAuthCookies(reply, tokens);
    return reply.send(ok(tokens));
  });

  app.post('/auth/logout', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = logoutSchema.parse(request.body ?? {});
    const parsedToken = body.refreshToken ? splitRefreshToken(body.refreshToken) : null;

    await prisma.refreshSession.updateMany({
      where: {
        id: parsedToken?.sessionId ?? request.user.sessionId,
        userId: request.user.sub,
        tenantId: request.user.tenantId,
        revokedAt: null,
        ...(parsedToken ? { tokenHash: sha256(parsedToken.rawToken) } : {})
      },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT' }
    });

    await audit({
      tenantId: request.user.tenantId,
      actor: 'auth',
      actorUserId: request.user.sub,
      event: 'auth.logout',
      message: 'User logged out and refresh session was revoked.',
      requestId: request.id,
      resourceType: 'refresh_session',
      resourceId: parsedToken?.sessionId ?? request.user.sessionId
    });

    clearAuthCookies(reply);
    return reply.send(ok({ loggedOut: true }));
  });

  app.post('/auth/logout-all', { preHandler: [app.authenticate] }, async (request, reply) => {
    await prisma.refreshSession.updateMany({
      where: { userId: request.user.sub, tenantId: request.user.tenantId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' }
    });
    await audit({
      tenantId: request.user.tenantId,
      actor: 'auth',
      actorUserId: request.user.sub,
      event: 'auth.logout_all',
      message: 'All active sessions for this tenant were revoked.',
      requestId: request.id
    });
    clearAuthCookies(reply);
    return reply.send(ok({ loggedOutAll: true }));
  });

  app.get('/auth/sessions', { preHandler: [app.authenticate] }, async (request) => {
    const sessions = await prisma.refreshSession.findMany({
      where: { userId: request.user.sub, tenantId: request.user.tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        revokedReason: true,
        lastUsedAt: true,
        ipAddress: true,
        userAgent: true,
        replacedBySessionId: true
      }
    });
    return ok(sessions);
  });

  app.post('/auth/sessions/:id/revoke', { preHandler: [app.authenticate] }, async (request) => {
    const { id } = sessionParamsSchema.parse(request.params);
    const result = await prisma.refreshSession.updateMany({
      where: { id, userId: request.user.sub, tenantId: request.user.tenantId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'USER_REVOKED' }
    });
    if (result.count !== 1) throw notFound('Active session not found.');
    await audit({
      tenantId: request.user.tenantId,
      actor: 'auth',
      actorUserId: request.user.sub,
      event: 'auth.session_revoked',
      message: `Session ${id} was revoked by the user.`,
      requestId: request.id,
      resourceType: 'refresh_session',
      resourceId: id
    });
    return ok({ revoked: true, sessionId: id });
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { id: true, name: true, email: true, memberships: { where: { isActive: true }, include: { tenant: true } } }
    });
    if (!user) throw unauthorized();
    return ok({
      user: { id: user.id, name: user.name, email: user.email },
      tenantId: request.user.tenantId,
      role: request.user.role,
      availableTenants: (user.memberships as AuthMembership[]).map(toAvailableTenant)
    });
  });
}
