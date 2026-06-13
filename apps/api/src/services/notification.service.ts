import { prisma } from '../lib/prisma.js';

export interface SimulatedNotificationInput {
  tenantId: string;
  actionId: string;
  channel: string;
  recipient?: string | null;
  payload: Record<string, unknown>;
}

export class NotificationService {
  async simulateDelivery(input: SimulatedNotificationInput) {
    return prisma.notificationDelivery.upsert({
      where: { actionId_channel_recipient: { actionId: input.actionId, channel: input.channel, recipient: input.recipient ?? null } },
      update: {},
      create: {
        tenantId: input.tenantId,
        actionId: input.actionId,
        channel: input.channel,
        recipient: input.recipient ?? null,
        payload: input.payload
      }
    });
  }
}

export const notificationService = new NotificationService();
