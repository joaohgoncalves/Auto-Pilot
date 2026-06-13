import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { ok } from '../lib/response.js';
import { prisma } from '../lib/prisma.js';

export async function usersRoutes(app: FastifyInstance) {
  app.get('/memberships', { preHandler: [app.requireRole(Role.OWNER)] }, async (request) => {
    const memberships = await prisma.membership.findMany({
      where: { tenantId: request.user.tenantId },
      include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }]
    });
    return ok(memberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      isActive: membership.isActive,
      createdAt: membership.createdAt,
      user: membership.user
    })));
  });
}
