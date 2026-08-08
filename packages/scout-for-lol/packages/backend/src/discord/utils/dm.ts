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
import { truncateDiscordMessage } from "#src/discord/utils/message.ts";
import {
  messageBudgetFooter,
  NON_CORE_MESSAGE_BUDGET,
  RECIPIENT_COOLDOWN_MS,
} from "#src/discord/utils/message-budget.ts";
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
  // Ladder kinds. The stage-numbered kinds below are retained so historical
  // DmAuditLog rows still parse; new sends use the intent-named kinds.
  "outreach_nudge",
  "outreach_last_call",
  "outreach_3d",
  "outreach_14d",
  "outreach_30d",
  "outreach_manual",
  "data_validation",
]);
export type DmKind = z.infer<typeof DmKindSchema>;

/**
 * Outcome of a DM attempt, persisted to `DmAuditLog.status`.
 *
 * `budget_exhausted` and `deferred` are refusals: nothing was sent to Discord,
 * and no budget was consumed. They are recorded so that "we chose not to
 * message this person" is as auditable as a delivery.
 */
export const DmStatusSchema = z.enum([
  "sent",
  "dm_disabled",
  "failed",
  "budget_exhausted",
  "deferred",
]);
export type DmStatus = z.infer<typeof DmStatusSchema>;

/**
 * Marks a DM as non-core (onboarding/feedback rather than product output) and
 * subject to the per-server message budget.
 *
 * Enforcement lives here, in the single chokepoint every DM already flows
 * through, rather than in the callers — a future caller cannot then forget the
 * check and quietly break the "at most N messages, ever" promise we print in
 * the message body.
 */
export type DmBudget = {
  /** Server the budget is tracked against. */
  guildId: DiscordGuildId;
  /** Human-readable name, used in the transparency footer. */
  serverName: string;
};

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
  /**
   * Present for non-core messages. When set, the send is gated on the server's
   * remaining budget and the recipient cooldown, the transparency footer is
   * appended automatically, and a successful delivery advances the counter.
   */
  budget?: DmBudget;
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

/** Advance the server's delivered-message counter. Called only after a send. */
async function consumeBudget(
  db: ExtendedPrismaClient,
  budget: DmBudget,
): Promise<void> {
  try {
    await db.guildInstall.updateMany({
      where: { serverId: budget.guildId },
      data: { outreachStage: { increment: 1 }, lastOutreachAt: new Date() },
    });
  } catch (error) {
    // A bookkeeping failure must not be mistaken for a send failure, but it
    // does risk a duplicate later, so it is logged loudly rather than ignored.
    logger.error(
      `[DM] Failed to advance message budget for guild ${budget.guildId}:`,
      getErrorMessage(error),
    );
  }
}

type BudgetDecision =
  | { kind: "allow"; messageNumber: number }
  | { kind: "budget_exhausted" }
  | { kind: "deferred" };

/**
 * Decide whether a budgeted message may be sent right now.
 *
 * Two independent limits: the per-server lifetime budget, and a per-recipient
 * cooldown so someone who installed Scout in several guilds at once is not DM'd
 * several times on the same day.
 */
async function evaluateBudget(
  db: ExtendedPrismaClient,
  budget: DmBudget,
  recipientId: DiscordAccountId,
): Promise<BudgetDecision> {
  const install = await db.guildInstall.findUnique({
    where: { serverId: budget.guildId },
    select: { outreachStage: true },
  });
  const spent = install?.outreachStage ?? 0;
  if (spent >= NON_CORE_MESSAGE_BUDGET) {
    return { kind: "budget_exhausted" };
  }

  const cutoff = new Date(Date.now() - RECIPIENT_COOLDOWN_MS);
  const recent = await db.dmAuditLog.findFirst({
    where: {
      recipientId,
      deliveryStatus: "sent",
      kind: { startsWith: "outreach" },
      createdAt: { gt: cutoff },
    },
    select: { id: true },
  });
  if (recent !== null) {
    // Deferred, not dropped: the next daily run re-evaluates this guild.
    return { kind: "deferred" };
  }

  return { kind: "allow", messageNumber: spent + 1 };
}

/**
 * Send a DM to a Discord user and record the attempt in the audit log.
 *
 * @returns the outcome: `"sent"`, `"dm_disabled"` (recipient blocks DMs), or
 *   `"failed"` (any other error). Never throws.
 */
export async function sendDM(options: SendDmOptions): Promise<DmStatus> {
  const { client, userId, kind, guildId } = options;
  const db = options.prisma ?? prisma;

  let message = options.message;

  // Budget gate. Deliberately before any Discord call: a refusal must not look
  // like a delivery attempt, and must not consume budget.
  if (options.budget !== undefined) {
    const decision = await evaluateBudget(db, options.budget, userId);
    if (decision.kind !== "allow") {
      logger.info(
        `[DM] Skipping ${kind} DM to ${userId}: ${decision.kind} (${options.budget.guildId})`,
      );
      await recordDmAudit(db, {
        recipientId: userId,
        recipientTag: options.recipientTag,
        guildId,
        kind,
        content: message,
        status: decision.kind,
      });
      return decision.kind;
    }
    message = truncateDiscordMessage(
      message +
        messageBudgetFooter({
          serverName: options.budget.serverName,
          messageNumber: decision.messageNumber,
        }),
    );
  }

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
    // Budget is consumed only on actual delivery. Charging for a bounced DM is
    // what silently exhausted guilds that never received anything.
    if (options.budget !== undefined) {
      await consumeBudget(db, options.budget);
    }
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
