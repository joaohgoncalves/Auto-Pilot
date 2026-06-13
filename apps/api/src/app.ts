import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { env, corsOrigins, isProduction } from './config/env.js';
import { authRoutes } from './routes/auth.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { signalsRoutes } from './routes/signals.routes.js';
import { demoRoutes } from './routes/demo.routes.js';
import { actionsRoutes } from './routes/actions.routes.js';
import { readModelRoutes } from './routes/read-model.routes.js';
import { rulesRoutes } from './routes/rules.routes.js';
import { usersRoutes } from './routes/users.routes.js';
import { authenticate, requireRole } from './middleware/authz.js';
import { errorHandler } from './lib/errors.js';
import { validateCsrfForCookieAuth } from './lib/csrf.js';
import { rateLimitKey } from './lib/rate-limit.js';

export function buildApp() {
  const app = Fastify({
    logger: isProduction
      ? { level: env.LOG_LEVEL }
      : { level: env.LOG_LEVEL, transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } },
    genReqId: () => crypto.randomUUID()
  });

  app.register(helmet, {
    global: true,
    contentSecurityPolicy: isProduction ? undefined : false
  });
  app.register(cors, {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin not allowed'), false);
    },
    credentials: true
  });
  app.register(rateLimit, {
    global: false,
    max: env.SENSITIVE_RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKey,
    errorResponseBuilder(request, context) {
      request.log.warn({ requestId: request.id, route: request.routeOptions.url, rateLimit: context }, 'Rate limit exceeded');
      return { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please retry later.', requestId: request.id } };
    }
  });
  app.register(cookie, { secret: env.COOKIE_SECRET });
  app.register(jwt, { secret: env.JWT_SECRET, cookie: { cookieName: 'accessToken', signed: false } });
  app.register(swagger, {
    openapi: {
      info: { title: 'AutoPilotOps API', version: '0.3.0' },
      security: [{ bearerAuth: [] }],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } }
    }
  });
  app.register(swaggerUi, { routePrefix: '/docs' });

  app.decorate('authenticate', authenticate);
  app.decorate('requireRole', requireRole);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    validateCsrfForCookieAuth(request);
  });

  app.addHook('onResponse', async (request, reply) => {
    const correlationId = request.headers['x-correlation-id']?.toString() ?? request.id;
    request.log.info({ requestId: request.id, correlationId, tenantId: request.user?.tenantId, userId: request.user?.sub, statusCode: reply.statusCode, responseTimeMs: reply.elapsedTime }, 'request completed');
  });

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(signalsRoutes);
  app.register(demoRoutes);
  app.register(actionsRoutes);
  app.register(readModelRoutes);
  app.register(rulesRoutes);
  app.register(usersRoutes);

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: request.id } });
  });
  app.setErrorHandler(errorHandler);

  return app;
}
