# ADR 006 — Configurable rule engine

## Decision

Move playbook selection from hardcoded decision branches to tenant-scoped `Rule` rows with JSON conditions and ordered action definitions.

## Context

The MVP had a rule model but most decisions were hardcoded.

## Consequences

- Tenants can enable/disable and prioritize rules.
- Conditions are evaluated by a restricted operator set, not arbitrary code execution.
- The hardcoded decision engine remains only as safe fallback for unmapped signals.
