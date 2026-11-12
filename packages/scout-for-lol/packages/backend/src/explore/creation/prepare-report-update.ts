import {
  P,
  reportUpdateFields,
  type CreationIntentPayload,
} from "@scout-for-lol/data";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/parse/compile.ts";
import {
  creationRefusal,
  lookupGuildAccess,
  mintCreationIntent,
  postableChannelName,
  requirePostableChannel,
  type CreationToolContext,
} from "#src/explore/creation/context.ts";
import {
  PrepareReportUpdateToolInputSchema,
  type CreationPrepareResult,
} from "#src/explore/creation/schemas.ts";

/**
 * Prepare an edit to an existing scheduled report for a human to confirm.
 *
 * Mirrors `prepareReportCreation`: the guild and the caller's
 * `reports:update` permission are resolved from the turn's access, the
 * report is loaded guild-scoped, a new channel must be postable, and new
 * ScoutQL is compiled here so a broken query is a conversation the agent can
 * still fix. The confirm path re-runs every check anyway — this is a
 * preview, not the gate.
 */
export async function prepareReportUpdate(
  context: CreationToolContext,
  raw: unknown,
): Promise<CreationPrepareResult> {
  const parsed = PrepareReportUpdateToolInputSchema.parse(raw);
  const lookup = await lookupGuildAccess(context, parsed.guildId);
  if (lookup.kind === "refused") return lookup.result;
  if (!lookup.guild.permissions.canAny(P("reports", "update"))) {
    return creationRefusal(
      "forbidden_target",
      `This user cannot edit reports in ${lookup.guild.name}. Tell them they need the reports:update permission there.`,
    );
  }

  const { guildId, reportId, ...input } = parsed;
  if (reportUpdateFields(input).length === 0) {
    return creationRefusal(
      "invalid",
      "That edit changes nothing. Say which field should change — title, description, channel, query, schedule, timezone or enabled — and prepare the update again.",
    );
  }

  const existing = await context.db.report.findFirst({
    where: { id: reportId, serverId: guildId },
  });
  if (existing === null) {
    return creationRefusal(
      "invalid",
      "That report was not found in this server. Use get_server_setup to list the server's reports with their ids and prepare the update for one of those.",
    );
  }
  if (existing.isSystemManaged) {
    return creationRefusal(
      "invalid",
      "That report is system-managed and cannot be edited. Tell the user it is read-only.",
    );
  }

  if (input.channelId !== undefined) {
    const channelRefusal = await requirePostableChannel(context, {
      guildId,
      channelId: input.channelId,
    });
    if (channelRefusal !== null) return channelRefusal;
  }

  if (input.queryText !== undefined) {
    try {
      compileScoutQl(input.queryText);
    } catch (error) {
      return creationRefusal(
        "invalid",
        `That ScoutQL does not compile: ${error instanceof Error ? error.message : String(error)}. Fix the query with validate_report_query before preparing the update again.`,
      );
    }
  }

  const payload: CreationIntentPayload = {
    kind: "report_update",
    guildId,
    reportId,
    ...input,
  };
  const fields = reportUpdateFields(input);
  const channelNote =
    input.channelId === undefined
      ? ""
      : `, posting to #${await postableChannelName(context, guildId, input.channelId)}`;
  return await mintCreationIntent(context, {
    payload,
    guildId,
    summary: `Update report "${input.title ?? existing.title}" in ${lookup.guild.name}: change ${fields.join(", ")}${channelNote}.`,
    message:
      "Nothing has been changed yet. Tell the user this update is waiting for their confirmation and that the card expires in ten minutes.",
  });
}
