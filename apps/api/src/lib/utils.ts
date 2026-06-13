export function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function safeErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
