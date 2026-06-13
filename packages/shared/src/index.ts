export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'] as const;
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const SEVERITIES = ['INFO', 'WARNING', 'HIGH', 'CRITICAL'] as const;
export const SIGNAL_STATUSES = ['RECEIVED', 'QUEUED', 'PROCESSING', 'PROCESSED', 'FAILED'] as const;
export const ACTION_STATUSES = ['PENDING', 'RUNNING', 'WAITING_APPROVAL', 'EXECUTED', 'FAILED', 'DEAD_LETTER', 'SKIPPED', 'REJECTED', 'CANCELED'] as const;
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELED'] as const;

export type UserRole = (typeof ROLES)[number];
export type Role = UserRole;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export type SignalType =
  | 'service.error_rate_spike'
  | 'inventory.stockout_risk'
  | 'inventory.expiring_stock'
  | string;

export interface RuleCondition {
  [field: string]: unknown;
}

export interface IngestSignalInput {
  source: string;
  type: SignalType;
  entity: string;
  entityId: string;
  severity: 'info' | 'warning' | 'high' | 'critical';
  data: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface EngineDecision {
  diagnosis: string;
  riskLevel: RiskLevel;
  actions: PlannedAction[];
}

export interface PlannedAction {
  type: string;
  title: string;
  riskLevel: RiskLevel;
  payload: Record<string, unknown>;
  ruleId?: string;
  ruleName?: string;
  priority?: number;
}

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiSuccess<T> extends ApiResponse<T> {}

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export interface ApiErrorBody {
  error: ApiError;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedResult<T> extends Paginated<T> {}

export interface MetricSummary {
  signalsTotal: number;
  actionsTotal: number;
  approvalsPending: number;
  incidentsOpen: number;
  recommendationsOpen: number;
  tasksOpen: number;
  rulesActive: number;
  failedActions: number;
  deadLetterActions: number;
  deadLetterEvents: number;
  outboxPending: number;
  outboxProcessed: number;
  outboxFailed: number;
  actionRetries: number;
  recoveredStaleLocks: number;
  approvalAvgMs: number;
}

export function roleRank(role: Role): number {
  return { VIEWER: 10, OPERATOR: 20, MANAGER: 30, ADMIN: 40, OWNER: 50 }[role];
}

export function canRoleAccess(userRole: Role, minimumRole: Role): boolean {
  return roleRank(userRole) >= roleRank(minimumRole);
}
