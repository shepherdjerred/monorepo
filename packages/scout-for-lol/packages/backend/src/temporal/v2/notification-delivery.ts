import type { MessageCreateOptions } from "discord.js";
import { ApplicationFailure } from "@temporalio/common";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";
import {
  DiscordMessageIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
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
import { ChannelSendError, send } from "#src/league/discord/channel.ts";
import { deliveryAttemptNonce } from "#src/durable/match/delivery-intents.ts";
import { generateMatchReport } from "#src/league/tasks/postmatch/match-report-generator.ts";
import { resolveScoutV2MatchContext } from "#src/temporal/v2/match-context.ts";
import { requireIntentRecordV2 } from "#src/temporal/v2/notification-reads.ts";

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
 * Worth the REST call for two reasons. `send` uses it to escalate a permission
 * revocation to the server owner, and the report generator uses it to evaluate
 * the per-guild feature flags that decide what the message contains — so
 * omitting it would quietly deliver a different message than v1 does. A
 * gatewayless role can legitimately resolve a channel with no guild attached,
 * and that is not a failure: the send is a REST post on the channel id and does
 * not need one.
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
  try {
    const sent = await send(
      {
        ...message,
        nonce: deliveryAttemptNonce(attemptNonce),
        enforceNonce: true,
      },
      DiscordChannelIdSchema.parse(channelId),
      guildId,
    );
    return {
      outcome: "delivered",
      messageId: DiscordMessageIdSchema.parse(sent.id),
    };
  } catch (error) {
    if (error instanceof ChannelSendError) {
      return classifyChannelSendFailure(error);
    }
    // Nothing else `send` raises is classifiable, and an unclassified failure
    // around a request that may have left is the definition of ambiguous.
    return { outcome: "unknown" };
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
 * one to a DM is a producer contract that does not exist yet, and this fails
 * loudly rather than sending a report with its report missing.
 */
async function sendToAccount(
  message: MessageCreateOptions,
  accountId: DiscordAccountId,
  riotMatchId: RiotMatchId,
): Promise<ScoutNotificationDeliveryV2Result> {
  if ((message.files ?? []).length > 0) {
    throw ApplicationFailure.nonRetryable(
      `The notification for ${riotMatchId} carries a file attachment, which sendDM cannot deliver; no producer mints DM intents for attachment-bearing reports`,
      "MissingDomainRecord",
    );
  }
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
  riotMatchId: RiotMatchId;
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
      return await sendToAccount(
        args.message,
        args.target.accountId,
        args.riotMatchId,
      );
  }
}

export async function deliverNotificationV2(
  input: ScoutIntentAttemptRefV2,
): Promise<ScoutNotificationDeliveryV2Result> {
  const record = await requireIntentRecordV2(input.intentKey);
  const riotMatchId = record.matchId;
  const target = record.intent.target;
  // Resolved once and used twice: the report generator evaluates per-guild
  // feature flags against it, and `send` escalates a permission revocation to
  // that guild's owner. Two lookups would be two REST calls that can disagree.
  const guildId =
    target.kind === "channel"
      ? await resolveDeliveryGuild(target.channelId)
      : undefined;

  const context = await resolveScoutV2MatchContext(riotMatchId);
  const message = await generateMatchReport(
    context.matchData,
    context.trackedPlayers,
    { targetGuildIds: guildId === undefined ? [] : [guildId] },
  );
  if (message === undefined) {
    throw ApplicationFailure.nonRetryable(
      `No report could be built for ${riotMatchId} despite an intent naming it`,
      "MissingDomainRecord",
    );
  }

  return ScoutNotificationDeliveryV2ResultSchema.parse(
    await deliverToTarget({
      message,
      target,
      attemptNonce: input.attemptNonce,
      guildId,
      riotMatchId,
    }),
  );
}
