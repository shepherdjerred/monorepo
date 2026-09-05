import {
  P,
  WebCompetitionDatesSchema,
  type CompetitionWrite,
  type CreationIntentPayload,
  type PermissionSet,
} from "@scout-for-lol/data";
import {
  DEFAULT_COMPETITION_CRON,
  DEFAULT_SCHEDULE_TIMEZONE,
} from "@scout-for-lol/data/model/competition-cron.ts";
import { CompetitionDatesSchema } from "#src/database/competition/competition-dates.ts";
import { validateCompetitionConfiguration } from "#src/database/competition/configuration-validation.ts";
import {
  creationRefusal,
  lookupGuildAccess,
  mintCreationIntent,
  postableChannelName,
  requirePostableChannel,
  type CreationToolContext,
} from "#src/explore/creation/context.ts";
import {
  limitRefusal,
  previewCompetitionLimit,
} from "#src/explore/creation/limits.ts";
import {
  PrepareCompetitionToolInputSchema,
  type CreationPrepareResult,
} from "#src/explore/creation/schemas.ts";

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The two sub-permissions `createCompetitionForActor` enforces beyond
 * `competitions:create`, checked here in the same order and on the same
 * conditions so the agent can advise instead of minting a card that the
 * confirm path will refuse.
 */
function subPermissionRefusal(
  permissions: PermissionSet,
  input: CompetitionWrite,
): string | null {
  const enrollsSomeone =
    input.visibility === "SERVER_WIDE" || input.initialPlayerIds.length > 0;
  if (enrollsSomeone && !permissions.can("competitions", "invite")) {
    return input.visibility === "SERVER_WIDE"
      ? "A server-wide competition enrolls every tracked player, which needs the competitions:invite permission this user does not have. Offer an invite-only competition instead."
      : "Choosing initial entrants needs the competitions:invite permission this user does not have. Offer to create the competition with an empty roster.";
  }
  const customizesSchedule =
    input.scheduledUpdates.enabled ||
    input.scheduledUpdates.cronExpression !== DEFAULT_COMPETITION_CRON ||
    input.scheduledUpdates.timezone !== DEFAULT_SCHEDULE_TIMEZONE;
  if (customizesSchedule && !permissions.can("competitions", "schedule")) {
    return "Configuring leaderboard updates needs the competitions:schedule permission this user does not have. Offer to create the competition with the default schedule.";
  }
  return null;
}

/**
 * Prepare a competition for a human to confirm.
 *
 * Dates arrive as ISO strings and are run through the web schema and then
 * `CompetitionDatesSchema`, which is where ordering and the 90-day duration cap
 * live. That check throws at confirm time — after the intent has been claimed —
 * so catching it here is what keeps a bad window a conversation rather than a
 * failed confirmation.
 */
export async function prepareCompetitionCreation(
  context: CreationToolContext,
  raw: unknown,
): Promise<CreationPrepareResult> {
  const parsed = PrepareCompetitionToolInputSchema.parse(raw);
  const lookup = await lookupGuildAccess(context, parsed.guildId);
  if (lookup.kind === "refused") return lookup.result;
  if (!lookup.guild.permissions.canAny(P("competitions", "create"))) {
    return creationRefusal(
      "forbidden_target",
      `This user cannot create competitions in ${lookup.guild.name}. Tell them they need the competitions:create permission there.`,
    );
  }

  const channelRefusal = requirePostableChannel(context, {
    guildId: parsed.guildId,
    channelId: parsed.channelId,
  });
  if (channelRefusal !== null) return channelRefusal;

  const dates = WebCompetitionDatesSchema.parse(parsed.dates);
  const write: CompetitionWrite = { ...parsed, dates };
  try {
    CompetitionDatesSchema.parse(dates);
  } catch (error) {
    return creationRefusal(
      "invalid",
      `Those competition dates are not usable: ${failureMessage(error)}. Ask the user for a window that starts before it ends and runs at most 90 days.`,
    );
  }
  try {
    validateCompetitionConfiguration(write.criteria, write.gameVariant);
  } catch (error) {
    return creationRefusal(
      "invalid",
      `That criteria and game variant do not go together: ${failureMessage(error)}.`,
    );
  }

  const subPermission = subPermissionRefusal(lookup.guild.permissions, write);
  if (subPermission !== null) {
    return creationRefusal("forbidden_target", subPermission);
  }

  const limit = await previewCompetitionLimit(context.db, {
    guildId: parsed.guildId,
    ownerId: context.requesterId,
  });
  const atLimit = limitRefusal(limit);
  if (atLimit !== null) return atLimit;

  const payload: CreationIntentPayload = {
    kind: "competition",
    guildId: parsed.guildId,
    ...write,
  };
  return await mintCreationIntent(context, {
    payload,
    guildId: parsed.guildId,
    summary: `${write.visibility === "SERVER_WIDE" ? "Server-wide" : "Invite-only"} competition "${write.title}" in ${lookup.guild.name}, scored by ${write.criteria.type}, posting to #${postableChannelName(context, parsed.guildId, parsed.channelId)}, ${describeWindow(dates)}.`,
  });
}

function describeWindow(
  dates: ReturnType<typeof WebCompetitionDatesSchema.parse>,
): string {
  return dates.type === "SEASON"
    ? `following season ${dates.seasonId}`
    : `running ${dates.startDate.toISOString()} to ${dates.endDate.toISOString()}`;
}
