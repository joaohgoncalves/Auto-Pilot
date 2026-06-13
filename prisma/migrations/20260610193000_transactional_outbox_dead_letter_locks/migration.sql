-- Production hardening: transactional outbox, action locks/recovery and real dead-letter records.

ALTER TYPE "SignalStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "ActionStatus" ADD VALUE IF NOT EXISTS 'DEAD_LETTER';

DO $$ BEGIN
  CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Action"
  ADD COLUMN IF NOT EXISTS "errorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "lastError" TEXT,
  ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deadLetteredAt" TIMESTAMP(3);

ALTER TABLE "ActionAttempt"
  ADD COLUMN IF NOT EXISTS "errorCode" TEXT;

CREATE INDEX IF NOT EXISTS "Action_tenantId_status_lockExpiresAt_idx" ON "Action"("tenantId", "status", "lockExpiresAt");

CREATE TABLE IF NOT EXISTS "OutboxEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "lastError" TEXT,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestId" TEXT,
  "correlationId" TEXT,
  "dedupeKey" TEXT,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OutboxEvent_tenantId_type_dedupeKey_key" ON "OutboxEvent"("tenantId", "type", "dedupeKey");
CREATE INDEX IF NOT EXISTS "OutboxEvent_tenantId_status_availableAt_idx" ON "OutboxEvent"("tenantId", "status", "availableAt");
CREATE INDEX IF NOT EXISTS "OutboxEvent_tenantId_type_createdAt_idx" ON "OutboxEvent"("tenantId", "type", "createdAt");
ALTER TABLE "OutboxEvent" DROP CONSTRAINT IF EXISTS "OutboxEvent_tenantId_fkey";
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "DeadLetterEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "actionId" TEXT,
  "signalId" TEXT,
  "outboxEventId" TEXT,
  "queueName" TEXT,
  "jobName" TEXT,
  "reason" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "errorCode" TEXT,
  "lastError" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "reprocessedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeadLetterEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DeadLetterEvent_tenantId_sourceType_sourceId_key" ON "DeadLetterEvent"("tenantId", "sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "DeadLetterEvent_tenantId_status_createdAt_idx" ON "DeadLetterEvent"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "DeadLetterEvent_tenantId_actionId_idx" ON "DeadLetterEvent"("tenantId", "actionId");
CREATE INDEX IF NOT EXISTS "DeadLetterEvent_tenantId_signalId_idx" ON "DeadLetterEvent"("tenantId", "signalId");
ALTER TABLE "DeadLetterEvent" DROP CONSTRAINT IF EXISTS "DeadLetterEvent_tenantId_fkey";
ALTER TABLE "DeadLetterEvent" DROP CONSTRAINT IF EXISTS "DeadLetterEvent_actionId_fkey";
ALTER TABLE "DeadLetterEvent" DROP CONSTRAINT IF EXISTS "DeadLetterEvent_signalId_fkey";
ALTER TABLE "DeadLetterEvent" ADD CONSTRAINT "DeadLetterEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeadLetterEvent" ADD CONSTRAINT "DeadLetterEvent_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeadLetterEvent" ADD CONSTRAINT "DeadLetterEvent_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
