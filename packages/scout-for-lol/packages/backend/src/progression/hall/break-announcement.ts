import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordChannelIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";
import type { Db } from "#src/database/index.ts";
import {
  getIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { hallRecordBreakIntentKey } from "#src/durable/match/delivery-intents.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";
import type { HallBreakPayload } from "#src/progression/hall/break-payload.ts";
import {
  hallRecordBreakAnnouncementCodec,
  hallRecordBreakAnnouncementEnvelope,
} from "#src/temporal/notification/announcement-codecs.ts";
import { matchMayAnnounce } from "#src/temporal/notification/match-intents.ts";

/**
 * How long a Hall record-break announcement stays worth sending: one day past
 * the moment it was decided. A record broken yesterday is still news; a
 * backlog drained a week later is not, and the intent machine suppresses it as
 * stale rather than posting it.
 */
export const HALL_RECORD_BREAK_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/** What the evaluation did with the announcement, asserted by tests. */
export type HallBreakAnnouncementPath =
  /** A silent or backfilled match: nothing is announced. */
  | "silent"
  /** An intent was minted by this evaluation. */
  | "intent-minted"
  /** An intent already stands for this (match, guild): it keeps ownership. */
  | "intent-standing";

/**
 * Announce one guild's record break for one match as a `hall-record-break`
 * notification intent.
 *
 * Runs inside the Hall evaluation's own transaction, so the announcement and
 * the record cells it describes commit together or not at all.
 *
 * ## Silence
 *
 * The committed observation decides silence: only a match that may announce
 * mints an intent, because an intent without an observed match could never
 * enter the post-commit fan-out.
 *
 * ## The key is the decision, the row is the truth
 *
 * The intent key is (match, guild) — never the channel, which is a setting a
 * guild can change between two evaluations. A standing intent is accepted as
 * this decision only if it names this match and carries these records; a
 * differing payload under the same key is two producers disagreeing about one
 * announcement, and it throws rather than picking one.
 */
export async function announceHallRecordBreak(
  tx: Db,
  args: {
    guildId: DiscordGuildId;
    matchId: string;
    channelId: string;
    records: readonly HallBreakPayload[];
    now: Date;
  },
): Promise<HallBreakAnnouncementPath> {
  const riotMatchId = RiotMatchIdSchema.parse(args.matchId);
  if (!(await matchMayAnnounce(tx, riotMatchId))) return "silent";

  const key = NotificationIntentKeySchema.parse(
    hallRecordBreakIntentKey(riotMatchId, args.guildId),
  );
  const envelope = hallRecordBreakAnnouncementEnvelope({
    guildId: args.guildId,
    riotMatchId,
    records: args.records,
  });
  const standing = await getIntent(tx, { intentKey: key });
  if (standing !== null) {
    requireSameAnnouncement(standing, riotMatchId, envelope);
    return "intent-standing";
  }
  const minted = await upsertIntent(tx, {
    matchId: riotMatchId,
    intent: {
      key,
      kind: "hall-record-break",
      origin: { kind: "live" },
      target: {
        kind: "channel",
        channelId: DiscordChannelIdSchema.parse(args.channelId),
      },
      freshnessDeadline: toIsoInstant(
        new Date(args.now.getTime() + HALL_RECORD_BREAK_FRESHNESS_MS),
      ),
      createdAt: toIsoInstant(args.now),
      attemptCount: 0,
      announcement: envelope,
      state: { kind: "pending" },
    },
  });
  if (minted.outcome === "conflict") {
    // The read above found nothing, so another writer minted this key inside
    // the window between the read and the write. Throwing rolls the Hall
    // evaluation back with it; the retry reads the standing row.
    throw new Error(
      `Hall record-break intent ${key} was minted by another writer during this evaluation (${minted.reason})`,
    );
  }
  return "intent-minted";
}

function requireSameAnnouncement(
  standing: MatchNotificationIntentRecord,
  riotMatchId: RiotMatchId,
  envelope: ReturnType<typeof hallRecordBreakAnnouncementEnvelope>,
): void {
  const stored = standing.intent.announcement;
  const same =
    standing.matchId === riotMatchId &&
    standing.intent.kind === "hall-record-break" &&
    stored !== undefined &&
    Bun.deepEquals(
      hallRecordBreakAnnouncementCodec.parse(stored),
      hallRecordBreakAnnouncementCodec.parse(envelope),
    );
  if (same) return;
  throw new Error(
    `Hall record-break intent ${standing.intent.key} already stands with a different announcement than this evaluation produced for ${riotMatchId}; refusing to treat it as the same decision`,
  );
}
