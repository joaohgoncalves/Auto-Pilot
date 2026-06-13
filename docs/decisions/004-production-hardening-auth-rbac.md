# ADR 004 — Production hardening for auth, RBAC and tenant isolation

## Decision

Use short-lived JWT access tokens and rotating refresh sessions. Store refresh tokens only as hashes. Enforce tenant membership and role hierarchy at route level.

## Context

The MVP authenticated users but did not enforce expiration, refresh rotation, logout revocation or per-route authorization.

## Consequences

- Login/refresh/logout are now auditable.
- Access tokens remain valid until expiry, so TTL must stay short.
- The frontend demo still uses localStorage and documents the risk.
