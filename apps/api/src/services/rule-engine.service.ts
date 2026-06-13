import type { Rule } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

const RULE_CACHE_TTL_SECONDS = 60;

function cacheKey(tenantId: string, triggerType: string) {
  return `rules:${tenantId}:${triggerType}`;
}

function reviveRule(rule: Rule): Rule {
  return {
    ...rule,
    createdAt: new Date(rule.createdAt),
    updatedAt: new Date(rule.updatedAt)
  };
}

export class RuleEngineService {
  async listActiveRules(tenantId: string, triggerType: string): Promise<Rule[]> {
    const key = cacheKey(tenantId, triggerType);
    const cached = await redis.get(key).catch(() => null);
    if (cached) {
      try {
        return (JSON.parse(cached) as Rule[]).map(reviveRule);
      } catch {
        await redis.del(key).catch(() => undefined);
      }
    }

    const rules = await prisma.rule.findMany({
      where: { tenantId, triggerType, isActive: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
    });
    await redis.set(key, JSON.stringify(rules), 'EX', RULE_CACHE_TTL_SECONDS).catch(() => undefined);
    return rules;
  }

  async invalidateRules(tenantId: string, triggerType?: string) {
    if (triggerType) {
      await redis.del(cacheKey(tenantId, triggerType)).catch(() => undefined);
      return;
    }
    const keys = await redis.keys(`rules:${tenantId}:*`).catch(() => []);
    if (keys.length > 0) await redis.del(...keys).catch(() => undefined);
  }
}

export const ruleEngineService = new RuleEngineService();
