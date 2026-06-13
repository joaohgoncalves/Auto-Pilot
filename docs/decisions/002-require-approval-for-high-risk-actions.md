# ADR 002 — Require approval for high-risk actions

## Status

Accepted

## Context

Self-healing systems can create damage if they automatically execute risky operations.

## Decision

Classify actions by risk level. Low-risk actions execute automatically. High-risk actions require approval. Critical actions are recommendation-only by default.

## Consequences

- The platform remains safe for production-like demos.
- Real integrations can be added later with explicit approval gates.
- This demonstrates mature engineering judgment.
