import {
  EmbedBuilder,
  escapeMarkdown,
  type MessageCreateOptions,
} from "discord.js";
import { v5 as uuidv5 } from "uuid";
import {
  COMPETITIVE_PROGRESSION_CATALOG,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { NotificationPolicySuppressionReason } from "@scout-for-lol/domain/notifications/intent.ts";
import { captureHallRecordBroken } from "#src/analytics/hall.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { hallRecordBreakIntentKey } from "#src/durable/match/delivery-intents.ts";
import { getHallOfFameUrl } from "#src/discord/commands/links.ts";
import type { HallBreakPayload } from "#src/progression/hall/break-payload.ts";
import {
  hallRecordBreakAnnouncementCodec,
  MalformedAnnouncementIntentError,
  type HallRecordBreakAnnouncement,
} from "#src/temporal/notification/announcement-codecs.ts";

/**
 * The Hall-shaped notification: what a `hall-record-break` intent delivers.
 *
 * One intent is one guild's announcement that a match broke its Hall of Fame
 * records, sent to the guild's Hall channel (the intent's target) as one
 * embed. Mentions are disabled — holder aliases are user-authored text.
 *
 * Three concerns are split out by when they may happen:
 *
 * - whether the guild still wants Hall announcements is a POLICY question,
 *   answered before any attempt ({@link hallRecordBreakSuppression});
 * - an announcement whose every record id has since been retired is
 *   undeliverable CONTENT, parked terminally rather than sent empty;
 * - the delivery counter is recorded only when the durable delivered
 *   transition applies; the analytics FOLLOW-UP uses a stable event ID so an
 *   Activity retry cannot report a second Hall event.
 */

const HALL_EMBED_TITLE = "🏛️ Guild Hall of Fame record broken!";
const HALL_EMBED_SAFE_TOTAL_LENGTH = 5800;

function queueLabel(id: string): string {
  const family = COMPETITIVE_PROGRESSION_CATALOG.hall.queueFamilies.find(
    (candidate) => candidate.id === id,
  );
  if (family === undefined) throw new Error(`Unknown Hall queue family ${id}`);
  return family.label;
}

function recordLabel(id: string): string {
  const record = COMPETITIVE_PROGRESSION_CATALOG.hall.records.find(
    (candidate) => candidate.id === id,
  );
  if (record === undefined) throw new Error(`Unknown Hall record ${id}`);
  return record.label;
}

function truncateToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return maxLength <= 3
    ? text.slice(0, Math.max(0, maxLength))
    : `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Builds the record-break embed, or `null` when every record named a Hall
 * record id since retired by a catalog rename (the codec drops those) and
 * nothing is left worth notifying about.
 */
function hallBreakEmbed(
  records: readonly HallBreakPayload[],
  matchId: string,
  guildId: string,
): EmbedBuilder | null {
  if (records.length === 0) return null;
  const description = `Match ${escapeMarkdown(matchId)} set new guild records.\n[Open the Hall of Fame](${getHallOfFameUrl(guildId)})`;
  const rawFields = records.map((record) => ({
    name: `${queueLabel(record.queueFamilyId)} · ${recordLabel(record.recordId)}`,
    prefix: `${record.value.toLocaleString("en-US")} — `,
    holders: record.holders
      .map((holder) => escapeMarkdown(holder.playerAlias))
      .join(", "),
  }));
  const fixedLength = rawFields.reduce(
    (total, field) => total + field.name.length + field.prefix.length,
    HALL_EMBED_TITLE.length + description.length,
  );
  let remainingHolderLength = Math.max(
    0,
    HALL_EMBED_SAFE_TOTAL_LENGTH - fixedLength,
  );
  const embed = new EmbedBuilder()
    .setTitle(HALL_EMBED_TITLE)
    .setDescription(description)
    .setColor(0xf5_ba_42);
  for (const [index, field] of rawFields.entries()) {
    const remainingFields = rawFields.length - index;
    const fairShare = Math.floor(remainingHolderLength / remainingFields);
    const names = truncateToLength(
      field.holders,
      Math.min(1024 - field.prefix.length, fairShare),
    );
    remainingHolderLength -= names.length;
    embed.addFields({
      name: field.name,
      value: `${field.prefix}${names}`,
      inline: false,
    });
  }
  return embed;
}

function hallAnnouncementOf(
  record: MatchNotificationIntentRecord,
): HallRecordBreakAnnouncement {
  const envelope = record.intent.announcement;
  if (envelope === undefined) {
    // Unrepresentable through the domain schema, which requires a payload on
    // every announcement kind; reaching here means a row was written around it.
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail:
        "a hall-record-break intent was minted with no announcement payload",
    });
  }
  let announcement: HallRecordBreakAnnouncement;
  try {
    announcement = hallRecordBreakAnnouncementCodec.parse(envelope);
  } catch (error) {
    // Fixed at mint and re-read identically forever: no retry parses it.
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: `its announcement does not parse (${error instanceof Error ? error.message : String(error)})`,
    });
  }
  if (announcement.riotMatchId !== record.matchId) {
    // The row's match column is what the fan-out selected this intent by; a
    // payload naming another match would announce records this match did not
    // break.
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: `its announcement names ${announcement.riotMatchId}, but the intent row belongs to ${record.matchId}`,
    });
  }
  if (
    record.intent.key !==
    hallRecordBreakIntentKey(record.matchId, announcement.guildId)
  ) {
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: "its guild or match disagrees with the Hall intent key",
    });
  }
  if (record.intent.target.kind !== "channel") {
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: "a Hall announcement must target a guild channel",
    });
  }
  return announcement;
}

/** The guild attested by a valid Hall intent's payload and durable key. */
export function hallRecordBreakGuild(
  record: MatchNotificationIntentRecord,
): DiscordGuildId {
  return hallAnnouncementOf(record).guildId;
}

export function buildHallRecordBreakNotificationMessage(
  record: MatchNotificationIntentRecord,
): MessageCreateOptions {
  const announcement = hallAnnouncementOf(record);
  const embed = hallBreakEmbed(
    announcement.records,
    record.matchId,
    announcement.guildId,
  );
  if (embed === null) {
    // Content that cannot be produced; the domain's word for that is terminal
    // `content-unavailable`. No retry un-retires a record id.
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail:
        "every record it announces references a Hall record id since retired by a catalog rename",
    });
  }
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

/**
 * Whether this intent must be suppressed before any attempt, and why.
 *
 * `hall_of_fame_enabled` is per server, and it is read at delivery rather than
 * trusted from the mint, because a guild that turned Hall announcements off
 * after the match was evaluated
 * must not be told anyway. A disabled guild is `feature-disabled`, which the
 * domain records as terminal — turning the flag back on does not resurrect an
 * announcement about an old match.
 */
export async function hallRecordBreakSuppression(
  record: MatchNotificationIntentRecord,
): Promise<NotificationPolicySuppressionReason | undefined> {
  const announcement = hallAnnouncementOf(record);
  const target = record.intent.target;
  if (target.kind !== "channel") {
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: "a Hall announcement must target a guild channel",
    });
  }
  const enabled = await isPolicyEnabled("hall_of_fame_enabled", {
    server: announcement.guildId,
  });
  return enabled ? undefined : "feature-disabled";
}

/** Refuse a Hall send unless Discord resolved the target in the payload guild. */
export function assertHallRecordBreakTargetGuild(
  record: MatchNotificationIntentRecord,
  resolvedGuildId: DiscordGuildId | undefined,
): void {
  const announcement = hallAnnouncementOf(record);
  if (resolvedGuildId !== announcement.guildId) {
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: `its target channel belongs to ${String(resolvedGuildId)}, not ${announcement.guildId}`,
    });
  }
}

/**
 * The post-send analytics event with the number of records the delivered
 * embed named. The intent key is the identity of one Hall announcement, so its
 * stable event ID survives a follow-up Activity retry.
 */
export async function afterHallRecordBreakDelivered(
  record: MatchNotificationIntentRecord,
): Promise<void> {
  const announcement = hallAnnouncementOf(record);
  await captureHallRecordBroken({
    guildId: announcement.guildId,
    records: announcement.records.length,
    eventId: uuidv5(`hall-record-break:${record.intent.key}`, uuidv5.URL),
  });
}
