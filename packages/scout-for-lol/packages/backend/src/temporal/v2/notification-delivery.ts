import type { MessageCreateOptions } from "discord.js";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";
import { DiscordMessageIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  NotificationFailure,
  NotificationTarget,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  ScoutNotificationDeliveryV2ResultSchema,
  type ScoutNotificationDeliveryV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import type { ScoutIntentAttemptRefV2 } from "@scout-for-lol/temporal/contracts-v2";
import { client } from "#src/discord/client.ts";
import { fetchChannelForDelivery } from "#src/discord/utils/channel.ts";
import { sendDM } from "#src/discord/utils/dm.ts";
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
import { ArchivedObjectUnusableError } from "#src/report-store/s3-raw-source.ts";
import { afterDareSummaryDeliveredV2 } from "#src/temporal/v2/notification/dare-summary-notification.ts";
import { MalformedRenderReceiptError } from "#src/temporal/v2/notification/notification-artifact.ts";
import { buildAttestedMessageV2 } from "#src/temporal/v2/notification/notification-message.ts";
import { resolveNotificationGateV2 } from "#src/temporal/v2/notification/notification-policy.ts";
import { requireIntentRecordV2 } from "#src/temporal/v2/notification-reads.ts";
import { ANNOUNCEMENT_INTENT_KINDS } from "@scout-for-lol/domain/notifications/intent.ts";
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
): ScoutNotificationDeliveryV2Result {
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
  channelId: string,
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
  channelId: string;
  attemptNonce: string;
  guildId: DiscordGuildId | undefined;
}): Promise<ScoutNotificationDeliveryV2Result> {
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
): Promise<ScoutNotificationDeliveryV2Result> {
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
 * opening a second send path. It never throws and never returns a message id:
 * every outcome it can report is definite, so a DM is never `unknown`.
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
): Promise<ScoutNotificationDeliveryV2Result> {
  const status = await sendDM({
    client,
    userId: accountId,
    message: message.content ?? "",
    kind: "match_notification",
  });
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
    case "failed":
      return {
        outcome: "failed",
        failure: { classification: "retryable", reason: "service-unavailable" },
      };
  }
}

async function deliverToTarget(args: {
  message: MessageCreateOptions;
  target: NotificationTarget;
  attemptNonce: string;
  guildId: DiscordGuildId | undefined;
}): Promise<ScoutNotificationDeliveryV2Result> {
  switch (args.target.kind) {
    case "channel":
      return await sendToChannel({
        message: args.message,
        channelId: args.target.channelId,
        attemptNonce: args.attemptNonce,
        guildId: args.guildId,
      });
    case "dm":
      return await sendToAccount(args.message, args.target.accountId);
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
      /**
       * Best-effort follow-up once Discord accepted the send — the Dare
       * callout refresh. Never throws and never changes the outcome.
       */
      readonly afterDelivered: (() => Promise<void>) | undefined;
    }
  | { readonly phase: "failed"; readonly failure: NotificationFailure };

const PRE_SEND_UNAVAILABLE: NotificationFailure = {
  classification: "retryable",
  reason: "service-unavailable",
};

const CONTENT_UNAVAILABLE: NotificationFailure = {
  classification: "terminal",
  reason: "content-unavailable",
};

async function prepareNotificationSend(
  input: ScoutIntentAttemptRefV2,
): Promise<PreparedSend> {
  const record = await requireIntentRecordV2(input.intentKey);
  const riotMatchId = record.matchId;
  const target = record.intent.target;
  // The send boundary's own reading of the policy. `beginNotificationSendV2`
  // already refused a held intent before minting this attempt, so reaching
  // here held is a broken contract rather than a decision to make — but
  // "no-external permits no external sends" is a property of the SEND, and
  // it holds here without relying on the caller having asked.
  const gate = await resolveNotificationGateV2(record);
  if (gate.decision === "held") {
    throw new Error(
      `Intent ${input.intentKey} reached the send while held by policy ${gate.policy} for a ${gate.target} target; nothing was sent`,
    );
  }
  if (
    target.kind === "dm" &&
    ANNOUNCEMENT_INTENT_KINDS.has(record.intent.kind)
  ) {
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
  const guildId =
    target.kind === "channel"
      ? await resolveDeliveryGuild(target.channelId)
      : undefined;

  let message: MessageCreateOptions;
  try {
    message = await buildAttestedMessageV2(record);
  } catch (error) {
    if (error instanceof ArchivedObjectUnusableError) {
      logger.error(
        `The attested artifact for ${riotMatchId} cannot be delivered (${error.reason}); the receipt stands but its bytes do not`,
        error,
      );
      return { phase: "failed", failure: CONTENT_UNAVAILABLE };
    }
    if (error instanceof MalformedRenderReceiptError) {
      // Loud and terminal. The render wrote a receipt the send cannot
      // honour; that is the producer's contract to fix, and no retry reads
      // the row differently.
      logger.error(
        `The ${error.kind} render receipt for ${riotMatchId} is malformed and the intent cannot be delivered from it`,
        error,
      );
      return { phase: "failed", failure: CONTENT_UNAVAILABLE };
    }
    throw error;
  }
  if (target.kind === "dm" && (message.files ?? []).length > 0) {
    logger.error(
      `The notification for ${riotMatchId} carries a file attachment, which sendDM cannot deliver; no producer mints DM intents for attachment-bearing reports`,
    );
    return {
      phase: "failed",
      failure: { classification: "terminal", reason: "target-not-found" },
    };
  }
  return {
    phase: "ready",
    message,
    target,
    guildId,
    afterDelivered:
      record.intent.kind === "dare-summary"
        ? async () => {
            await afterDareSummaryDeliveredV2(record);
          }
        : undefined,
  };
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
export async function deliverNotificationV2(
  input: ScoutIntentAttemptRefV2,
): Promise<ScoutNotificationDeliveryV2Result> {
  let prepared: PreparedSend;
  try {
    prepared = await prepareNotificationSend(input);
  } catch (error) {
    // Nothing above has contacted Discord, so a failure here is definite
    // whatever it was. Reporting it as `failed` keeps the intent retryable
    // instead of stranding it in the operator dead end that exists for sends
    // nobody observed.
    logger.error(
      `Preparing the notification for ${input.intentKey} failed before any send`,
      error,
    );
    return ScoutNotificationDeliveryV2ResultSchema.parse({
      outcome: "failed",
      failure: PRE_SEND_UNAVAILABLE,
    });
  }
  if (prepared.phase === "failed") {
    return ScoutNotificationDeliveryV2ResultSchema.parse({
      outcome: "failed",
      failure: prepared.failure,
    });
  }

  const delivery = ScoutNotificationDeliveryV2ResultSchema.parse(
    await deliverToTarget({
      message: prepared.message,
      target: prepared.target,
      attemptNonce: input.attemptNonce,
      guildId: prepared.guildId,
    }),
  );
  if (
    delivery.outcome === "delivered" &&
    prepared.afterDelivered !== undefined
  ) {
    // Post-send and best-effort by construction: the outcome above is already
    // decided, and a follow-up that failed must neither throw (a throw here
    // reads as an unobserved send) nor turn a delivered result into anything
    // else.
    try {
      await prepared.afterDelivered();
    } catch (error) {
      logger.error(
        `The post-delivery step for ${input.intentKey} failed after a delivered send`,
        error,
      );
    }
  }
  return delivery;
}
