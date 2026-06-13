import type { FastifyReply, FastifyRequest } from 'fastify';
import { Role } from '@prisma/client';
import { canRoleAccess } from '@autopilotops/shared';
import { prisma } from '../lib/prisma.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/security.js';

function bearerToken(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  const token = bearerToken(request) ?? request.cookies.accessToken;
  if (!token) throw unauthorized();

  const payload = verifyAccessToken(token);
  if (!payload) throw unauthorized();
  request.user = { sub: payload.sub, tenantId: payload.tenantId, role: payload.role as Role, sessionId: payload.sessionId };

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: request.user.sub, tenantId: request.user.tenantId } }
  });

  if (!membership || !membership.isActive || membership.role !== request.user.role) {
    throw forbidden('User is not an active member of this tenant.');
  }

  if (request.user.sessionId) {
    const activeSession = await prisma.refreshSession.findFirst({
      where: {
        id: request.user.sessionId,
        userId: request.user.sub,
        tenantId: request.user.tenantId,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      select: { id: true }
    });

    if (!activeSession) throw unauthorized('Session is no longer active.');
  }
}

export function requireRole(minimumRole: Role) {
  return async function requireRoleHandler(request: FastifyRequest, reply: FastifyReply) {
    await authenticate(request, reply);
    if (!canRoleAccess(request.user.role, minimumRole)) throw forbidden(`Requires ${minimumRole} role or higher.`);
  };
}

export function assertRole(userRole: Role, minimumRole: Role) {
  if (!canRoleAccess(userRole, minimumRole)) throw forbidden(`Requires ${minimumRole} role or higher.`);
}

export function minApproverRoleForRisk(riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): Role {
  if (riskLevel === 'LOW') return Role.OPERATOR;
  if (riskLevel === 'MEDIUM') return Role.MANAGER;
  if (riskLevel === 'HIGH') return Role.ADMIN;
  return Role.OWNER;
}
