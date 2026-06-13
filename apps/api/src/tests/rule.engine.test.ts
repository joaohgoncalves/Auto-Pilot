import { describe, expect, it } from 'vitest';
import { matchesConditions } from '../engines/condition.engine.js';
import type { CorrelationResult } from '../engines/correlation.engine.js';

const correlation: CorrelationResult = {
  diagnosis: 'Probable deployment regression',
  riskLevel: 'HIGH',
  context: {
    increasePercent: 300,
    shortage: 12,
    isRegression: true
  }
};

describe('rule engine condition evaluator', () => {
  it('matches numeric operators and derived aliases', () => {
    expect(matchesConditions({ errorRateIncreasePercent: { gt: 200 }, currentStockLowerThanProjectedDemand: true }, {}, correlation)).toBe(true);
  });

  it('does not match failing operators', () => {
    expect(matchesConditions({ errorRateIncreasePercent: { lt: 100 } }, {}, correlation)).toBe(false);
  });

  it('matches direct payload values', () => {
    expect(matchesConditions({ environment: 'production' }, { environment: 'production' }, correlation)).toBe(true);
  });


  it('supports exists, notIn and between operators', () => {
    expect(matchesConditions({ environment: { exists: true }, status: { notIn: ['closed'] }, score: { between: [10, 20] } }, { environment: 'production', status: 'open', score: 15 }, correlation)).toBe(true);
  });

  it('rejects malformed or unsupported operators safely', () => {
    expect(matchesConditions({ score: { regex: '.*' } }, { score: 15 }, correlation)).toBe(false);
  });
});
