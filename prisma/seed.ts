import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(email: string, name: string, password: string, tenantId: string, role: Role) {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12)
    }
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    update: { role },
    create: { userId: user.id, tenantId, role }
  });

  return user;
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'autopilotops-demo' },
    update: {},
    create: {
      name: 'AutoPilotOps Demo',
      slug: 'autopilotops-demo',
      autoExecuteMediumRisk: false
    }
  });

  const owner = await upsertUser('admin@autopilotops.dev', 'Owner Demo', 'Admin@123456', tenant.id, Role.OWNER);
  await upsertUser('manager@autopilotops.dev', 'Manager Demo', 'Manager@123456', tenant.id, Role.MANAGER);
  await upsertUser('operator@autopilotops.dev', 'Operator Demo', 'Operator@123456', tenant.id, Role.OPERATOR);
  await upsertUser('viewer@autopilotops.dev', 'Viewer Demo', 'Viewer@123456', tenant.id, Role.VIEWER);

  const rules = [
    {
      name: 'Production deploy regression playbook',
      description: 'Creates incident, approval gate and recovery workflow for a likely production deployment regression.',
      triggerType: 'service.error_rate_spike',
      priority: 10,
      conditions: { errorRateIncreasePercent: { gt: 200 }, lastDeploymentMinutesAgo: { lt: 15 } },
      actions: [
        { type: 'create_incident', riskLevel: 'LOW' },
        { type: 'request_rollback_approval', riskLevel: 'HIGH' },
        { type: 'notify_oncall', riskLevel: 'LOW' },
        { type: 'schedule_recovery_check', riskLevel: 'LOW' }
      ]
    },
    {
      name: 'Retail stockout prevention playbook',
      description: 'Creates purchase recommendation and replenishment task when projected demand exceeds stock.',
      triggerType: 'inventory.stockout_risk',
      priority: 20,
      conditions: { currentStockLowerThanProjectedDemand: true },
      actions: [
        { type: 'create_purchase_recommendation', riskLevel: 'LOW' },
        { type: 'create_operational_task', riskLevel: 'LOW' },
        { type: 'notify_manager', riskLevel: 'LOW' },
        { type: 'schedule_followup_check', riskLevel: 'LOW' }
      ]
    },
    {
      name: 'Expiring stock loss prevention playbook',
      description: 'Creates discount and operational task for products close to expiration.',
      triggerType: 'inventory.expiring_stock',
      priority: 30,
      conditions: { expiresInDays: { lte: 3 } },
      actions: [
        { type: 'create_discount_recommendation', riskLevel: 'MEDIUM' },
        { type: 'create_operational_task', riskLevel: 'LOW' },
        { type: 'notify_manager', riskLevel: 'LOW' }
      ]
    }
  ];

  for (const rule of rules) {
    await prisma.rule.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: rule.name } },
      update: {
        description: rule.description,
        triggerType: rule.triggerType,
        priority: rule.priority,
        conditions: rule.conditions,
        actions: rule.actions,
        isActive: true,
        updatedById: owner.id
      },
      create: { tenantId: tenant.id, ...rule, createdById: owner.id, updatedById: owner.id }
    });
  }

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      actor: 'system.seed',
      actorUserId: owner.id,
      event: 'seed.completed',
      message: 'Demo tenant, users, memberships and playbook rules were created.',
      metadata: { ownerEmail: owner.email }
    }
  });

  console.log('Seed completed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
