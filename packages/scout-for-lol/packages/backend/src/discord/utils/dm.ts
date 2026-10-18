/**
 * Direct Message (DM) Utilities
 *
 * Single chokepoint for sending DMs to Discord users. Every DM the bot sends
 * MUST go through `sendDM` so that it is recorded in the `DmAuditLog` table and
 * is therefore fully traceable. Do not call `user.send(...)` directly elsewhere.
 */

import {
  type Client,
  DiscordAPIError,
  type EmbedBuilder,
  RESTJSONErrorCodes,
  type RESTPostAPIChannelMessageJSONBody,
  Routes,
} from "discord.js";
import { z } from "zod";
import type { DmKind, DmBudget } from "#src/discord/utils/dm-contracts.ts";
import {
  DiscordChannelIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data/index.ts";
import {
  prisma,
  type Db,
  type ExtendedPrismaClient,
} from "#src/database/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { reserveBudgetedDm } from "#src/discord/utils/dm-budget.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-dm");

/**
 * Discord's definitive "this user cannot receive a DM from Scout" answers: DMs
 * disabled or the bot blocked (50007), and no mutual guild left (50278, the
 * usual answer once Scout has been removed). Both are a rejection Discord
 * returned, so the message was never created and nothing stays charged.
 */
const CANNOT_DM_USER_CODES: ReadonlySet<unknown> = new Set([
  RESTJSONErrorCodes.CannotSendMessagesToThisUser,
  RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds,
]);

const DmChannelSchema = z.object({ id: DiscordChannelIdSchema });

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
  "unknown",
]);
export type DmStatus = z.infer<typeof DmStatusSchema>;

/**
 * Kinds that are product output rather than outreach. These are what the user
 * asked for, so they are never budgeted and never carry the footer.
 */
const CORE_DM_KINDS: ReadonlySet<string> = new Set([
  "permission_error",
  "competition_invite",
  "prune_notice",
  "data_validation",
  "betting_settlement_receipt",
  "betting_player_bet_outcome",
  "dare_notification",
  // A match notification is what the recipient subscribed to, so it is product
  // output and carries neither the budget nor its footer.
  "match_notification",
  "support_acknowledgement",
  "support_reply",
  "support_notification",
]);

export type SendDmOptions = {
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
  /** A budget reservation committed with a durable notification intent. */
  reservationId?: number;
  /** Keep rendered mentions informational instead of notifying other users. */
  suppressMentions?: boolean;
  /**
   * Called synchronously immediately before the Discord request that can
   * create the message may leave. Opening the DM channel creates no message,
   * so a failure up to and including that request is a definite non-send.
   */
  onSendAttempt?: () => void;
  /**
   * Rich embeds to send alongside (or instead of) plain content. `message`
   * stays the audit-log rendering — the ledger is text — and is sent as the
   * content above the embeds only when `contentWithEmbeds` says so. Embeds are
   * core-output only: the budget footer is a content mutation, so a budgeted
   * embed send is refused outright rather than half-applied.
   */
  embeds?: readonly EmbedBuilder[];
  /**
   * Content to render above the embeds. Without it, an embed send carries no
   * plain content and `message` exists purely for the audit trail.
   */
  contentWithEmbeds?: string;
} & (
  | { client: Client; delivery?: never }
  | {
      client?: never;
      /** REST-only delivery for application processes with no gateway client. */
      delivery: (userId: DiscordAccountId, message: string) => Promise<void>;
    }
);

/**
 * Write a single audit row for a DM attempt. Best-effort: a failure to record
 * the audit log must never mask or block the DM itself.
 */
async function recordDmAudit(
  db: Db,
  row: {
    recipientId: string;
    recipientTag: string | undefined;
    guildId: DiscordGuildId | undefined;
    kind: DmKind;
    content: string;
    status: DmStatus;
    ladderStage?: number | undefined;
    errorMessage?: string | undefined;
  },
): Promise<boolean> {
  try {
    await db.dmAuditLog.create({
      data: {
        recipientId: row.recipientId,
        recipientTag: row.recipientTag ?? null,
        guildId: row.guildId ?? null,
        kind: row.kind,
        content: row.kind.startsWith("support_")
          ? "[Private support message; see the support inbox]"
          : row.content,
        deliveryStatus: row.status,
        ladderStage: row.ladderStage ?? null,
        errorMessage: row.errorMessage ?? null,
      },
    });
    return true;
  } catch (auditError) {
    logger.error(
      `[DM] Failed to write DmAuditLog row for user ${row.recipientId}:`,
      getErrorMessage(auditError),
    );
    return false;
  }
}

/**
 * Reserve budget before contacting Discord. The caller holds transaction
 * advisory locks for both the recipient and guild, across every backend pod.
 * Reserved and uncertain rows stay charged until confirmed sent or unsent.
 * A failed reservation must prevent the external request.
 */
/**
 * Settle a reserved row to its real outcome. A failure here leaves the row as
 * `unknown`, which over-charges the budget rather than permitting a re-send — the
 * safe direction when the alternative is breaking the printed message cap.
 */
async function finalizeDeliveryRow(
  db: ExtendedPrismaClient,
  outcome: {
    id: number;
    status: DmStatus | "reserved";
    recipientTag: string | undefined;
    errorMessage?: string | undefined;
  },
): Promise<void> {
  const { id, status, recipientTag = null, errorMessage = null } = outcome;
  try {
    await db.dmAuditLog.update({
      where: { id },
      data: {
        deliveryStatus: status,
        recipientTag,
        errorMessage,
      },
    });
  } catch (error) {
    logger.error(
      `[DM] Failed to settle ledger row ${id.toString()} to ${status}:`,
      getErrorMessage(error),
    );
  }
}

/**
 * Send a DM to a Discord user and record the attempt in the audit log.
 *
 * @returns the outcome: `"sent"`, `"dm_disabled"` (recipient blocks DMs), or
 *   `"failed"` (a Discord lookup or send error). Audit and budget storage
 *   failures can still throw.
 */
export async function sendDM(options: SendDmOptions): Promise<DmStatus> {
  return await sendDmUnsynchronized(options);
}

/** The one place a DM's wire shape is decided: embeds, content, mentions. */
function dmMessageBody(
  options: SendDmOptions,
  message: string,
): RESTPostAPIChannelMessageJSONBody {
  const mentions =
    options.suppressMentions === true
      ? { allowed_mentions: { parse: [] } }
      : {};
  if (options.embeds === undefined) return { content: message, ...mentions };
  return {
    ...(options.contentWithEmbeds === undefined
      ? {}
      : { content: options.contentWithEmbeds }),
    embeds: options.embeds.map((embed) => embed.toJSON()),
    ...mentions,
  };
}

/**
 * Deliver over the bot's REST client: open the DM channel, then post into it.
 *
 * Deliberately not `User#send`. discord.js finds a cached DM channel through
 * `client.user.id`, which only the gateway's READY payload populates, so on a
 * role that never logs in (the activity worker, where every scheduled and
 * durable DM runs) `user.send` threw `null is not an object (evaluating
 * 'this.client.user.id')` before any request left. Two plain REST calls need
 * only the token `authorizeDiscordRest` puts on every role, and they make the
 * ambiguity boundary exact: the marker fires only once the channel exists and
 * the message request is about to leave.
 */
async function deliverOverRest(
  rest: Pick<Client["rest"], "post">,
  userId: DiscordAccountId,
  options: SendDmOptions,
  message: string,
): Promise<void> {
  const body = dmMessageBody(options, message);
  const channel = DmChannelSchema.parse(
    await rest.post(Routes.userChannels(), {
      body: { recipient_id: userId },
    }),
  );
  options.onSendAttempt?.();
  await rest.post(Routes.channelMessages(channel.id), { body });
}

/**
 * Persist a send attempt's outcome: finalize the reserved budget row when one
 * exists, otherwise write a fresh audit row.
 */
async function recordSendOutcome(
  db: ExtendedPrismaClient,
  input: {
    reservedRowId: number | null;
    recipientId: string;
    recipientTag: string | undefined;
    guildId: DiscordGuildId | undefined;
    kind: DmKind;
    content: string;
    status: DmStatus;
    retainFailedReservation?: boolean;
    errorMessage?: string | undefined;
  },
): Promise<void> {
  if (input.reservedRowId === null) {
    await recordDmAudit(db, {
      recipientId: input.recipientId,
      recipientTag: input.recipientTag,
      guildId: input.guildId,
      kind: input.kind,
      content: input.content,
      status: input.status,
      errorMessage: input.errorMessage,
    });
    return;
  }
  // Only a durable intent can retry a reservation after a pre-send failure.
  // Direct callers must release it or the next outreach scan skips the rung.
  await finalizeDeliveryRow(db, {
    id: input.reservedRowId,
    status:
      input.status === "failed" && input.retainFailedReservation === true
        ? "reserved"
        : input.status,
    recipientTag: input.recipientTag,
    errorMessage: input.errorMessage,
  });
}

function validateDmOptions(options: SendDmOptions): void {
  if (options.delivery !== undefined && options.embeds !== undefined) {
    throw new Error("REST-only DM delivery does not support embeds");
  }

  if (
    options.embeds !== undefined &&
    (options.budget !== undefined || options.reservationId !== undefined)
  ) {
    // The budget footer mutates content; an embed send has no content to
    // mutate, and silently dropping the footer would falsify the printed
    // message count. No budgeted DM currently needs an embed.
    throw new Error("Budgeted DMs cannot carry embeds");
  }
  if (options.reservationId !== undefined && options.budget !== undefined)
    throw new Error("A durable DM reservation cannot reserve its budget twice");
}

async function prepareDmDelivery(
  options: SendDmOptions,
  db: ExtendedPrismaClient,
): Promise<
  | { kind: "ready"; message: string; reservedRowId: number | null }
  | { kind: "terminal"; status: DmStatus }
> {
  const { userId, kind, guildId } = options;
  let message = options.message;
  validateDmOptions(options);

  // A non-core message without a budget would sit outside the cap and the
  // footer entirely — which is how the removal-time feedback DM could have
  // become a fourth message. Refuse rather than quietly over-send.
  if (
    options.budget === undefined &&
    options.reservationId === undefined &&
    !CORE_DM_KINDS.has(kind)
  ) {
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
    return { kind: "terminal", status: "budget_exhausted" };
  }

  let reservedRowId: number | null = options.reservationId ?? null;
  // Reserve atomically before any Discord call. A pending or ambiguous row
  // consumes budget without claiming that a message was delivered.
  const budget = options.budget;
  if (budget !== undefined) {
    const reservation = await db.$transaction(
      async (tx) =>
        await reserveBudgetedDm(tx, {
          recipientId: userId,
          guildId: budget.guildId,
          kind,
          message,
          budget,
        }),
    );
    if (reservation.status !== "reserved") {
      logger.info(
        `[DM] Skipping ${kind} DM to ${userId}: ${reservation.status} (${budget.guildId})`,
      );
      await recordDmAudit(db, {
        recipientId: userId,
        recipientTag: options.recipientTag,
        guildId,
        kind,
        content: message,
        status: reservation.status,
        ladderStage: budget.ladderStage,
      });
      return { kind: "terminal", status: reservation.status };
    }
    message = reservation.message;
    reservedRowId = reservation.id;
  }

  if (reservedRowId !== null) {
    const reservation = await db.dmAuditLog.findUniqueOrThrow({
      where: { id: reservedRowId },
    });
    if (
      reservation.recipientId !== userId ||
      reservation.guildId !== (guildId ?? null) ||
      reservation.kind !== kind ||
      reservation.content !== message
    )
      throw new Error("DM reservation disagrees with its frozen notification");
    if (reservation.deliveryStatus === "sent")
      return { kind: "terminal", status: "sent" };
    if (reservation.deliveryStatus === "unknown")
      return { kind: "terminal", status: "unknown" };
    if (reservation.deliveryStatus !== "reserved")
      throw new Error("DM reservation is not eligible to send");
  }

  return { kind: "ready", message, reservedRowId };
}

async function sendDmUnsynchronized(options: SendDmOptions): Promise<DmStatus> {
  const { userId, kind, guildId } = options;
  const db = options.prisma ?? prisma;
  const prepared = await prepareDmDelivery(options, db);
  if (prepared.kind === "terminal") return prepared.status;
  const { message, reservedRowId } = prepared;
  let recipientTag = options.recipientTag;

  const attempt = { sent: false };
  const deliveryOptions: SendDmOptions = {
    ...options,
    onSendAttempt: () => {
      attempt.sent = true;
      options.onSendAttempt?.();
    },
  };
  try {
    if (options.client === undefined) {
      if (reservedRowId !== null && !(await beginReservedDm(db, reservedRowId)))
        return "unknown";
      deliveryOptions.onSendAttempt?.();
      await options.delivery(userId, message);
    } else {
      const user = await options.client.users.fetch(userId);
      recipientTag = recipientTag ?? user.tag;
      if (reservedRowId !== null && !(await beginReservedDm(db, reservedRowId)))
        return "unknown";
      await deliverOverRest(
        options.client.rest,
        userId,
        deliveryOptions,
        message,
      );
    }
    logger.info(`[DM] Successfully sent ${kind} DM to user ${userId}`);
    await recordSendOutcome(db, {
      reservedRowId,
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
      error instanceof DiscordAPIError && CANNOT_DM_USER_CODES.has(error.code);
    const errorMsg = kind.startsWith("support_")
      ? "Support delivery failed (details redacted)"
      : getErrorMessage(error);

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

    const status: DmStatus = dmDisabled
      ? "dm_disabled"
      : reservedRowId !== null && attempt.sent
        ? "unknown"
        : "failed";
    await recordSendOutcome(db, {
      reservedRowId,
      recipientId: userId,
      recipientTag,
      guildId,
      kind,
      content: message,
      status,
      retainFailedReservation: options.reservationId !== undefined,
      errorMessage: errorMsg,
    });
    return status;
  }
}

async function beginReservedDm(db: Db, id: number): Promise<boolean> {
  const claimed = await db.dmAuditLog.updateMany({
    where: { id, deliveryStatus: "reserved" },
    data: { deliveryStatus: "unknown" },
  });
  return claimed.count === 1;
}
