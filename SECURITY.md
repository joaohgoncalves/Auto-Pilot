# Security Model

## Authentication

- Access tokens are JWTs with mandatory expiry from `JWT_ACCESS_TOKEN_TTL`.
- Refresh tokens are random secrets stored only as SHA-256 hashes.
- Refresh token rotation revokes the previous refresh session and creates a new one.
- Reuse of a rotated refresh token revokes all active sessions for that user and tenant.
- Logout revokes the current refresh session or the provided refresh token.
- Access tokens include a `sessionId`; protected routes verify the session is still active, so logout/rotation invalidates old access tokens tied to revoked sessions.

## Passwords

Passwords are hashed with bcrypt using cost factor 12 in the seed and login flow verifies via `bcrypt.compare`.

## RBAC

Role hierarchy:

```txt
OWNER > ADMIN > MANAGER > OPERATOR > VIEWER
```

Minimum route permissions:

| Capability | Minimum role |
|---|---|
| Read dashboard/read models | VIEWER |
| Create signals / run demos | OPERATOR |
| Approve/reject eligible actions | MANAGER, ADMIN or OWNER depending on risk |
| Retry actions / operate dead-letter queue / metrics | ADMIN |
| Manage rules/playbooks | ADMIN |
| View tenant memberships | OWNER |

## Approval permissions

Approval requests carry `minApproverRole`. Medium risk requires `MANAGER`; high risk requires `ADMIN`; critical requires `OWNER`. Self-approval is disabled by default.

## Tenant isolation

Protected routes use `request.user.tenantId` from the JWT and verify the membership still exists and is active. Resource IDs alone are never trusted. `/metrics` also filters by `tenantId` and does not expose global counters.

## CSRF strategy

The API supports browser authentication through httpOnly cookies. Because browsers attach cookies automatically, mutating routes are protected by Origin/Referer validation:

- `POST`, `PUT`, `PATCH` and `DELETE` require an `Origin` or `Referer` header.
- The derived origin must exactly match one of the configured `CORS_ORIGINS`.
- Safe methods such as `GET` do not require CSRF headers.
- Bearer-only API clients without auth cookies are allowed because they are not using ambient browser cookie credentials.
- Public mutation exceptions are intentionally empty. Add exceptions only for real public webhooks and document them.

This is intentionally compatible with the existing frontend by using `credentials: include` and a configured frontend origin such as `http://localhost:3000`.

## API hardening

- CORS is restricted by `CORS_ORIGINS`.
- Login and refresh routes are rate-limited.
- Zod validates payloads and query parameters.
- Error handler returns safe error envelopes.
- Production rejects weak/default JWT secrets.

## Browser session model

Login and refresh set `accessToken` and `refreshToken` as httpOnly cookies with `sameSite=lax` and `secure` in production. The API still returns token values in the response body for non-browser clients and transition compatibility; a stricter production frontend should avoid persisting them in `localStorage` and use `credentials: include`.

## Dependency audit policy

CI runs `npm audit --audit-level=high`. High and critical vulnerabilities fail the pipeline. Moderate findings must be documented with an owner and upgrade plan when the upstream fix path is breaking or invalid.

## Round 2 security hardening

### JWT secret rotation

`JWT_SECRET` is the active signing secret. `JWT_PREVIOUS_SECRETS` is a comma-separated list of old secrets accepted for verification only.

Rotation process:

1. Put the old current secret in `JWT_PREVIOUS_SECRETS`.
2. Deploy a new `JWT_SECRET`.
3. Wait longer than `JWT_ACCESS_TOKEN_TTL`.
4. Remove the old secret from `JWT_PREVIOUS_SECRETS`.

Refresh tokens remain session-backed in Postgres and are not validated only by JWT signature.

### CSRF

Cookie-auth mutating requests require:

- valid `Origin` or `Referer` matching `CORS_ORIGINS`;
- matching double-submit token: `csrfToken` cookie and `x-csrf-token` header.

Bearer-only clients are not subject to browser cookie CSRF checks. `/auth/login` is the only public mutation exception because it creates the initial session and CSRF token.

### Password policy

`passwordPolicyErrors` enforces minimum length, lower/upper/number/symbol and blocks obvious prefixes. User creation endpoints should call this utility before hashing a password.
