import { z } from 'zod';
import type { CorrelationResult } from './correlation.engine.js';
import { toNumber } from '../lib/utils.js';

const primitiveConditionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const operatorConditionSchema = z.object({
  eq: z.unknown().optional(),
  neq: z.unknown().optional(),
  gt: z.unknown().optional(),
  gte: z.unknown().optional(),
  lt: z.unknown().optional(),
  lte: z.unknown().optional(),
  in: z.array(z.unknown()).optional(),
  notIn: z.array(z.unknown()).optional(),
  contains: z.unknown().optional(),
  exists: z.boolean().optional(),
  between: z.tuple([z.unknown(), z.unknown()]).optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one condition operator is required.');

export const ruleConditionsSchema = z.record(z.union([primitiveConditionValueSchema, operatorConditionSchema])).default({});

function valueFromContext(key: string, payload: Record<string, unknown>, correlation: CorrelationResult) {
  if (key in payload) return payload[key];
  if (key in correlation.context) return correlation.context[key];
  if (key === 'riskLevel') return correlation.riskLevel;
  if (key === 'diagnosis') return correlation.diagnosis;
  if (key === 'errorRateIncreasePercent') return correlation.context.increasePercent;
  if (key === 'currentStockLowerThanProjectedDemand') return toNumber(correlation.context.shortage) > 0;
  return undefined;
}

function sameValue(actual: unknown, expected: unknown) {
  return actual === expected;
}

function contains(actual: unknown, expected: unknown) {
  if (Array.isArray(actual)) return actual.includes(expected);
  return String(actual ?? '').includes(String(expected));
}

function compare(actual: unknown, expected: unknown) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    const operators = expected as Record<string, unknown>;
    if ('exists' in operators) {
      const exists = actual !== undefined && actual !== null;
      if (exists !== Boolean(operators.exists)) return false;
    }
    if ('gt' in operators && !(toNumber(actual) > toNumber(operators.gt))) return false;
    if ('gte' in operators && !(toNumber(actual) >= toNumber(operators.gte))) return false;
    if ('lt' in operators && !(toNumber(actual) < toNumber(operators.lt))) return false;
    if ('lte' in operators && !(toNumber(actual) <= toNumber(operators.lte))) return false;
    if ('eq' in operators && !sameValue(actual, operators.eq)) return false;
    if ('neq' in operators && sameValue(actual, operators.neq)) return false;
    if ('in' in operators && Array.isArray(operators.in) && !operators.in.includes(actual)) return false;
    if ('notIn' in operators && Array.isArray(operators.notIn) && operators.notIn.includes(actual)) return false;
    if ('contains' in operators && !contains(actual, operators.contains)) return false;
    if ('between' in operators && Array.isArray(operators.between)) {
      const [min, max] = operators.between;
      const numericActual = toNumber(actual);
      if (!(numericActual >= toNumber(min) && numericActual <= toNumber(max))) return false;
    }
    return true;
  }

  return sameValue(actual, expected);
}

export function matchesConditions(conditions: unknown, payload: Record<string, unknown>, correlation: CorrelationResult) {
  const parsed = ruleConditionsSchema.safeParse(conditions ?? {});
  if (!parsed.success) return false;
  return Object.entries(parsed.data).every(([key, expected]) => compare(valueFromContext(key, payload, correlation), expected));
}
