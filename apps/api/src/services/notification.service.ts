import type { Prisma } from '@prisma/client';
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
    const recipient = input.recipient ?? '';
    return prisma.notificationDelivery.upsert({
      where: { actionId_channel_recipient: { actionId: input.actionId, channel: input.channel, recipient } },
      update: {},
      create: {
        tenantId: input.tenantId,
        actionId: input.actionId,
        channel: input.channel,
        recipient,
        payload: input.payload as Prisma.InputJsonValue
      }
    });
  }
}

export const notificationService = new NotificationService();
