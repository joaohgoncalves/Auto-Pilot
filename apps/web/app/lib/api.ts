import type { ApiSuccess, PaginatedResult, Role } from '@autopilotops/shared';

function inferApiUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === 'undefined') return 'http://localhost:4040';

  const { protocol, hostname, port } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `${protocol}//${hostname}:4040`;
  if (hostname.endsWith('.app.github.dev')) return `${protocol}//${hostname.replace(/-3000(\.|-)/, '-4040$1')}`;
  if (port === '3000') return `${protocol}//${hostname}:4040`;
  return `${protocol}//${hostname}`;
}

function readCookie(name: string) {
  if (typeof document === 'undefined') return null;
  return document.cookie
    .split('; ')
    .map((item) => item.split('='))
    .find(([key]) => key === name)?.slice(1).join('=') ?? null;
}

function csrfHeaders(method?: string) {
  const normalized = method?.toUpperCase() ?? 'GET';
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalized)) return {};
  const token = readCookie('csrfToken');
  return token ? { 'x-csrf-token': decodeURIComponent(token) } : {};
}

function buildHeaders(options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  for (const [key, value] of Object.entries(csrfHeaders(options.method))) headers.set(key, value);
  return headers;
}

export type Summary = {
  signals: number;
  incidentsOpen: number;
  approvalsPending: number;
  recommendationsOpen: number;
  tasksOpen: number;
  actionsWaiting: number;
  failedActions: number;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  refreshExpiresAt: string;
  user: { id: string; name: string; email: string };
  tenant: { id: string; name: string; slug: string };
  role: Role;
  availableTenants: Array<{ id: string; name: string; slug: string; role: Role }>;
};

export type SignalRow = {
  id: string;
  type: string;
  entity: string;
  entityId: string;
  severity: string;
  riskLevel?: string | null;
  status: string;
  diagnosis?: string | null;
  receivedAt: string;
};

export type ActionRow = {
  id: string;
  type: string;
  title: string;
  status: string;
  riskLevel: string;
  requiresApproval: boolean;
  createdAt: string;
  errorMessage?: string | null;
};

export type ApprovalRow = {
  id: string;
  title: string;
  status: string;
  reason: string;
  minApproverRole: Role;
  requestedAt: string;
  expiresAt?: string | null;
  action: ActionRow;
};

export type IncidentRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
  probableCause?: string | null;
  recommendedFix?: string | null;
  startedAt: string;
};

export type RecommendationRow = {
  id: string;
  productName: string;
  currentStock: number;
  suggestedQuantity: number;
  supplierName?: string | null;
  riskLevel: string;
  status: string;
  createdAt: string;
};

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  assignee?: string | null;
  dueAt?: string | null;
  status: string;
  createdAt: string;
};

export type AuditRow = {
  id: string;
  actor: string;
  event: string;
  message: string;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  createdAt: string;
};

export type RuleRow = {
  id: string;
  name: string;
  description?: string | null;
  triggerType: string;
  priority: number;
  isActive: boolean;
  conditions: unknown;
  actions: unknown;
  updatedAt: string;
};

function redirectToLogin() {
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) as ApiSuccess<T> | { error: { message: string } } : null;

  if (!response.ok) {
    const message = payload && 'error' in payload ? payload.error.message : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (payload && 'data' in payload) return payload.data;
  return payload as T;
}

async function request(path: string, options: RequestInit = {}, retryOnUnauthorized = true) {
  const response = await fetch(`${inferApiUrl()}${path}`, {
    ...options,
    credentials: 'include',
    headers: buildHeaders(options)
  });

  if (response.status === 401 && retryOnUnauthorized && !path.startsWith('/auth/')) {
    const refreshed = await fetch(`${inferApiUrl()}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders({ method: 'POST' }),
      body: '{}'
    });

    if (refreshed.ok) return request(path, options, false);
    redirectToLogin();
  }

  return response;
}

export function getAccessToken() {
  return null;
}

export function saveAuth(_data: AuthResponse) {
  // Auth is stored by the API through httpOnly cookies. This function is kept for compatibility with existing UI calls.
}

export async function clearAuth() {
  await fetch(`${inferApiUrl()}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders({ method: 'POST' }),
    body: '{}'
  }).catch(() => undefined);
}

export function requireBrowserAuth() {
  // Browser auth is enforced by API 401 responses because tokens are httpOnly and not readable from JavaScript.
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await request(path, options);
  return parseResponse<T>(response);
}

export async function apiPage<T>(path: string, options: RequestInit = {}): Promise<PaginatedResult<T>> {
  const response = await request(path, options);
  const payload = await response.json() as ApiSuccess<T[]> & { meta: { total: number; page: number; limit: number } } | { error: { message: string } };
  if (!response.ok || 'error' in payload) {
    throw new Error('error' in payload ? payload.error.message : 'Request failed');
  }
  return { items: payload.data, total: payload.meta.total, page: payload.meta.page, limit: payload.meta.limit };
}
