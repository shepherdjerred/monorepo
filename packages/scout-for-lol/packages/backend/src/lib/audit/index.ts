import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("audit");

export const AuditActionSchema = z.enum([
  "SUBSCRIPTION_ADD",
  "SUBSCRIPTION_REMOVE",
  "SUBSCRIPTION_ADD_CHANNEL",
  "SUBSCRIPTION_MOVE",
  "PLAYER_CREATE",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export type RecordAuditInput = {
  action: AuditAction;
  actorDiscordId: string;
  serverId: string;
  targetChannelId?: string | null;
  targetPlayerId?: number | null;
  targetAccountId?: number | null;
  payload: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorDiscordId: DiscordAccountIdSchema.parse(input.actorDiscordId),
        serverId: DiscordGuildIdSchema.parse(input.serverId),
        action: AuditActionSchema.parse(input.action),
        targetChannelId: input.targetChannelId ?? null,
        targetPlayerId: input.targetPlayerId ?? null,
        targetAccountId: input.targetAccountId ?? null,
        payload: JSON.stringify(input.payload),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    logger.error("❌ Failed to record audit log entry", {
      error,
      action: input.action,
      serverId: input.serverId,
    });
  }
}
