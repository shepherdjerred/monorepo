import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import type { Db } from "#src/database/index.ts";

const logger = createLogger("audit");

export const AuditActionSchema = z.enum([
  "SUBSCRIPTION_ADD",
  "SUBSCRIPTION_REMOVE",
  "SUBSCRIPTION_ADD_CHANNEL",
  "SUBSCRIPTION_MOVE",
  "SUBSCRIPTION_SET_FILTERS",
  "SUBSCRIPTION_BULK_SET_FILTERS",
  "SUBSCRIPTION_SET_MUTED",
  "PLAYER_CREATE",
  "PLAYER_RENAME",
  "PLAYER_DELETE",
  "PLAYER_MERGE",
  "PLAYER_LINK_DISCORD",
  "PLAYER_UNLINK_DISCORD",
  "ACCOUNT_ADD",
  "ACCOUNT_DELETE",
  "ACCOUNT_TRANSFER",
  "ACCOUNT_UPDATE",
  "ROLE_GRANT",
  "ROLE_REVOKE",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/**
 * The transaction client handed to the callback of
 * `prisma.$transaction(...)` from our extended Prisma client. The
 * extension changes the internal generics enough that the stock
 * `Prisma.TransactionClient` type doesn't unify. The database module derives
 * `Db` from the actual client so both repositories and lib functions accept
 * exactly what their callers pass through.
 *
 * Functions that need to run mutation + audit atomically open the
 * transaction at the caller boundary and thread `tx` through.
 */
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

/**
 * Record a single audit row. Throws if the write fails so the caller's
 * transaction rolls back — we'd rather fail the whole mutation than
 * leave a state change without an audit trail.
 */
export async function recordAudit(
  input: RecordAuditInput,
  db: Db,
): Promise<void> {
  try {
    await db.auditLog.create({
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
    throw error;
  }
}
