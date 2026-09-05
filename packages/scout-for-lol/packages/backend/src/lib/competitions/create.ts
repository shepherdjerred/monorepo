/**
 * The competition create pipeline, extracted from `competition.router.ts` so
 * that every surface that may create a competition runs the same policy.
 *
 * The function takes the caller's {@link PermissionSet} rather than a boolean
 * or a pre-computed decision. Creating a competition is gated on three
 * separate authorization facts beyond `competitions:create` — the
 * `competitions:invite` requirement for server-wide or pre-seeded rosters, the
 * `competitions:schedule` requirement for a customised leaderboard cadence,
 * and root's bypass of the per-hour rate limit — and they belong in one
 * reviewed place that every caller shares rather than being restated per
 * surface.
 *
 * Nothing here throws `TRPCError`: policy rejections come back as a
 * discriminated result so a non-tRPC caller (the confirm path for a prepared
 * create intent) can map them onto its own transport. The router maps the same
 * results back onto the errors it has always thrown.
 *
 * Two failures deliberately stay exceptions rather than results, because the
 * caller's transaction must roll back rather than commit a partial
 * competition:
 *
 *   - a malformed `dates` payload throws the `CompetitionDatesSchema` ZodError
 *     before anything is written, exactly as the router did inline;
 *   - `InitialEntrantsValidationError` is raised by `enrollInitialPlayers`
 *     *after* the competition row is inserted, so swallowing it into a result
 *     would leave that row behind.
 */

import type {
  CompetitionWithCriteria,
  CompetitionWrite,
  DiscordAccountId,
  DiscordGuildId,
  PermissionSet,
} from "@scout-for-lol/data";
import {
  DEFAULT_COMPETITION_CRON,
  DEFAULT_SCHEDULE_TIMEZONE,
} from "@scout-for-lol/data/model/competitions/competition-cron.ts";
import type { Db } from "#src/database/index.ts";
import { CompetitionDatesSchema } from "#src/database/competition/competition-dates.ts";
import { validateCompetitionConfiguration } from "#src/database/competition/configuration-validation.ts";
import {
  bulkEnrollTrackedPlayers,
  enrollInitialPlayers,
} from "#src/database/competition/participants.ts";
import { createCompetition } from "#src/database/competition/queries.ts";
import {
  checkRateLimit,
  getTimeRemaining,
  recordCreation,
} from "#src/database/competition/rate-limit.ts";
import {
  validateOwnerLimit,
  validateServerLimit,
} from "#src/database/competition/validation.ts";

export type CreateCompetitionFailure =
  /** The criteria/game-variant combination is not a valid competition. */
  | { kind: "invalid_configuration"; message: string }
  /** The in-memory per-(guild, owner) creation rate limit rejected this. */
  | { kind: "rate_limited"; message: string }
  /** The server or owner already holds its maximum of active competitions. */
  | { kind: "limit_reached"; message: string }
  /** `competitions:invite` or `competitions:schedule` is missing. */
  | { kind: "missing_permission"; message: string };

export type CreateCompetitionResult =
  /** The competition and its participants are staged in the caller's `db`. */
  | { kind: "created"; competition: CompetitionWithCriteria }
  | CreateCompetitionFailure;

export type CreateCompetitionParams = {
  /** Transaction client; creation and enrollment must commit together. */
  db: Db;
  /** The acting caller's effective permissions in `guildId`. */
  permissions: PermissionSet;
  guildId: DiscordGuildId;
  ownerId: DiscordAccountId;
  input: CompetitionWrite;
};

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Persistent active-competition limits (per server + per owner). The in-memory
 * rate limiter matches the Discord delegated-grant flow; Discord roots bypass
 * it in both surfaces.
 */
async function checkActiveCompetitionLimits(params: {
  db: Db;
  guildId: DiscordGuildId;
  ownerId: DiscordAccountId;
}): Promise<CreateCompetitionFailure | null> {
  try {
    await validateServerLimit(params.db, params.guildId, params.ownerId);
    await validateOwnerLimit(params.db, params.guildId, params.ownerId);
  } catch (error) {
    return { kind: "limit_reached", message: failureMessage(error) };
  }
  return null;
}

function checkCreationRateLimit(params: {
  permissions: PermissionSet;
  guildId: DiscordGuildId;
  ownerId: DiscordAccountId;
}): CreateCompetitionFailure | null {
  const { permissions, guildId, ownerId } = params;
  if (permissions.isRoot || checkRateLimit(guildId, ownerId)) {
    return null;
  }
  const remainingMinutes = Math.ceil(
    getTimeRemaining(guildId, ownerId) / (60 * 1000),
  );
  return {
    kind: "rate_limited",
    message: `Rate limited: You can create 1 competition per hour. Try again in ${remainingMinutes.toString()} minute${remainingMinutes === 1 ? "" : "s"}.`,
  };
}

/**
 * SERVER_WIDE bulk-enrolls every tracked player, which is participant
 * management — gate it on competitions:invite (the permission the invite /
 * add-all-members procedures already require) rather than letting the create
 * permission alone bypass it. Checked before insertion so a denied request
 * never leaves a competition behind.
 */
function checkEntrantPermission(params: {
  permissions: PermissionSet;
  input: CompetitionWrite;
}): CreateCompetitionFailure | null {
  const { permissions, input } = params;
  const enrollsSomeone =
    input.visibility === "SERVER_WIDE" || input.initialPlayerIds.length > 0;
  if (!enrollsSomeone || permissions.can("competitions", "invite")) {
    return null;
  }
  return {
    kind: "missing_permission",
    message:
      input.visibility === "SERVER_WIDE"
        ? "Server-wide competitions require the invite permission."
        : "Choosing initial entrants requires the invite permission.",
  };
}

function checkSchedulePermission(params: {
  permissions: PermissionSet;
  input: CompetitionWrite;
}): CreateCompetitionFailure | null {
  const { permissions, input } = params;
  const customizesSchedule =
    input.scheduledUpdates.enabled ||
    input.scheduledUpdates.cronExpression !== DEFAULT_COMPETITION_CRON ||
    input.scheduledUpdates.timezone !== DEFAULT_SCHEDULE_TIMEZONE;
  if (!customizesSchedule || permissions.can("competitions", "schedule")) {
    return null;
  }
  return {
    kind: "missing_permission",
    message:
      "Configuring leaderboard updates requires the schedule permission.",
  };
}

/**
 * Authorize and stage a new competition inside `params.db`.
 *
 * @throws ZodError when `input.dates` fails `CompetitionDatesSchema`.
 * @throws InitialEntrantsValidationError when the requested initial roster is
 * invalid — raised after the competition row exists, so the caller's
 * transaction must abort.
 */
export async function createCompetitionForActor(
  params: CreateCompetitionParams,
): Promise<CreateCompetitionResult> {
  const { db, permissions, guildId, ownerId, input } = params;

  const dates = CompetitionDatesSchema.parse(input.dates);
  try {
    validateCompetitionConfiguration(input.criteria, input.gameVariant);
  } catch (error) {
    return { kind: "invalid_configuration", message: failureMessage(error) };
  }

  const rateLimited = checkCreationRateLimit({
    permissions,
    guildId,
    ownerId,
  });
  if (rateLimited !== null) return rateLimited;

  const limitReached = await checkActiveCompetitionLimits({
    db,
    guildId,
    ownerId,
  });
  if (limitReached !== null) return limitReached;

  const entrantDenial = checkEntrantPermission({ permissions, input });
  if (entrantDenial !== null) return entrantDenial;

  const scheduleDenial = checkSchedulePermission({ permissions, input });
  if (scheduleDenial !== null) return scheduleDenial;

  const competition = await createCompetition(db, {
    serverId: guildId,
    ownerId,
    channelId: input.channelId,
    title: input.title,
    description: input.description,
    gameVariant: input.gameVariant,
    visibility: input.visibility,
    maxParticipants: input.maxParticipants,
    dates,
    criteria: input.criteria,
    analysisTimezone: input.analysisTimezone,
    scheduledUpdates: input.scheduledUpdates,
  });
  if (input.visibility === "SERVER_WIDE") {
    await bulkEnrollTrackedPlayers({
      prisma: db,
      competitionId: competition.id,
      guildId,
    });
  } else {
    await enrollInitialPlayers({
      prisma: db,
      competitionId: competition.id,
      guildId,
      playerIds: input.initialPlayerIds,
      maxParticipants: input.maxParticipants,
    });
  }
  return { kind: "created", competition };
}

/**
 * Post-commit half of the in-memory creation rate limit. Kept out of
 * {@link createCompetitionForActor} because a rolled-back transaction must not
 * consume the caller's hourly allowance; root bypasses the limiter entirely,
 * so it records nothing.
 */
export function recordCompetitionCreation(params: {
  permissions: PermissionSet;
  guildId: DiscordGuildId;
  ownerId: DiscordAccountId;
}): void {
  if (params.permissions.isRoot) return;
  recordCreation(params.guildId, params.ownerId);
}
