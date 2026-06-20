/**
 * Direct Message (DM) Utilities
 *
 * Single chokepoint for sending DMs to Discord users. Every DM the bot sends
 * MUST go through `sendDM` so that it is recorded in the `DmAuditLog` table and
 * is therefore fully traceable. Do not call `user.send(...)` directly elsewhere.
 */

import { type Client, DiscordAPIError } from "discord.js";
import { z } from "zod";
import {
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-dm");

// Discord API error code: "Cannot send messages to this user" (DMs disabled or
// the bot is blocked).
const CANNOT_DM_USER_CODE = 50_007;

/**
 * Category of DM, used to group/filter rows in the audit log.
 */
export const DmKindSchema = z.enum([
  "permission_error",
  "feedback_request",
  "competition_invite",
  "prune_notice",
  "outreach_3d",
  "outreach_14d",
  "outreach_manual",
  "data_validation",
]);
export type DmKind = z.infer<typeof DmKindSchema>;

/**
 * Outcome of a DM attempt, persisted to `DmAuditLog.status`.
 */
export const DmStatusSchema = z.enum(["sent", "dm_disabled", "failed"]);
export type DmStatus = z.infer<typeof DmStatusSchema>;

export type SendDmOptions = {
  client: Client;
  userId: DiscordAccountId;
  message: string;
  kind: DmKind;
  /** Guild this DM relates to, when applicable. */
  guildId?: DiscordGuildId;
  /** Override the recipient tag recorded in the audit log. */
  recipientTag?: string;
  /** Injectable for tests; defaults to the shared client. */
  prisma?: ExtendedPrismaClient;
};

/**
 * Write a single audit row for a DM attempt. Best-effort: a failure to record
 * the audit log must never mask or block the DM itself.
 */
async function recordDmAudit(
  db: ExtendedPrismaClient,
  row: {
    recipientId: string;
    recipientTag: string | undefined;
    guildId: string | undefined;
    kind: DmKind;
    content: string;
    status: DmStatus;
    errorMessage?: string | undefined;
  },
): Promise<void> {
  try {
    await db.dmAuditLog.create({
      data: {
        recipientId: row.recipientId,
        recipientTag: row.recipientTag ?? null,
        guildId: row.guildId ?? null,
        kind: row.kind,
        content: row.content,
        deliveryStatus: row.status,
        errorMessage: row.errorMessage ?? null,
      },
    });
  } catch (auditError) {
    logger.error(
      `[DM] Failed to write DmAuditLog row for user ${row.recipientId}:`,
      getErrorMessage(auditError),
    );
  }
}

/**
 * Send a DM to a Discord user and record the attempt in the audit log.
 *
 * @returns the outcome: `"sent"`, `"dm_disabled"` (recipient blocks DMs), or
 *   `"failed"` (any other error). Never throws.
 */
export async function sendDM(options: SendDmOptions): Promise<DmStatus> {
  const { client, userId, message, kind, guildId } = options;
  const db = options.prisma ?? prisma;

  let recipientTag = options.recipientTag;
  try {
    const user = await client.users.fetch(userId);
    recipientTag = recipientTag ?? user.tag;
    await user.send(message);
    logger.info(`[DM] Successfully sent ${kind} DM to user ${userId}`);
    await recordDmAudit(db, {
      recipientId: userId,
      recipientTag,
      guildId,
      kind,
      content: message,
      status: "sent",
    });
    return "sent";
  } catch (error) {
    const dmDisabled =
      error instanceof DiscordAPIError && error.code === CANNOT_DM_USER_CODE;
    const errorMsg = getErrorMessage(error);

    if (dmDisabled) {
      logger.info(
        `[DM] User ${userId} has DMs disabled or has blocked the bot (${kind})`,
      );
    } else {
      logger.error(
        `[DM] Failed to send ${kind} DM to user ${userId}:`,
        errorMsg,
      );
    }

    const status: DmStatus = dmDisabled ? "dm_disabled" : "failed";
    await recordDmAudit(db, {
      recipientId: userId,
      recipientTag,
      guildId,
      kind,
      content: message,
      status,
      errorMessage: errorMsg,
    });
    return status;
  }
}
