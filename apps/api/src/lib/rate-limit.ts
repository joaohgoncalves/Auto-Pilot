import type { FastifyRequest } from 'fastify';

function forwardedIp(request: FastifyRequest) {
  return request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? request.ip;
}

export function rateLimitKey(request: FastifyRequest) {
  const ip = forwardedIp(request);
  const tenantId = request.user?.tenantId ?? 'anonymous-tenant';
  const userId = request.user?.sub ?? 'anonymous-user';
  return `${ip}:${tenantId}:${userId}`;
}
