import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const prismaClientPath = resolve(process.cwd(), '../../node_modules/.prisma/client/default.js');
const hasGeneratedPrismaClient = existsSync(prismaClientPath) && !readFileSync(prismaClientPath, 'utf8').includes('did not initialize yet');

describe.runIf(hasGeneratedPrismaClient)('CSRF protection for cookie auth', () => {
  it('blocks mutating cookie-auth requests without Origin/Referer', async () => {
    const { buildApp } = await import('../app.js');
    const app = buildApp();
    const response = await app.inject({ method: 'POST', url: '/signals', cookies: { accessToken: 'fake', csrfToken: 'abc' }, payload: {} });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain('CSRF validation failed');
    await app.close();
  });

  it('blocks mutating cookie-auth requests without double-submit token', async () => {
    const { buildApp } = await import('../app.js');
    const app = buildApp();
    const response = await app.inject({ method: 'POST', url: '/signals', headers: { origin: 'http://localhost:3000' }, cookies: { accessToken: 'fake' }, payload: {} });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain('missing CSRF token');
    await app.close();
  });

  it('allows mutating requests with allowed Origin and matching token before route auth runs', async () => {
    const { buildApp } = await import('../app.js');
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/signals',
      headers: { origin: 'http://localhost:3000', 'x-csrf-token': 'abc' },
      cookies: { accessToken: 'fake', csrfToken: 'abc' },
      payload: {}
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('does not require CSRF headers for safe GET requests', async () => {
    const { buildApp } = await import('../app.js');
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});

describe.skipIf(hasGeneratedPrismaClient)('CSRF tests require generated Prisma client', () => {
  it('is skipped until `npm run db:generate` succeeds', () => {
    expect(hasGeneratedPrismaClient).toBe(false);
  });
});
