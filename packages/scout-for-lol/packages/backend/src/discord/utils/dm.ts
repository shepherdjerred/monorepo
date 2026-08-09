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
import { readOutreachState } from "#src/discord/utils/outreach-state.ts";
import {
  BUDGETED_DM_KINDS,
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
  /** Install time — the boundary that scopes state to this installation. */
  installedAt: Date;
  /** Ladder rung this message represents, persisted on the audit row. */
  ladderStage?: number;
};

/**
 * Kinds that are product output rather than outreach. These are what the user
 * asked for, so they are never budgeted and never carry the footer.
 */
const CORE_DM_KINDS: ReadonlySet<string> = new Set([
  "permission_error",
  "competition_invite",
  "prune_notice",
  "data_validation",
]);

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
    ladderStage?: number | undefined;
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
        ladderStage: row.ladderStage ?? null,
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
 * Serializes the read-decide-write sequence for budgeted sends.
 *
 * `evaluateBudget` reads the delivered-row count and `sendDM` writes the audit
 * row afterwards, so two concurrent callers — the outreach cron and a
 * `guildDelete` handler, say — could both observe two messages spent, both be
 * allowed, and both deliver a "Message 3 of 3", leaving four. The same race
 * bypasses the recipient cooldown for simultaneous removals.
 *
 * One global lock rather than a per-key one: budgeted traffic is a handful of
 * messages per day, so there is nothing to gain from finer granularity and a
 * single chain cannot miss a cross-guild cooldown interaction.
 */
let budgetedSendLock: Promise<null> = Promise.resolve(null);

async function runExclusively<T>(task: () => Promise<T>): Promise<T> {
  const previous = budgetedSendLock;
  const gate = Promise.withResolvers<null>();
  // Claim the lock synchronously, before the first await, so two callers
  // entering together still queue behind one another.
  budgetedSendLock = gate.promise;
  await previous;
  try {
    return await task();
  } finally {
    // Always release, so one failed send cannot wedge the queue forever.
    gate.resolve(null);
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
  const { spent } = await readOutreachState(
    db,
    budget.guildId,
    budget.installedAt,
  );
  if (spent >= NON_CORE_MESSAGE_BUDGET) {
    return { kind: "budget_exhausted" };
  }

  const cutoff = new Date(Date.now() - RECIPIENT_COOLDOWN_MS);
  const recent = await db.dmAuditLog.findFirst({
    where: {
      recipientId,
      deliveryStatus: "sent",
      // Every budgeted kind, not just the `outreach`-prefixed ones — the ladder
      // sends `feedback_request` to configured guilds, and an installer with
      // several of those would otherwise be DM'd about all of them at once.
      kind: { in: [...BUDGETED_DM_KINDS] },
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
  // Budgeted sends run one at a time so the budget read and the audit write
  // that follows it cannot interleave with another send.
  return options.budget === undefined
    ? sendDmUnsynchronized(options)
    : runExclusively(() => sendDmUnsynchronized(options));
}

async function sendDmUnsynchronized(options: SendDmOptions): Promise<DmStatus> {
  const { client, userId, kind, guildId } = options;
  const db = options.prisma ?? prisma;

  let message = options.message;

  // A non-core message without a budget would sit outside the cap and the
  // footer entirely — which is how the removal-time feedback DM could have
  // become a fourth message. Refuse rather than quietly over-send.
  if (options.budget === undefined && !CORE_DM_KINDS.has(kind)) {
    logger.error(
      `[DM] Refusing unbudgeted non-core ${kind} DM to ${userId} — pass a budget`,
    );
    await recordDmAudit(db, {
      recipientId: userId,
      recipientTag: options.recipientTag,
      guildId,
      kind,
      content: message,
      status: "budget_exhausted",
    });
    return "budget_exhausted";
  }

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
        ladderStage: options.budget.ladderStage,
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
      ladderStage: options.budget?.ladderStage,
    });
    // Nothing to increment: the audit row written above IS the ledger, so a
    // delivery and its accounting can never disagree.
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
      ladderStage: options.budget?.ladderStage,
      errorMessage: errorMsg,
    });
    return status;
  }
}
