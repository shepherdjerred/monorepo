/**
 * The two discovery tools: which servers can this person create in, and which
 * channels can Scout post to there.
 *
 * Both read the memoized Tier-2 resolution, so the first of them to run pays
 * for the OAuth round trip and the rest of the turn does not.
 */

import {
  P,
  type CreationIntentKind,
  type DiscordGuildId,
  type Permission,
} from "@scout-for-lol/data";
import type { CreationGuildAccess } from "#src/explore/creation/capability.ts";
import {
  lookupPostableChannels,
  type CreationToolContext,
} from "#src/explore/creation/context.ts";
import {
  previewCompetitionLimit,
  previewReportLimit,
  previewSubscriptionLimit,
  type CreationLimitPreview,
} from "#src/explore/creation/limits.ts";
import {
  CreationChannelsResultSchema,
  CreationTargetsResultSchema,
  CREATION_MAX_CHANNELS,
  CREATION_MAX_TARGETS,
  type CreationChannelsResult,
  type CreationTargetsResult,
} from "#src/explore/creation/schemas.ts";

/** The permission each kind needs, matching the confirm procedure's table. */
const CREATE_PERMISSION: Record<CreationIntentKind, Permission> = {
  report: P("reports", "create"),
  subscription: P("subscriptions", "create"),
  competition: P("competitions", "create"),
};

const DENIED: CreationLimitPreview = { atLimit: false, limitMessage: null };

function permitted(
  guild: CreationGuildAccess,
  kind: CreationIntentKind,
): boolean {
  return guild.permissions.canAny(CREATE_PERMISSION[kind]);
}

/**
 * A limit is only worth reading for an entity the asker may create at all —
 * three count queries per guild is not free, and a denied entity's headroom
 * changes nothing the model would do.
 */
async function limitFor(
  context: CreationToolContext,
  guild: CreationGuildAccess,
  kind: CreationIntentKind,
): Promise<CreationLimitPreview> {
  if (!permitted(guild, kind)) return DENIED;
  if (kind === "report") {
    return await previewReportLimit(context.db, {
      guildId: guild.guildId,
      ownerId: context.requesterId,
    });
  }
  if (kind === "subscription") {
    return await previewSubscriptionLimit(context.db, {
      guildId: guild.guildId,
    });
  }
  return await previewCompetitionLimit(context.db, {
    guildId: guild.guildId,
    ownerId: context.requesterId,
  });
}

type BoundedChannels =
  | { kind: "ok"; channels: { id: string; name: string }[] }
  | { kind: "unavailable"; message: string };

async function boundedChannels(
  context: CreationToolContext,
  guildId: DiscordGuildId,
): Promise<BoundedChannels> {
  const lookup = await lookupPostableChannels(context, guildId);
  if (lookup.kind === "unavailable") return lookup;
  return {
    kind: "ok",
    channels: lookup.channels
      .slice(0, CREATION_MAX_CHANNELS)
      .map((channel) => ({ id: channel.id, name: channel.name })),
  };
}

type DescribedTarget = {
  target: unknown;
  /** The inline channel read failed; the target itself is still valid. */
  channelsUnavailable: boolean;
};

async function describeTarget(
  context: CreationToolContext,
  guild: CreationGuildAccess,
  inlineChannels: boolean,
): Promise<DescribedTarget> {
  const [report, subscription, competition] = await Promise.all([
    limitFor(context, guild, "report"),
    limitFor(context, guild, "subscription"),
    limitFor(context, guild, "competition"),
  ]);
  const channels = inlineChannels
    ? await boundedChannels(context, guild.guildId)
    : null;
  return {
    channelsUnavailable: channels?.kind === "unavailable",
    target: {
      guildId: guild.guildId,
      name: guild.name,
      report: { permitted: permitted(guild, "report"), ...report },
      subscription: {
        permitted: permitted(guild, "subscription"),
        ...subscription,
      },
      competition: {
        permitted: permitted(guild, "competition"),
        ...competition,
      },
      channels: channels?.kind === "ok" ? channels.channels : null,
    },
  };
}

export async function listCreationTargets(
  context: CreationToolContext,
): Promise<CreationTargetsResult> {
  const access = await context.access();
  if (access.kind === "verification_unavailable") {
    return CreationTargetsResultSchema.parse({
      kind: "verification_unavailable",
      message: access.message,
      targets: [],
    });
  }
  const eligible = access.guilds.slice(0, CREATION_MAX_TARGETS);
  // One eligible server is the common case, and inlining its channels saves a
  // whole agent step — the binding budget is EXPLORE_MAX_STEPS (12), not the
  // tool-call ceiling.
  const inlineChannels = eligible.length === 1;
  const described = await Promise.all(
    eligible.map((guild) => describeTarget(context, guild, inlineChannels)),
  );
  // The targets themselves resolved; only the channel *inlining* — an
  // optimization — failed. Refusing the whole tool here would turn a question
  // Scout can answer into an outage, so the list is returned with channels
  // omitted and the message stops promising them. `list_guild_channels` is the
  // tool that will report the outage as a typed refusal.
  const channelsUnavailable = described.some(
    (entry) => entry.channelsUnavailable,
  );
  return CreationTargetsResultSchema.parse({
    kind: "targets",
    message: targetsMessage(
      eligible.length,
      access.guilds.length,
      channelsUnavailable,
    ),
    targets: described.map((entry) => entry.target),
  });
}

function targetsMessage(
  shown: number,
  total: number,
  channelsUnavailable: boolean,
): string {
  if (total === 0) {
    return "This user cannot create anything from Explore right now: no server they belong to has it enabled, or they lack the permission there. Say so plainly and do not prepare anything.";
  }
  if (total === 1) {
    return channelsUnavailable
      ? "One eligible server. Scout could not reach Discord to list its channels just now, so they are not included — call list_guild_channels before preparing anything, and do not tell the user Scout lacks permission."
      : "One eligible server, with its postable channels included. Confirm every required field with the user before preparing anything.";
  }
  const suffix =
    shown < total
      ? ` Only the first ${shown.toString()} of ${total.toString()} are listed.`
      : "";
  return `${total.toString()} eligible servers. Ask the user which one they mean before preparing anything.${suffix}`;
}

export async function listGuildChannels(
  context: CreationToolContext,
  guildId: DiscordGuildId,
): Promise<CreationChannelsResult> {
  const access = await context.access();
  if (access.kind === "verification_unavailable") {
    return CreationChannelsResultSchema.parse({
      kind: "verification_unavailable",
      message: access.message,
      channels: [],
    });
  }
  const guild = access.guilds.find((entry) => entry.guildId === guildId);
  if (guild === undefined) {
    return CreationChannelsResultSchema.parse({
      kind: "forbidden_target",
      message:
        "That server is not one this user can create things in. Call list_creation_targets first.",
      channels: [],
    });
  }
  const bounded = await boundedChannels(context, guildId);
  // An unreachable Discord is NOT an empty channel list: the empty case tells
  // the user to grant Scout permissions, which is a flatly wrong instruction
  // when the truth is that Scout could not ask.
  if (bounded.kind === "unavailable") {
    return CreationChannelsResultSchema.parse({
      kind: "verification_unavailable",
      message: bounded.message,
      channels: [],
    });
  }
  const channels = bounded.channels;
  return CreationChannelsResultSchema.parse({
    kind: "channels",
    message:
      channels.length === 0
        ? "Scout cannot post in any channel of that server. Tell the user Scout needs View Channel and Send Messages somewhere before anything can be created."
        : `${channels.length.toString()} channels Scout can post in, sorted by name.`,
    channels,
  });
}
