import { describe, expect, it } from 'vitest';
import { toNumber } from '../lib/utils.js';

describe('toNumber', () => {
  it('converts numeric values', () => {
    expect(toNumber(10)).toBe(10);
    expect(toNumber('12.5')).toBe(12.5);
  });

  it('returns fallback for NaN and infinite values', () => {
    expect(toNumber('nope', 7)).toBe(7);
    expect(toNumber(Number.NaN, 9)).toBe(9);
    expect(toNumber(Number.POSITIVE_INFINITY, 3)).toBe(3);
  });

  it('defaults fallback to zero', () => {
    expect(toNumber(undefined)).toBe(0);
  });
});
