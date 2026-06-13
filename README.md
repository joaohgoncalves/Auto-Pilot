# AutoPilotOps / Self-Healing Platform

[![CI](https://github.com/joaohgoncalves/Auto-Pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/joaohgoncalves/Auto-Pilot/actions/workflows/ci.yml)

AutoPilotOps is a multi-tenant self-healing operations platform. It ingests operational signals, correlates incidents, evaluates configurable rules and policies, creates actions, gates risky actions behind human approval, executes safe actions asynchronously and records an audit trail.

```txt
signal -> transactional outbox -> signal worker -> correlation/rules/policy -> actions/approvals/outbox -> action worker -> read models/audit
```

## Production-readiness scope in this version

This repository was hardened from MVP toward a production-ready SaaS foundation:

- JWT access tokens with mandatory expiry.
- Refresh sessions with hashed tokens, rotation and reuse detection.
- Login/refresh also set httpOnly cookies; bearer tokens are still returned for API clients.
- Logout revokes refresh sessions and invalidates access tokens tied to that session.
- Role-based access control: `OWNER`, `ADMIN`, `MANAGER`, `OPERATOR`, `VIEWER`.
- Tenant isolation in every protected query and in `/metrics`.
- CSRF protection for cookie-auth mutating routes using `Origin`/`Referer` validation against `CORS_ORIGINS`.
- Strong Zod validation for API contracts.
- Restricted CORS via `CORS_ORIGINS`.
- Auth rate limits and sensitive route rate limits.
- Error responses that do not leak internals.
- Rule engine that reads active rules from PostgreSQL.
- Transactional outbox for signal processing and action execution jobs.
- Signal processing only marks `PROCESSED` after critical action/approval/outbox writes are durable.
- Atomic action claim with expiring locks: `PENDING/FAILED/stale RUNNING -> RUNNING -> EXECUTED/FAILED/DEAD_LETTER`.
- Real persistent dead-letter table through `DeadLetterEvent` and admin reprocess endpoints.
- Approval workflow with status, role requirement, expiration, double-approval protection and outbox-backed async execution after approval.
- Action attempt history with attempt counters and final failure state.
- Audit logging with request/correlation IDs.
- API, outbox dispatcher, signal worker, action worker and web split for deployment.
- Dockerfiles and docker-compose for full stack.
- CI without `|| true` shortcuts; audit gate fails on high/critical vulnerabilities.

## Quick start

```bash
cp .env.example .env
npm ci
npm run db:generate
docker compose up -d postgres redis
npm run db:migrate
npm run db:seed
npm run dev:api
```

In another terminal:

```bash
npm run dev:worker
```

In another terminal:

```bash
npm run dev:web
```

API: `http://localhost:4040`

Web: `http://localhost:3000`

Swagger UI: `http://localhost:4040/docs`

## Seed users

All users belong to tenant `autopilotops-demo`.

| Role | Email | Password |
|---|---|---|
| OWNER | `admin@autopilotops.dev` | `Admin@123456` |
| MANAGER | `manager@autopilotops.dev` | `Manager@123456` |
| OPERATOR | `operator@autopilotops.dev` | `Operator@123456` |
| VIEWER | `viewer@autopilotops.dev` | `Viewer@123456` |

High-risk approvals disallow self-approval by default. For a realistic demo, create a signal as `operator@autopilotops.dev` and approve it as `admin@autopilotops.dev`.

## Commands

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
npm run db:generate
npm run db:migrate
npm run db:migrate:deploy
npm run db:seed
npm run lint
npm run typecheck
npm run test
npm run build
```

## Integration tests

Default tests skip DB/Redis-dependent specs unless Prisma client is generated and integration mode is enabled.

```bash
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
RUN_INTEGRATION_TESTS=true npm --workspace apps/api test
```

## Docker

Development dependencies only:

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

Full local stack:

```bash
cp .env.example .env
docker compose up --build
```

The compose stack starts:

- PostgreSQL
- Redis
- API
- Worker with outbox dispatcher, signal worker and action worker
- Web

Production compose is separated from development and keeps Postgres/Redis off public ports:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up --build -d
```

## External integrations

External integrations are partially supported through the generic webhook action provider. Configure `WEBHOOK_PROVIDER_URL`, `WEBHOOK_PROVIDER_TIMEOUT_MS` and optional `WEBHOOK_PROVIDER_TOKEN`, or provide `provider: "webhook"` and `webhookUrl` in an action payload. Other providers such as Slack, GitHub Actions, Kubernetes and ERP connectors are still planned.

Notifications, recovery checks and rollback actions that do not select a real provider are still recorded as audit records and `NotificationDelivery` rows.

## Safety model

- Low-risk actions execute automatically.
- Medium-risk actions require approval unless tenant policy allows auto-execution.
- High-risk actions require approval by `ADMIN` or higher.
- Critical actions are recommendation-only by default.
- Approval requests are idempotent per action.
- Action effects are idempotent via action-level unique constraints.
- Action jobs are retried through BullMQ but final durable state lives in PostgreSQL.

## Current audit exception

`npm audit --audit-level=high` passes after upgrading `@fastify/jwt` and `vitest`. Full `npm audit` still reports a moderate `next -> postcss` advisory where npm suggests a breaking/incorrect downgrade path. Keep this tracked and upgrade Next/PostCSS as soon as a non-breaking patched Next release is available.
