import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const prismaClientPath = resolve(process.cwd(), '../../node_modules/.prisma/client/default.js');
const hasGeneratedPrismaClient = existsSync(prismaClientPath) && !readFileSync(prismaClientPath, 'utf8').includes('did not initialize yet');

describe.runIf(hasGeneratedPrismaClient)('api smoke', () => {
  it('responds live healthcheck with standardized envelope', async () => {
    const { buildApp } = await import('../app.js');
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { status: 'ok' } });
    await app.close();
  });

  it('does not leak internal errors for unknown routes', async () => {
    const { buildApp } = await import('../app.js');
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/unknown-route' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
    await app.close();
  });
});

describe.skipIf(hasGeneratedPrismaClient)('api smoke requires generated Prisma client', () => {
  it('is skipped until `npm run db:generate` succeeds', () => {
    expect(hasGeneratedPrismaClient).toBe(false);
  });
});
