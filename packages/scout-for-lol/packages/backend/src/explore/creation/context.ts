/**
 * What every creation tool executor is handed, and the refusals they share.
 *
 * The context carries the Tier-2 permission resolution as a *function*, not a
 * value: `access()` is memoized by the tool factory, so the OAuth round trip
 * and per-guild grant reads happen at most once, inside whichever creation tool
 * the model calls first, and never at all on a turn that calls none.
 */

import type {
  DiscordAccountId,
  DiscordGuildId,
  CreationIntentPayload,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type {
  CreationAccess,
  CreationCapability,
  CreationGuildAccess,
} from "#src/explore/creation/capability.ts";
import {
  CreationPrepareResultSchema,
  CREATION_MAX_SUMMARY_LENGTH,
  type CreationPrepareResult,
} from "#src/explore/creation/schemas.ts";
import { createConfirmationIntent } from "#src/lib/confirmation-intent/create.ts";
import type { PostableChannel } from "#src/lib/discord/postable-channels.ts";
import type { resolveSubscriptionPuuid } from "#src/lib/subscription/add.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/**
 * How long a prepared creation waits for a human. Ten minutes, the same window
 * a prepared dare action gets, so Explore has one confirmation lifetime rather
 * than one per feature.
 */
export const CREATION_INTENT_TTL_MS = 10 * 60 * 1000;

export type CreationToolContext = {
  capability: CreationCapability;
  requesterId: DiscordAccountId;
  track: ToolTracker;
  db: ExtendedPrismaClient;
  /** Memoized for the turn; see the module docblock. */
  access: () => Promise<CreationAccess>;
  listChannels: (guildId: DiscordGuildId) => PostableChannel[];
  resolvePuuid: typeof resolveSubscriptionPuuid;
  now: () => Date;
  /**
   * A fresh key per call. Deriving it from the payload would make "create the
   * same weekly report again" silently return the first intent, and asking for
   * two identical entities is a legitimate request.
   */
  newIdempotencyKey: () => string;
};

/** A prepare tool's refusal: never a claim that anything was created. */
export function creationRefusal(
  kind: Exclude<
    CreationPrepareResult["kind"],
    "creation_confirmation_required"
  >,
  message: string,
): CreationPrepareResult {
  return CreationPrepareResultSchema.parse({ kind, message, intent: null });
}

type GuildAccessLookup =
  | { kind: "ok"; guild: CreationGuildAccess }
  | { kind: "refused"; result: CreationPrepareResult };

/**
 * The guild the model named, if the asker may act in it.
 *
 * An unverifiable answer and an ineligible guild are different refusals: the
 * first says Scout could not check, the second says this server is not one of
 * the asker's creation targets.
 */
export async function lookupGuildAccess(
  context: CreationToolContext,
  guildId: DiscordGuildId,
): Promise<GuildAccessLookup> {
  const access = await context.access();
  if (access.kind === "verification_unavailable") {
    return {
      kind: "refused",
      result: creationRefusal("verification_unavailable", access.message),
    };
  }
  const guild = access.guilds.find((entry) => entry.guildId === guildId);
  if (guild === undefined) {
    return {
      kind: "refused",
      result: creationRefusal(
        "forbidden_target",
        "That server is not one this user can create things in. Call list_creation_targets and ask them to choose one of the servers it returns.",
      ),
    };
  }
  return { kind: "ok", guild };
}

/** The channel must be one Scout can actually post the entity's output into. */
export function requirePostableChannel(
  context: CreationToolContext,
  input: { guildId: DiscordGuildId; channelId: string },
): CreationPrepareResult | null {
  const channels = context.listChannels(input.guildId);
  if (channels.some((channel) => channel.id === input.channelId)) return null;
  return creationRefusal(
    "invalid",
    "Scout cannot post in that channel. Call list_guild_channels and ask the user to pick one of the channels it returns.",
  );
}

/**
 * The channel's display name, for a summary a person will read.
 *
 * Every caller has already proved the channel is postable, so a miss is
 * unreachable; the id is the honest label if it ever happens.
 */
export function postableChannelName(
  context: CreationToolContext,
  guildId: DiscordGuildId,
  channelId: string,
): string {
  const channel = context
    .listChannels(guildId)
    .find((candidate) => candidate.id === channelId);
  return channel?.name ?? channelId;
}

function boundedSummary(summary: string): string {
  return summary.length <= CREATION_MAX_SUMMARY_LENGTH
    ? summary
    : `${summary.slice(0, CREATION_MAX_SUMMARY_LENGTH - 1).trimEnd()}…`;
}

/**
 * Mint the confirmation intent a human will later approve.
 *
 * The guild is taken from the payload the executor built from a verified
 * target, and `createConfirmationIntent` stores it as the row's own column —
 * the confirm procedure reads it from there and re-resolves every permission,
 * so nothing minted here is trusted as authorization.
 */
export async function mintCreationIntent(
  context: CreationToolContext,
  input: {
    payload: CreationIntentPayload;
    guildId: DiscordGuildId;
    summary: string;
  },
): Promise<CreationPrepareResult> {
  const now = context.now();
  const created = await createConfirmationIntent(context.db, {
    serverId: input.guildId,
    actorDiscordId: context.requesterId,
    payload: input.payload,
    idempotencyKey: context.newIdempotencyKey(),
    expiresAt: new Date(now.getTime() + CREATION_INTENT_TTL_MS),
  });
  if (created.kind === "idempotency_conflict") {
    // A fresh UUID per call makes this unreachable short of a collision; say so
    // rather than presenting a stranger's intent as this request's confirmation.
    return creationRefusal(
      "invalid",
      "Scout could not prepare that confirmation. Ask the user to try again.",
    );
  }
  return CreationPrepareResultSchema.parse({
    kind: "creation_confirmation_required",
    message:
      "Nothing has been created yet. Tell the user this is waiting for their confirmation and that the card expires in ten minutes.",
    intent: {
      intentId: created.intent.id,
      kind: input.payload.kind,
      guildId: input.guildId,
      expiresAt: created.intent.expiresAt.toISOString(),
      summary: boundedSummary(input.summary),
    },
  });
}
