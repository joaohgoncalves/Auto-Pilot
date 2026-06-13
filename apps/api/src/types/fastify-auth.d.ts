import 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (minimumRole: Role) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
