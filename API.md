# API Guide

All successful API responses use:

```json
{ "data": {} }
```

Paginated responses use:

```json
{ "data": [], "meta": { "total": 0, "page": 1, "limit": 20 } }
```

Errors use:

```json
{ "error": { "code": "ERROR_CODE", "message": "Safe message", "requestId": "..." } }
```

## Auth

```http
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
```

## Signals

```http
POST /signals
GET  /signals?page=1&limit=20&status=PROCESSED&type=inventory.stockout_risk
GET  /signals/:id
```

## Actions and approvals

```http
GET  /actions?status=WAITING_APPROVAL
GET  /approvals
POST /approvals/:id/approve
POST /approvals/:id/reject
```

## Read models

```http
GET /dashboard/summary
GET /incidents
GET /incidents/:id
GET /purchase-recommendations
GET /tasks
GET /audit
```

## Rules

```http
GET   /rules
POST  /rules
PATCH /rules/:id
```

Rules are evaluated by `triggerType`, `priority`, `isActive` and JSON conditions.

Example rule action:

```json
{
  "type": "create_operational_task",
  "riskLevel": "LOW",
  "payload": { "assignee": "ops-team", "dueInHours": 4 }
}
```
