import { P, type CreationIntentPayload } from "@scout-for-lol/data";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
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
  previewReportLimit,
} from "#src/explore/creation/limits.ts";
import {
  PrepareReportToolInputSchema,
  type CreationPrepareResult,
} from "#src/explore/creation/schemas.ts";

/**
 * Prepare a scheduled report for a human to confirm.
 *
 * The ScoutQL is compiled here rather than at confirm time so a query the
 * engine cannot read is a conversation the agent can still fix, instead of a
 * card that fails after the user has already approved it. The confirm path
 * compiles it again anyway — this is a preview, not the gate.
 */
export async function prepareReportCreation(
  context: CreationToolContext,
  raw: unknown,
): Promise<CreationPrepareResult> {
  const parsed = PrepareReportToolInputSchema.parse(raw);
  const lookup = await lookupGuildAccess(context, parsed.guildId);
  if (lookup.kind === "refused") return lookup.result;
  if (!lookup.guild.permissions.canAny(P("reports", "create"))) {
    return creationRefusal(
      "forbidden_target",
      `This user cannot create reports in ${lookup.guild.name}. Tell them they need the reports:create permission there.`,
    );
  }

  const channelRefusal = requirePostableChannel(context, {
    guildId: parsed.guildId,
    channelId: parsed.channelId,
  });
  if (channelRefusal !== null) return channelRefusal;

  try {
    compileScoutQl(parsed.queryText);
  } catch (error) {
    return creationRefusal(
      "invalid",
      `That ScoutQL does not compile: ${error instanceof Error ? error.message : String(error)}. Fix the query with validate_report_query before preparing the report again.`,
    );
  }

  const limit = await previewReportLimit(context.db, {
    guildId: parsed.guildId,
    ownerId: context.requesterId,
  });
  const atLimit = limitRefusal(limit);
  if (atLimit !== null) return atLimit;

  const payload: CreationIntentPayload = { kind: "report", ...parsed };
  return await mintCreationIntent(context, {
    payload,
    guildId: parsed.guildId,
    summary: `Report "${parsed.title}" in ${lookup.guild.name}, posting to #${postableChannelName(context, parsed.guildId, parsed.channelId)} on cron ${parsed.cronExpression} (${parsed.scheduleTimezone}), ${parsed.isEnabled ? "enabled" : "disabled"}.`,
  });
}
