import type { MessageCreateOptions } from "discord.js";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";
import { DiscordMessageIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  type NotificationFailure,
  type NotificationUnsentSuppressionReason,
  type NotificationTarget,
  type NotificationIntentKind,
  ANNOUNCEMENT_INTENT_KINDS,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  ScoutNotificationDeliveryResultSchema,
  type ScoutNotificationDeliveryResult,
} from "@scout-for-lol/temporal/activity-contracts";
import type { ScoutIntentAttemptRef } from "@scout-for-lol/temporal/pipeline-contracts";
import { client } from "#src/discord/client.ts";
import { fetchChannelForDelivery } from "#src/discord/utils/channel.ts";
import { sendDM, type DmStatus } from "#src/discord/utils/dm.ts";
import {
  isMissingChannelError,
  isPermissionError,
} from "#src/discord/utils/permissions.ts";
import {
  ChannelSendError,
  isReplyPermissionError,
  send,
} from "#src/league/discord/channel.ts";
import { deliveryAttemptNonce } from "#src/durable/match/delivery-intents.ts";
import { freshBotMember } from "#src/lib/discord/bot-rest.ts";
import { prisma } from "#src/database/index.ts";
import type {
  MatchNotificationIntentRecord,
  NotificationIntentRecord,
} from "#src/database/durable/intent-row.ts";
import { ArchivedObjectUnusableError } from "#src/report-store/s3-raw-source.ts";
import { UndeliverableContentError } from "#src/temporal/notification/undeliverable-content.ts";
import {
  assertHallRecordBreakTargetGuild,
  hallRecordBreakSuppression,
} from "#src/temporal/notification/hall-record-break-notification.ts";
import { hallInstallationRetirementOf } from "#src/temporal/notification/intent-audience.ts";
import { buildAttestedMessage } from "#src/temporal/notification/notification-message.ts";
import { duelStatusSuppression } from "#src/temporal/notification/duel-status-notification.ts";
import {
  dareStatusAnnouncementOf,
  dareStatusSuppression,
} from "#src/temporal/notification/dare-status-notification.ts";
import {
  PreSendBudgetExpiredError,
  withPreSendBudget,
} from "#src/temporal/notification/pre-send-budget.ts";
import { resolveNotificationGate } from "#src/temporal/notification/notification-policy.ts";
import { requireIntentRecord } from "#src/temporal/notification-lane/notification-reads.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("scout-v2-notification-delivery");

/**
 * The one place a V2 notification reaches Discord.
 *
 * This Activity runs with `maximumAttempts: 1`, which is the only retry policy
 * that is safe here: the request may have posted a message before its response
 * was lost, so a second attempt is a possible duplicate rather than a repair.
 * Everything below is therefore built to answer one question as precisely as it
 * can — did this send definitely not happen, definitely happen, or nobody
 * knows — because `unknown` is a dead end an operator has to walk out of, and
 * parking a transient blip there is as costly in its own way as retrying an
 * ambiguous send.
 */

/**
 * Classify a failed channel send into the domain's vocabulary, or report that
 * nobody can say.
 *
 * `ChannelSendError.permissionError` is the load-bearing bit, and it does not
 * mean what its name suggests. `send` sets it for failures it HANDLED before or
 * around the request — a channel it could not resolve, a channel it cannot post
 * in, a permission Discord named — and every one of those means the message
 * definitely did not go out. It is false only when the send itself threw, which
 * is exactly the case where the request may have reached Discord first.
 *
 * So: handled means `failed`, with the terminal reason taken from the original
 * Discord error rather than guessed. Unhandled means `unknown`.
 *
 * ## What a permission-denied send does NOT do here
 *
 * v1 escalates a permission revocation to the server owner by DM, and that
 * escalation needs a guild id. The intent row stores `targetKind`/`targetId`
 * and no guild, so a V2 send resolves one through a REST channel lookup and
 * passes it to `send` when it is there — but a gatewayless role can legitimately
 * resolve a channel with no guild attached, and then nothing is escalated and
 * the failure is captured to Sentry instead. That degradation is deliberate and
 * matches what gatewayless roles already do on the v1 path.
 *
 * What V2 keeps instead is better than the DM: the intent transitions to
 * `permission-denied` and STAYS there, so the outcome is durable, queryable and
 * attributable to the exact attempt that hit it, rather than living only in
 * whether a DM was delivered. If product wants the owner DM back on this path,
 * the route is the bot-REST channel→guild lookup above becoming mandatory — not
 * a schema change to carry a guild id on every intent row.
 */
export function classifyChannelSendFailure(
  error: ChannelSendError,
): ScoutNotificationDeliveryResult {
  if (!error.permissionError) {
    return { outcome: "unknown" };
  }
  const failure: NotificationFailure = isPermissionError(error.originalError)
    ? { classification: "terminal", reason: "permission-denied" }
    : isMissingChannelError(error.originalError)
      ? { classification: "terminal", reason: "target-not-found" }
      : // `send` raises this shape with no original error when it could not
        // resolve the channel at all, or resolved one it cannot post in. The
        // target is gone as far as this bot is concerned, and a retry sends
        // nothing anywhere.
        { classification: "terminal", reason: "target-not-found" };
  return { outcome: "failed", failure };
}

/**
 * The guild a channel belongs to, when this role can see one.
 *
 * Worth the REST call because `send` uses it to escalate a permission
 * revocation to the server owner. It does NOT shape the message: the
 * per-guild flags the report generator evaluates were evaluated once, at
 * render, against every guild the match's report goes to, and the message
 * delivered here is the one the render attested. A gatewayless role can
 * legitimately resolve a channel with no guild attached, and that is not a
 * failure: the send is a REST post on the channel id and does not need one.
 */
async function resolveDeliveryGuild(
  channelId: DiscordChannelId,
): Promise<DiscordGuildId | undefined> {
  const channel = await fetchChannelForDelivery(channelId);
  if (channel === null) return undefined;
  const guildId: unknown = "guildId" in channel ? channel.guildId : undefined;
  const parsed = DiscordGuildIdSchema.safeParse(guildId);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Send to a channel under the attempt's own nonce.
 *
 * Discord deduplicates a create carrying a nonce it has already seen when
 * `enforceNonce` is set, which closes the window between a send that succeeded
 * and a response that was lost — for THIS attempt. It is derived from the
 * attempt nonce rather than from the intent key so two attempts stay distinct:
 * the nonce that makes a repeat safe is the same nonce the durable record names
 * the attempt by, and collapsing them would make a deliberate second attempt
 * silently no-op against the first. The hash is v1's, because Discord caps the
 * field at 25 characters and the Workflow's nonce is longer than that.
 */
async function sendToChannel(args: {
  message: MessageCreateOptions;
  channelId: DiscordChannelId;
  attemptNonce: string;
  guildId: DiscordGuildId | undefined;
}): Promise<ScoutNotificationDeliveryResult> {
  const { message, channelId, attemptNonce, guildId } = args;
  const options = {
    ...message,
    nonce: deliveryAttemptNonce(attemptNonce),
    enforceNonce: true,
  };
  const target = DiscordChannelIdSchema.parse(channelId);
  try {
    const sent = await send(options, target, guildId);
    return {
      outcome: "delivered",
      messageId: DiscordMessageIdSchema.parse(sent.id),
    };
  } catch (error) {
    if (!(error instanceof ChannelSendError)) {
      // Nothing else `send` raises is classifiable, and an unclassified
      // failure around a request that may have left is the definition of
      // ambiguous.
      return { outcome: "unknown" };
    }
    if (options.reply !== undefined && isReplyPermissionError(error)) {
      // v1's fallback for a settlement recap: a reply the bot may not make
      // (no Read Message History, or Discord refused the reference) becomes
      // one plain send. Safe to attempt because `isReplyPermissionError`
      // names only failures `send` HANDLED — the reply never left — so the
      // nonce is still unspent and a second request is a first send.
      return await sendWithoutReply(options, target, guildId);
    }
    return classifyChannelSendFailure(error);
  }
}

async function sendWithoutReply(
  options: MessageCreateOptions,
  channelId: DiscordChannelId,
  guildId: DiscordGuildId | undefined,
): Promise<ScoutNotificationDeliveryResult> {
  const { reply: _reply, ...plain } = options;
  try {
    const sent = await send(plain, channelId, guildId);
    return {
      outcome: "delivered",
      messageId: DiscordMessageIdSchema.parse(sent.id),
    };
  } catch (error) {
    return error instanceof ChannelSendError
      ? classifyChannelSendFailure(error)
      : { outcome: "unknown" };
  }
}

/**
 * Send to one account's DMs, through the single audited chokepoint.
 *
 * `sendDM` is the only path allowed to message a user — it owns the DmAuditLog
 * row and the non-core message budget — so this routes through it rather than
 * opening a second send path. It does not return a message id. The callback
 * marks when a request may have left, so a failure before that point retries
 * and a failure afterward stays unknown for operator resolution.
 *
 * A DM cannot carry the report image. `sendDM` sends content and embeds, not
 * files, and a match report IS its attachment — so an intent that would deliver
 * one to a DM is a producer contract that does not exist yet. That check lives
 * in the PRE-SEND phase (see {@link prepareNotificationSend}) rather than here,
 * because it is decided before any request leaves and must never be mistaken
 * for an ambiguous send.
 */
async function sendToAccount(
  message: MessageCreateOptions,
  accountId: DiscordAccountId,
  kind: NotificationIntentKind,
  guildId: DiscordGuildId | undefined,
): Promise<ScoutNotificationDeliveryResult> {
  let sendAttempted = false;
  try {
    const status = await sendDM({
      client,
      userId: accountId,
      message: message.content ?? "",
      kind: kind === "dare-status" ? "dare_notification" : "match_notification",
      ...(guildId === undefined ? {} : { guildId }),
      suppressMentions: kind === "dare-status",
      prisma,
      onSendAttempt: () => {
        sendAttempted = true;
      },
    });
    return classifyDmSendStatus(status, sendAttempted);
  } catch (error) {
    logger.error(`Audited DM delivery to ${accountId} failed`, error);
    return classifyDmSendStatus("failed", sendAttempted);
  }
}

/** A caught error is ambiguous only after the Discord request may have left. */
export function classifyDmSendStatus(
  status: DmStatus,
  sendAttempted: boolean,
): ScoutNotificationDeliveryResult {
  switch (status) {
    case "sent":
      return { outcome: "delivered" };
    case "dm_disabled":
      return {
        outcome: "failed",
        failure: { classification: "terminal", reason: "dm-disabled" },
      };
    case "budget_exhausted":
      return {
        outcome: "failed",
        failure: { classification: "terminal", reason: "budget-exhausted" },
      };
    case "deferred":
      return {
        outcome: "failed",
        failure: { classification: "retryable", reason: "service-unavailable" },
      };
    case "failed":
      return sendAttempted
        ? { outcome: "unknown" }
        : {
            outcome: "failed",
            failure: {
              classification: "retryable",
              reason: "service-unavailable",
            },
          };
  }
}

async function deliverToTarget(args: {
  message: MessageCreateOptions;
  target: NotificationTarget;
  attemptNonce: string;
  guildId: DiscordGuildId | undefined;
  kind: NotificationIntentKind;
}): Promise<ScoutNotificationDeliveryResult> {
  switch (args.target.kind) {
    case "channel":
      return await sendToChannel({
        message: args.message,
        channelId: args.target.channelId,
        attemptNonce: args.attemptNonce,
        guildId: args.guildId,
      });
    case "dm":
      return await sendToAccount(
        args.message,
        args.target.accountId,
        args.kind,
        args.guildId,
      );
  }
}

/**
 * Everything that happens BEFORE a request could have left, and its failures.
 *
 * This is the ambiguity boundary, drawn explicitly because getting it wrong is
 * expensive in both directions. Resolving the intent, looking up the guild,
 * reading the attested artifact back, rebuilding the message around it and
 * checking that the target can carry it are all decided before Discord is
 * contacted: if any of them fails, the message DEFINITELY did not go out.
 * Treating that as ambiguous would park a notification behind an operator
 * resolution it does not need, and the user simply never hears about their
 * game.
 *
 * So every failure on this side of the line comes back as a `failed` result
 * rather than a throw, and the classification says what the caller should do.
 * Transient causes — the database or the object store timing out — are
 * `retryable`, which returns the intent to `ready` and lets the Workflow's send
 * loop try again. Three causes are `terminal`. The DM attachment case: no
 * retry teaches `sendDM` to carry files, and the honest reading of the
 * domain's vocabulary is that this target cannot receive this notification.
 * An artifact whose receipt stands but whose bytes are gone or differ from
 * the attested digest: a fact about storage, reported as
 * `content-unavailable`, because sending anything else would attest bytes
 * nobody rendered and retrying reads the same broken object again. And a
 * receipt that attests something its kind cannot deliver — a post-match
 * receipt attesting no image: persisted data violating the render/send
 * contract, also `content-unavailable`, because the same row parses the same
 * way on every read and a retry would re-drive the corrupt receipt forever
 * instead of surfacing it.
 *
 * The other side of the line is {@link deliverToTarget}, where `send` and
 * `sendDM` live. Only failures from there can be `unknown`.
 */
type PreparedSend =
  | {
      readonly phase: "ready";
      readonly message: MessageCreateOptions;
      readonly target: NotificationTarget;
      readonly guildId: DiscordGuildId | undefined;
      readonly kind: NotificationIntentKind;
    }
  | { readonly phase: "failed"; readonly failure: NotificationFailure }
  | {
      readonly phase: "suppressed";
      readonly reason: NotificationUnsentSuppressionReason;
    };

const PRE_SEND_UNAVAILABLE: NotificationFailure = {
  classification: "retryable",
  reason: "service-unavailable",
};

const CONTENT_UNAVAILABLE: NotificationFailure = {
  classification: "terminal",
  reason: "content-unavailable",
};

async function hallPreSendSuppression(
  record: MatchNotificationIntentRecord,
  guildId: DiscordGuildId | undefined,
): Promise<NotificationUnsentSuppressionReason | undefined> {
  if (record.intent.kind !== "hall-record-break") return undefined;
  const reason = await hallRecordBreakSuppression(record);
  if (reason !== undefined) return reason;
  assertHallRecordBreakTargetGuild(record, guildId);
  const currentGuildId = DiscordGuildIdSchema.parse(guildId);
  // The guild can be reinstalled after beginSend checked its audience. This
  // is the last read before Discord receives the old installation's message.
  const retired = await hallInstallationRetirementOf(prisma, record);
  if (retired !== undefined) return retired;
  // GuildInstall is written by the gateway on a best-effort path. Its prior
  // generation can survive a failed reinstall write, so ask Discord for the
  // bot's CURRENT membership without the ordinary member cache. Its joined_at
  // is independent of that row and advances across removal and reinstallation.
  // A missing timestamp or failed read cannot establish that this is still the
  // installation which minted the intent: the pre-send catch retries it.
  const member = await freshBotMember(currentGuildId);
  if (member === null) return "guild-left";
  if (member.joined_at === null || member.joined_at === undefined) {
    throw new Error(
      `Discord did not report Scout's join time in guild ${currentGuildId}`,
    );
  }
  return Date.parse(member.joined_at) > Date.parse(record.intent.createdAt)
    ? "guild-left"
    : undefined;
}

function notificationSubjectId(record: NotificationIntentRecord): string {
  return "matchId" in record
    ? record.matchId
    : "duelId" in record
      ? record.duelId
      : record.dareId.toString();
}

function unsupportedDmAnnouncement(record: NotificationIntentRecord): boolean {
  return (
    record.intent.target.kind === "dm" &&
    ANNOUNCEMENT_INTENT_KINDS.has(record.intent.kind) &&
    record.intent.kind !== "dare-status"
  );
}

async function deliveryGuildOf(
  record: NotificationIntentRecord,
): Promise<DiscordGuildId | undefined> {
  const target = record.intent.target;
  if (target.kind === "channel")
    return await resolveDeliveryGuild(target.channelId);
  return "dareId" in record
    ? dareStatusAnnouncementOf(record).guildId
    : undefined;
}

async function preSendSuppressionOf(
  record: NotificationIntentRecord,
  guildId: DiscordGuildId | undefined,
): Promise<NotificationUnsentSuppressionReason | undefined> {
  return "matchId" in record
    ? await hallPreSendSuppression(record, guildId)
    : "duelId" in record
      ? await duelStatusSuppression(record)
      : await dareStatusSuppression(record);
}

async function prepareNotificationSend(
  input: ScoutIntentAttemptRef,
  abortSignal: AbortSignal,
): Promise<PreparedSend> {
  const record = await requireIntentRecord(input.intentKey);
  const subjectId = notificationSubjectId(record);
  const target = record.intent.target;
  // The send boundary's own reading of the policy. `beginNotificationSend`
  // already refused a held intent before minting this attempt, so reaching
  // here held is a broken contract rather than a decision to make — but
  // "no-external permits no external sends" is a property of the SEND, and
  // it holds here without relying on the caller having asked.
  const gate = await resolveNotificationGate(record);
  if (gate.decision === "held") {
    throw new Error(
      `Intent ${input.intentKey} reached the send while held by policy ${gate.policy} for a ${gate.target} target; nothing was sent`,
    );
  }
  if (unsupportedDmAnnouncement(record)) {
    // A settlement recap or a Dare result is a channel announcement: v1 has no
    // DM shape for either — its private settlement receipts are a separate,
    // budgeted fan-out this kind does not port — so a DM target is a producer
    // contract that does not exist. Terminal, decided pre-send.
    logger.error(
      `Intent ${input.intentKey} is a ${record.intent.kind} intent targeting a DM, which that kind cannot deliver`,
    );
    return {
      phase: "failed",
      failure: { classification: "terminal", reason: "target-not-found" },
    };
  }
  let guildId: DiscordGuildId | undefined;
  let message: MessageCreateOptions;
  try {
    guildId = await deliveryGuildOf(record);
    message = await buildAttestedMessage(record, abortSignal, guildId);
    const reason = await preSendSuppressionOf(record, guildId);
    if (reason !== undefined) return { phase: "suppressed", reason };
  } catch (error) {
    if (error instanceof ArchivedObjectUnusableError) {
      logger.error(
        `The attested artifact for ${subjectId} cannot be delivered (${error.reason}); the receipt stands but its bytes do not`,
        error,
      );
      return { phase: "failed", failure: CONTENT_UNAVAILABLE };
    }
    if (error instanceof UndeliverableContentError) {
      // Loud and terminal: a receipt attesting a shape this kind cannot
      // deliver, a receipt contradicting itself about one object, or an
      // announcement payload that cannot produce a message. Every one is a
      // producer's contract to fix, and no retry reads the row differently.
      logger.error(
        `The evidence for ${subjectId} cannot be delivered from (${error.name}); the intent is parked rather than re-driven`,
        error,
      );
      return { phase: "failed", failure: CONTENT_UNAVAILABLE };
    }
    throw error;
  }
  if (target.kind === "dm" && (message.files ?? []).length > 0) {
    logger.error(
      `The notification for ${subjectId} carries a file attachment, which sendDM cannot deliver; no producer mints DM intents for attachment-bearing reports`,
    );
    return {
      phase: "failed",
      failure: { classification: "terminal", reason: "target-not-found" },
    };
  }
  return { phase: "ready", message, target, guildId, kind: record.intent.kind };
}

/**
 * Deliver one notification attempt, and say which side of the send it failed on.
 *
 * The two phases are separated so the Workflow never has to guess. Anything
 * this RETURNS is a decided outcome, and `unknown` appears only when the
 * request may genuinely have reached Discord. A THROW out of here is the
 * remaining ambiguity — a worker that died or a timeout that fired somewhere
 * inside the Activity — and the Workflow treats that, and only that, as an
 * unobserved send.
 */
export async function deliverNotification(
  input: ScoutIntentAttemptRef,
): Promise<ScoutNotificationDeliveryResult> {
  let prepared: PreparedSend;
  try {
    prepared = await withPreSendBudget(
      input.intentKey,
      async (abortSignal) => await prepareNotificationSend(input, abortSignal),
    );
  } catch (error) {
    if (error instanceof PreSendBudgetExpiredError) {
      // The one failure this Activity raises about ITSELF, and the reason the
      // budget exists: reported as a definite non-send rather than left to a
      // server-side timeout that the Workflow could only read as ambiguous.
      logger.error(error.message);
      return ScoutNotificationDeliveryResultSchema.parse({
        outcome: "failed",
        failure: PRE_SEND_UNAVAILABLE,
      });
    }
    // Nothing above has contacted Discord, so a failure here is definite
    // whatever it was. Reporting it as `failed` keeps the intent retryable
    // instead of stranding it in the operator dead end that exists for sends
    // nobody observed.
    logger.error(
      `Preparing the notification for ${input.intentKey} failed before any send`,
      error,
    );
    return ScoutNotificationDeliveryResultSchema.parse({
      outcome: "failed",
      failure: PRE_SEND_UNAVAILABLE,
    });
  }
  if (prepared.phase === "failed") {
    return ScoutNotificationDeliveryResultSchema.parse({
      outcome: "failed",
      failure: prepared.failure,
    });
  }
  if (prepared.phase === "suppressed") {
    return ScoutNotificationDeliveryResultSchema.parse({
      outcome: "suppressed",
      reason: prepared.reason,
    });
  }

  // The send, and nothing after it. A best-effort follow-up that ran here
  // would hold the Activity open past the outcome it has already established:
  // a Dare callout refresh waiting behind its serialized queue can outlive the
  // heartbeat timeout, and the timeout fires OUTSIDE any try/catch — so a
  // message Discord accepted would reach the Workflow as an ambiguous send.
  // `afterNotificationDelivered` runs it in its own Activity, after this
  // outcome is durably recorded.
  return ScoutNotificationDeliveryResultSchema.parse(
    await deliverToTarget({
      message: prepared.message,
      target: prepared.target,
      attemptNonce: input.attemptNonce,
      guildId: prepared.guildId,
      kind: prepared.kind,
    }),
  );
}
