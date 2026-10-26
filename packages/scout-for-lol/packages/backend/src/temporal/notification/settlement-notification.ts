import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { MalformedAnnouncementIntentError } from "#src/temporal/notification/announcement-codecs.ts";
import type { OpaqueVersionedEnvelope } from "@scout-for-lol/domain/codec/versioned.ts";
import type { MessageCreateOptions } from "discord.js";
export function requireAnnouncement(
  record: MatchNotificationIntentRecord,
): OpaqueVersionedEnvelope {
  if (record.intent.announcement === undefined)
    throw new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: "Announcement payload missing",
    });
  return record.intent.announcement;
}
/** A retained currency notification is terminal content, never a new send. */
export function buildSettlementNotificationMessage(
  record: MatchNotificationIntentRecord,
): Promise<MessageCreateOptions> {
  return Promise.reject(
    new MalformedAnnouncementIntentError({
      intentKey: record.intent.key,
      detail: "This notification feature has been retired",
    }),
  );
}
