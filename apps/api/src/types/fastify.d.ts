import '@fastify/jwt';
import type { Role } from '@prisma/client';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; tenantId: string; role: Role; sessionId?: string };
    user: { sub: string; tenantId: string; role: Role; sessionId?: string };
  }
}
