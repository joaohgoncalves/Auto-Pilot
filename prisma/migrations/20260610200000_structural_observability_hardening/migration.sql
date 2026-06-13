-- Structural hardening round 2: outbox dispatcher claims and high-volume indexes.
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "processingStartedAt" TIMESTAMP(3);
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "claimedBy" TEXT;

CREATE INDEX IF NOT EXISTS "OutboxEvent_status_availableAt_createdAt_idx" ON "OutboxEvent"("status", "availableAt", "createdAt");
CREATE INDEX IF NOT EXISTS "OutboxEvent_status_processingStartedAt_idx" ON "OutboxEvent"("status", "processingStartedAt");
CREATE INDEX IF NOT EXISTS "Signal_tenantId_type_createdAt_idx" ON "Signal"("tenantId", "type", "receivedAt");
CREATE INDEX IF NOT EXISTS "Action_tenantId_type_createdAt_idx" ON "Action"("tenantId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_tenantId_status_requestedAt_idx" ON "ApprovalRequest"("tenantId", "status", "requestedAt");
CREATE INDEX IF NOT EXISTS "DeadLetterEvent_tenantId_sourceType_createdAt_idx" ON "DeadLetterEvent"("tenantId", "sourceType", "createdAt");
