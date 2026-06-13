import type { PaginatedResult } from '@autopilotops/shared';

export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return meta ? { data, meta } : { data };
}

export function paginated<T>(result: PaginatedResult<T>) {
  return { data: result.items, meta: { total: result.total, page: result.page, limit: result.limit } };
}
