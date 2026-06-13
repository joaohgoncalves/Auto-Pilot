-- Initial production-hardening migration for AutoPilotOps.
-- This migration intentionally creates the schema from scratch for fresh environments.

CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');
CREATE TYPE "SignalStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSED', 'FAILED');
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_APPROVAL', 'EXECUTED', 'FAILED', 'SKIPPED', 'REJECTED', 'CANCELED');
CREATE TYPE "ActionAttemptStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'MITIGATING', 'RESOLVED', 'CANCELED');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELED');
CREATE TYPE "RecommendationStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED', 'COMPLETED');
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');

CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "autoExecuteMediumRisk" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Membership" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");
CREATE INDEX "Membership_tenantId_role_idx" ON "Membership"("tenantId", "role");
CREATE INDEX "Membership_tenantId_isActive_role_idx" ON "Membership"("tenantId", "isActive", "role");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RefreshSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedReason" TEXT,
  "replacedBySessionId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");
CREATE INDEX "RefreshSession_userId_tenantId_idx" ON "RefreshSession"("userId", "tenantId");
CREATE INDEX "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Signal" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "source" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "severity" "Severity" NOT NULL,
  "payload" JSONB NOT NULL,
  "diagnosis" TEXT,
  "riskLevel" "RiskLevel",
  "status" "SignalStatus" NOT NULL DEFAULT 'RECEIVED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdById" TEXT,
  "requestId" TEXT,
  "correlationId" TEXT NOT NULL,
  CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Signal_tenantId_idempotencyKey_key" ON "Signal"("tenantId", "idempotencyKey");
CREATE INDEX "Signal_tenantId_type_idx" ON "Signal"("tenantId", "type");
CREATE INDEX "Signal_tenantId_status_idx" ON "Signal"("tenantId", "status");
CREATE INDEX "Signal_tenantId_severity_idx" ON "Signal"("tenantId", "severity");
CREATE INDEX "Signal_tenantId_receivedAt_idx" ON "Signal"("tenantId", "receivedAt");
CREATE INDEX "Signal_tenantId_correlationId_idx" ON "Signal"("tenantId", "correlationId");
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Rule" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "triggerType" TEXT NOT NULL,
  "conditions" JSONB NOT NULL,
  "actions" JSONB NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Rule_tenantId_name_key" ON "Rule"("tenantId", "name");
CREATE INDEX "Rule_tenantId_triggerType_isActive_priority_idx" ON "Rule"("tenantId", "triggerType", "isActive", "priority");
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RuleExecution" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "signalId" TEXT NOT NULL,
  "matched" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuleExecution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RuleExecution_tenantId_ruleId_signalId_key" ON "RuleExecution"("tenantId", "ruleId", "signalId");
CREATE INDEX "RuleExecution_tenantId_signalId_idx" ON "RuleExecution"("tenantId", "signalId");
ALTER TABLE "RuleExecution" ADD CONSTRAINT "RuleExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RuleExecution" ADD CONSTRAINT "RuleExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RuleExecution" ADD CONSTRAINT "RuleExecution_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Action" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "signalId" TEXT,
  "ruleId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "riskLevel" "RiskLevel" NOT NULL,
  "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
  "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  "approvalReason" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "errorMessage" TEXT,
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  "requestId" TEXT,
  "correlationId" TEXT,
  CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Action_tenantId_dedupeKey_key" ON "Action"("tenantId", "dedupeKey");
CREATE INDEX "Action_tenantId_signalId_idx" ON "Action"("tenantId", "signalId");
CREATE INDEX "Action_tenantId_status_idx" ON "Action"("tenantId", "status");
CREATE INDEX "Action_tenantId_type_idx" ON "Action"("tenantId", "type");
CREATE INDEX "Action_tenantId_riskLevel_idx" ON "Action"("tenantId", "riskLevel");
ALTER TABLE "Action" ADD CONSTRAINT "Action_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Action" ADD CONSTRAINT "Action_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Action" ADD CONSTRAINT "Action_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Action" ADD CONSTRAINT "Action_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ActionAttempt" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "status" "ActionAttemptStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "workerId" TEXT,
  "requestId" TEXT,
  CONSTRAINT "ActionAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ActionAttempt_actionId_attemptNo_key" ON "ActionAttempt"("actionId", "attemptNo");
CREATE INDEX "ActionAttempt_tenantId_actionId_idx" ON "ActionAttempt"("tenantId", "actionId");
CREATE INDEX "ActionAttempt_tenantId_status_idx" ON "ActionAttempt"("tenantId", "status");
ALTER TABLE "ActionAttempt" ADD CONSTRAINT "ActionAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionAttempt" ADD CONSTRAINT "ActionAttempt_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ApprovalRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "minApproverRole" "Role" NOT NULL DEFAULT 'MANAGER',
  "selfApprovalAllowed" BOOLEAN NOT NULL DEFAULT false,
  "requestedById" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "decidedById" TEXT,
  "decisionReason" TEXT,
  CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApprovalRequest_actionId_key" ON "ApprovalRequest"("actionId");
CREATE INDEX "ApprovalRequest_tenantId_status_idx" ON "ApprovalRequest"("tenantId", "status");
CREATE INDEX "ApprovalRequest_tenantId_expiresAt_idx" ON "ApprovalRequest"("tenantId", "expiresAt");
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Incident" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "signalId" TEXT,
  "actionId" TEXT,
  "title" TEXT NOT NULL,
  "serviceName" TEXT,
  "severity" "Severity" NOT NULL,
  "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
  "probableCause" TEXT,
  "recommendedFix" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Incident_actionId_key" ON "Incident"("actionId");
CREATE INDEX "Incident_tenantId_status_idx" ON "Incident"("tenantId", "status");
CREATE INDEX "Incident_tenantId_severity_idx" ON "Incident"("tenantId", "severity");
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PurchaseRecommendation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "signalId" TEXT,
  "actionId" TEXT,
  "productSku" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "currentStock" INTEGER NOT NULL,
  "dailySalesAverage" DOUBLE PRECISION NOT NULL,
  "supplierLeadTimeDays" INTEGER NOT NULL,
  "suggestedQuantity" INTEGER NOT NULL,
  "riskLevel" "RiskLevel" NOT NULL,
  "supplierName" TEXT,
  "status" "RecommendationStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseRecommendation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PurchaseRecommendation_actionId_key" ON "PurchaseRecommendation"("actionId");
CREATE INDEX "PurchaseRecommendation_tenantId_status_idx" ON "PurchaseRecommendation"("tenantId", "status");
CREATE INDEX "PurchaseRecommendation_tenantId_productSku_idx" ON "PurchaseRecommendation"("tenantId", "productSku");
ALTER TABLE "PurchaseRecommendation" ADD CONSTRAINT "PurchaseRecommendation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseRecommendation" ADD CONSTRAINT "PurchaseRecommendation_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OperationalTask" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "signalId" TEXT,
  "actionId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "assignee" TEXT,
  "dueAt" TIMESTAMP(3),
  "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "OperationalTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperationalTask_actionId_key" ON "OperationalTask"("actionId");
CREATE INDEX "OperationalTask_tenantId_status_idx" ON "OperationalTask"("tenantId", "status");
CREATE INDEX "OperationalTask_tenantId_dueAt_idx" ON "OperationalTask"("tenantId", "dueAt");
ALTER TABLE "OperationalTask" ADD CONSTRAINT "OperationalTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationalTask" ADD CONSTRAINT "OperationalTask_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "recipient" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SIMULATED',
  "payload" JSONB NOT NULL,
  "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationDelivery_actionId_channel_recipient_key" ON "NotificationDelivery"("actionId", "channel", "recipient");
CREATE INDEX "NotificationDelivery_tenantId_status_idx" ON "NotificationDelivery"("tenantId", "status");
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "signalId" TEXT,
  "actor" TEXT NOT NULL,
  "actorUserId" TEXT,
  "event" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "requestId" TEXT,
  "correlationId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_tenantId_event_idx" ON "AuditLog"("tenantId", "event");
CREATE INDEX "AuditLog_tenantId_requestId_idx" ON "AuditLog"("tenantId", "requestId");
CREATE INDEX "AuditLog_tenantId_correlationId_idx" ON "AuditLog"("tenantId", "correlationId");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
