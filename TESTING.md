# Testing Guide

## Default test suite

```bash
npm test
```

The default suite runs unit/contract tests and skips database-dependent tests when Prisma client has not been generated.

## Required local validation

```bash
npm run db:generate
npm run lint
npm run typecheck
npm test
npm run build
```

## Integration tests with real PostgreSQL and Redis

```bash
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
RUN_INTEGRATION_TESTS=true npm --workspace apps/api test
```

The integration specs are designed to cover:

- Auth login/refresh/logout/session revocation contracts.
- RBAC and tenant isolation.
- Signal workflow from signal ingestion through rule engine, action/approval creation, outbox dispatch and action worker execution.
- Idempotency for repeated signal idempotency keys.
- Recovery of stale `RUNNING` actions.
- Final action failure to `DEAD_LETTER`.
- Tenant-scoped metrics.
- CSRF blocking for mutating requests without allowed Origin/Referer.

## CSRF tests

CSRF tests assert:

- `POST` without valid `Origin`/`Referer` is blocked.
- `POST` with an allowed origin reaches normal route validation/auth handling.
- `GET` does not require CSRF headers.

## Why generated Prisma client matters

Fastify app tests import modules that instantiate `PrismaClient`. Run `npm run db:generate` before API smoke/integration tests. If Prisma engine downloads are blocked by the environment, tests that require generated Prisma are skipped or fail early with the Prisma initialization error.

## Round 2 testing notes

Additional unit coverage was added for:

- `toNumber` numeric utility;
- action error classification.

Integration tests that need generated Prisma Client, Postgres and Redis remain gated. Run them in CI with:

```bash
npm run test:integration:ci
```

Recommended full local validation:

```bash
npm ci
npm run docker:up
npm run db:generate
npm run db:migrate
npm run test:integration
npm run lint
npm run typecheck
npm run build
npm audit --audit-level=high
```
