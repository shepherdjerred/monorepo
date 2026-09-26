import type { MessageCreateOptions } from "discord.js";
import type { NotificationPolicySuppressionReason } from "@scout-for-lol/domain/notifications/intent.ts";
import { captureHallRecordBroken } from "#src/analytics/hall.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { fetchChannelForDelivery } from "#src/discord/utils/channel.ts";
import { hallRecordBreakIntentKey } from "#src/durable/match/delivery-intents.ts";
import { hallRecordBreakDeliveries } from "#src/metrics/progression.ts";
import { hallBreakEmbed } from "#src/progression/hall/outbox.ts";
import {
  hallRecordBreakAnnouncementCodec,
  MalformedAnnouncementIntentError,
  type HallRecordBreakAnnouncement,
} from "#src/temporal/v2/notification/announcement-codecs.ts";

/**
 * The Hall-shaped notification: what a `hall-record-break` intent delivers.
 *
 * One intent is one guild's announcement that a match broke its Hall of Fame
 * records, sent to the guild's Hall channel (the intent's target) as v1's own
 * embed. The embed is built by v1's `hallBreakEmbed` from the very array v1's
 * outbox row would have stored, so the two paths cannot word it differently:
 * the V2 arm owns the lifecycle, never the copy. Mentions are disabled exactly
 * as v1 disables them — holder aliases are user-authored text.
 *
 * Three things v1's outbox drain did inline are split out here by when they
 * may happen:
 *
 * - whether the guild still wants Hall announcements is a POLICY question,
 *   answered before any attempt ({@link hallRecordBreakSuppressionV2});
 * - an announcement whose every record id has since been retired is
 *   undeliverable CONTENT, parked terminally rather than sent empty;
 * - the analytics event and the delivery counter are FOLLOW-UP, run only after
 *   Discord accepted the send ({@link afterHallRecordBreakDeliveredV2}).
 */

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

export function buildHallRecordBreakNotificationMessageV2(
  record: MatchNotificationIntentRecord,
): MessageCreateOptions {
  const announcement = hallAnnouncementOf(record);
  const embed = hallBreakEmbed(
    JSON.stringify(announcement.records),
    record.matchId,
    announcement.guildId,
  );
  if (embed === null) {
    // v1 marks this row `suppressed`; here it is content that cannot be
    // produced, and the domain's word for that is terminal
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
 * trusted from the mint: v1's drain re-checks it for every queued row, because
 * a guild that turned Hall announcements off after the match was evaluated
 * must not be told anyway. A disabled guild is `feature-disabled`, which the
 * domain records as terminal — turning the flag back on does not resurrect an
 * announcement about an old match.
 */
export async function hallRecordBreakSuppressionV2(
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
  const channel = await fetchChannelForDelivery(target.channelId);
  if (channel !== null) {
    const guildId: unknown = "guildId" in channel ? channel.guildId : undefined;
    if (guildId !== announcement.guildId) {
      throw new MalformedAnnouncementIntentError({
        intentKey: record.intent.key,
        detail: `its target channel belongs to ${String(guildId)}, not ${announcement.guildId}`,
      });
    }
  }
  const enabled = await isPolicyEnabled("hall_of_fame_enabled", {
    server: announcement.guildId,
  });
  return enabled ? undefined : "feature-disabled";
}

/**
 * v1's post-send bookkeeping: one `hall_record_broken` analytics event with the
 * number of records the delivered embed named, and the delivery counter.
 */
export async function afterHallRecordBreakDeliveredV2(
  record: MatchNotificationIntentRecord,
): Promise<void> {
  const announcement = hallAnnouncementOf(record);
  hallRecordBreakDeliveries.inc({ status: "sent" });
  await captureHallRecordBroken({
    guildId: announcement.guildId,
    records: announcement.records.length,
  });
}
