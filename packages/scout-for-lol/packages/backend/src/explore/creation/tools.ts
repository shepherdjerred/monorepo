/**
 * The five Explore creation tools.
 *
 * The security model in one line: **the model never writes domain state.** A
 * prepare tool mints a confirmation intent describing a report, subscription or
 * competition; a human then confirms it through `explore.confirmCreationIntent`,
 * which re-runs the entire authorization decision from scratch. Nothing decided
 * here is trusted there.
 *
 * Everything routes through the shared `ToolTracker`, so creation calls consume
 * the same tool budget and emit the same metrics as every other Explore tool —
 * no limit is raised to make room for them.
 */

import { tool } from "ai";
import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  resolveCreationAccess,
  type CreationAccess,
  type CreationCapability,
} from "#src/explore/creation/capability.ts";
import type { CreationToolContext } from "#src/explore/creation/context.ts";
import { prepareCompetitionCreation } from "#src/explore/creation/prepare-competition.ts";
import { prepareReportCreation } from "#src/explore/creation/prepare-report.ts";
import { prepareSubscriptionCreation } from "#src/explore/creation/prepare-subscription.ts";
import {
  CreationChannelsResultSchema,
  CreationPrepareResultSchema,
  CreationTargetsResultSchema,
  ListCreationTargetsToolInputSchema,
  ListGuildChannelsToolInputSchema,
  PrepareCompetitionToolInputSchema,
  PrepareReportToolInputSchema,
  PrepareSubscriptionToolInputSchema,
} from "#src/explore/creation/schemas.ts";
import {
  listCreationTargets,
  listGuildChannels,
} from "#src/explore/creation/targets.ts";
import {
  listPostableChannels,
  type PostableChannel,
} from "#src/lib/discord/postable-channels.ts";
import { resolveSubscriptionPuuid } from "#src/lib/subscription/add.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

type CreationToolDependencies = {
  db: ExtendedPrismaClient;
  resolveAccess: (input: {
    capability: CreationCapability;
    requesterId: DiscordAccountId;
  }) => Promise<CreationAccess>;
  listChannels: (guildId: DiscordGuildId) => PostableChannel[];
  resolvePuuid: typeof resolveSubscriptionPuuid;
  now: () => Date;
  newIdempotencyKey: () => string;
};

const defaultDependencies: CreationToolDependencies = {
  db: prisma,
  resolveAccess: (input) => resolveCreationAccess(input),
  listChannels: listPostableChannels,
  resolvePuuid: resolveSubscriptionPuuid,
  now: () => new Date(),
  // Fresh per call, matching both existing dare mint sites: creating two
  // identical reports is a legitimate request, so the key must not be derived
  // from the payload.
  newIdempotencyKey: () => globalThis.crypto.randomUUID(),
};

export type CreationExploreToolsInput = {
  /** Tier 1's answer. `null` means no creation tools at all for this turn. */
  capability: CreationCapability | null;
  requesterId: DiscordAccountId;
  track: ToolTracker;
  /** Test seams; production uses the real implementations. */
  dependencies?: Partial<CreationToolDependencies> | undefined;
};

/**
 * The executors, separate from the AI-SDK `tool()` wrappers so tests can drive
 * them without constructing a `ToolExecutionOptions`.
 *
 * Tier-2 permission resolution is memoized here as a promise: the first
 * creation tool the model calls pays for the OAuth round trip and the per-guild
 * grant reads, every later one reuses them, and a turn that calls none never
 * touches Discord at all.
 */
export function createCreationToolExecutors(input: {
  capability: CreationCapability;
  requesterId: DiscordAccountId;
  track: ToolTracker;
  dependencies?: Partial<CreationToolDependencies> | undefined;
}) {
  const resolved: CreationToolDependencies = {
    ...defaultDependencies,
    ...input.dependencies,
  };
  let accessPromise: Promise<CreationAccess> | null = null;
  const context: CreationToolContext = {
    capability: input.capability,
    requesterId: input.requesterId,
    track: input.track,
    db: resolved.db,
    access: () => {
      accessPromise ??= resolved.resolveAccess({
        capability: input.capability,
        requesterId: input.requesterId,
      });
      return accessPromise;
    },
    listChannels: resolved.listChannels,
    resolvePuuid: resolved.resolvePuuid,
    now: resolved.now,
    newIdempotencyKey: resolved.newIdempotencyKey,
  };

  return {
    listTargets: () =>
      input.track("list_creation_targets", () => listCreationTargets(context)),
    listChannels: (raw: unknown) =>
      input.track("list_guild_channels", () =>
        listGuildChannels(
          context,
          ListGuildChannelsToolInputSchema.parse(raw).guildId,
        ),
      ),
    prepareReport: (raw: unknown) =>
      input.track("prepare_report_creation", () =>
        prepareReportCreation(context, raw),
      ),
    prepareSubscription: (raw: unknown) =>
      input.track("prepare_subscription_creation", () =>
        prepareSubscriptionCreation(context, raw),
      ),
    prepareCompetition: (raw: unknown) =>
      input.track("prepare_competition_creation", () =>
        prepareCompetitionCreation(context, raw),
      ),
  };
}

const PREPARE_DESCRIPTION_SUFFIX =
  "This creates nothing. It returns a confirmation the user must accept in the Explore page within ten minutes; say plainly that nothing has been created yet.";

/**
 * The tools, or nothing at all.
 *
 * Returning `{}` for a null capability is what makes Tier 1 a real gate: with
 * the flag off, or on Discord, the tools are absent from the model's schema and
 * no permission work is ever scheduled.
 */
export function createCreationExploreTools(input: CreationExploreToolsInput) {
  if (input.capability === null) return {};
  const executors = createCreationToolExecutors({
    capability: input.capability,
    requesterId: input.requesterId,
    track: input.track,
    dependencies: input.dependencies,
  });
  return {
    list_creation_targets: tool({
      description:
        "List the servers this user can create a report, tracked player or competition in, with what they are allowed to create in each and whether any limit is already reached. When exactly one server is eligible its postable channels are included. Call this before proposing any creation.",
      inputSchema: ListCreationTargetsToolInputSchema,
      outputSchema: CreationTargetsResultSchema,
      execute: () => executors.listTargets(),
    }),
    list_guild_channels: tool({
      description:
        "List the text channels Scout can post in for one server, sorted by name. Use it to let the user choose where a report, tracked player or competition posts.",
      inputSchema: ListGuildChannelsToolInputSchema,
      outputSchema: CreationChannelsResultSchema,
      execute: (raw) => executors.listChannels(raw),
    }),
    prepare_report_creation: tool({
      description: `Prepare a scheduled ScoutQL report for the user to confirm. Validate the query with validate_report_query first and confirm the title, channel, schedule and timezone with the user. ${PREPARE_DESCRIPTION_SUFFIX}`,
      inputSchema: PrepareReportToolInputSchema,
      outputSchema: CreationPrepareResultSchema,
      execute: (raw) => executors.prepareReport(raw),
    }),
    prepare_subscription_creation: tool({
      description: `Prepare a tracked player for the user to confirm. Scout resolves the Riot ID against Riot itself and freezes the account it found, so confirm the exact Riot ID, region, display name and channel with the user first. ${PREPARE_DESCRIPTION_SUFFIX}`,
      inputSchema: PrepareSubscriptionToolInputSchema,
      outputSchema: CreationPrepareResultSchema,
      execute: (raw) => executors.prepareSubscription(raw),
    }),
    prepare_competition_creation: tool({
      description: `Prepare a competition for the user to confirm. Confirm the title, description, visibility, scoring criteria, channel and the exact date window with the user first; dates are ISO-8601 timestamps and a fixed window may not exceed 90 days. ${PREPARE_DESCRIPTION_SUFFIX}`,
      inputSchema: PrepareCompetitionToolInputSchema,
      outputSchema: CreationPrepareResultSchema,
      execute: (raw) => executors.prepareCompetition(raw),
    }),
  };
}
