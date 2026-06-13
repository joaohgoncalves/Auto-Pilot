import type { RiskLevel } from '@autopilotops/shared';

import { toNumber } from '../lib/utils.js';

export interface CorrelationResult {
  diagnosis: string;
  riskLevel: RiskLevel;
  context: Record<string, unknown>;
}

export function correlateSignal(type: string, payload: Record<string, unknown>): CorrelationResult {
  if (type === 'service.error_rate_spike') {
    const errorRateBefore = toNumber(payload.errorRateBefore);
    const errorRateNow = toNumber(payload.errorRateNow);
    const lastDeploymentMinutesAgo = toNumber(payload.lastDeploymentMinutesAgo, 999);
    const increasePercent = errorRateBefore > 0 ? ((errorRateNow - errorRateBefore) / errorRateBefore) * 100 : 9999;
    const serviceName = String(payload.serviceName ?? 'Unknown service');
    const isRegression = increasePercent > 200 && lastDeploymentMinutesAgo <= 15;

    return {
      diagnosis: isRegression
        ? `Probable deployment regression on ${serviceName}. Error rate increased ${Math.round(increasePercent)}% within ${lastDeploymentMinutesAgo} minutes of deployment.`
        : `Error rate spike detected on ${serviceName}.`,
      riskLevel: errorRateNow >= 15 ? 'HIGH' : 'MEDIUM',
      context: {
        serviceName,
        increasePercent,
        isRegression,
        recommendedFix: isRegression ? 'Rollback the last production deployment after approval.' : 'Run incident diagnostics and inspect dependency health.'
      }
    };
  }

  if (type === 'inventory.stockout_risk') {
    const currentStock = toNumber(payload.currentStock);
    const dailySalesAverage = toNumber(payload.dailySalesAverage);
    const supplierLeadTimeDays = toNumber(payload.supplierLeadTimeDays, 1);
    const minimumDisplayStock = toNumber(payload.minimumDisplayStock, 0);
    const projectedDemand = dailySalesAverage * supplierLeadTimeDays + minimumDisplayStock;
    const shortage = Math.max(0, projectedDemand - currentStock);
    const productName = String(payload.productName ?? 'Unknown product');

    return {
      diagnosis: shortage > 0
        ? `Stockout expected for ${productName}. Current stock cannot cover projected demand and minimum display stock.`
        : `${productName} stock is currently safe.`,
      riskLevel: shortage > dailySalesAverage ? 'HIGH' : shortage > 0 ? 'MEDIUM' : 'LOW',
      context: {
        productName,
        projectedDemand,
        shortage,
        suggestedQuantity: Math.ceil(Math.max(shortage, dailySalesAverage * 3)),
        supplierName: payload.primarySupplier ?? null
      }
    };
  }

  if (type === 'inventory.expiring_stock') {
    const productName = String(payload.productName ?? 'Unknown product');
    const stock = toNumber(payload.stock);
    const dailySalesAverage = toNumber(payload.dailySalesAverage, 1);
    const expiresInDays = toNumber(payload.expiresInDays);
    const expectedSales = dailySalesAverage * expiresInDays;
    const expectedLeftover = Math.max(0, stock - expectedSales);

    return {
      diagnosis: expectedLeftover > 0
        ? `${productName} has expected leftover before expiration. Promotion recommended.`
        : `${productName} expiration risk is low based on sales velocity.`,
      riskLevel: expectedLeftover > dailySalesAverage * 2 ? 'HIGH' : expectedLeftover > 0 ? 'MEDIUM' : 'LOW',
      context: {
        productName,
        expectedLeftover,
        suggestedDiscountPercent: expectedLeftover > dailySalesAverage * 2 ? 25 : 15
      }
    };
  }

  return {
    diagnosis: `Signal ${type} received without specialized correlation rule.`,
    riskLevel: 'LOW',
    context: {}
  };
}
