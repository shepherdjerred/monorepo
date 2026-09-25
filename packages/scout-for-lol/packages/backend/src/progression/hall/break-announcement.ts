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
} from "#src/temporal/v2/notification/announcement-codecs.ts";
import { matchMayAnnounce } from "#src/temporal/v2/notification/match-intents.ts";

/**
 * How long a Hall record-break announcement stays worth sending: one day past
 * the moment it was decided. A record broken yesterday is still news; a
 * backlog drained a week later is not, and the intent machine suppresses it as
 * stale rather than posting it.
 */
export const HALL_RECORD_BREAK_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/** Which path took the announcement, counted by callers and asserted by tests. */
export type HallBreakAnnouncementPath =
  /** A silent or backfilled match: nothing is announced on either path. */
  | "silent"
  /** v1's outbox row stands (or the V2 path is off): the v1 drain owns it. */
  | "outbox"
  /** A V2 intent was minted by this evaluation. */
  | "intent-minted"
  /** A V2 intent already stands for this (match, guild): it keeps ownership. */
  | "intent-standing";

/**
 * Announce one guild's record break for one match — on exactly one path.
 *
 * Runs inside the Hall evaluation's own transaction, so the announcement and
 * the record cells it describes commit together or not at all.
 *
 * ## First path owns the identity
 *
 * An announcement is one decision per (guild, match), and during the cutover
 * two pipelines can make it: v1's `HallRecordBreakOutbox` row and the V2
 * `hall-record-break` intent. Whichever exists FIRST keeps it for good, and the
 * flag only decides where a NEW decision goes:
 *
 * - an outbox row already stands → v1's upsert, unchanged, whatever the flag
 *   says, so a row the v1 drain may already be sending is never shadowed by an
 *   intent that would send it again;
 * - an intent already stands → nothing is written, whatever the flag says, so
 *   turning the flag off mid-flight cannot resurrect the announcement on v1;
 * - neither stands → the flag decides: on mints the intent, off writes the
 *   outbox row as v1 always has.
 *
 * ## Silence
 *
 * A match the committed observation marks `silent-backfill` announces nothing
 * on either path. v1 used to queue outbox rows for those too, so backfilling a
 * player's history could post weeks-old record breaks; the gate is the same
 * `matchMayAnnounce` every V2 minter asks, and it applies to the outbox path
 * because that is the path that leaked.
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
    /** `scout_v2_progression_notifications_enabled` for this guild. */
    v2Enabled: boolean;
    now: Date;
  },
): Promise<HallBreakAnnouncementPath> {
  const riotMatchId = RiotMatchIdSchema.parse(args.matchId);
  if (!(await matchMayAnnounce(tx, riotMatchId))) return "silent";

  const outbox = await tx.hallRecordBreakOutbox.findUnique({
    where: {
      guildId_matchId: { guildId: args.guildId, matchId: args.matchId },
    },
    select: { id: true },
  });
  if (outbox !== null) {
    await upsertOutbox(tx, args);
    return "outbox";
  }

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
  if (!args.v2Enabled) {
    await upsertOutbox(tx, args);
    return "outbox";
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

async function upsertOutbox(
  tx: Db,
  args: {
    guildId: DiscordGuildId;
    matchId: string;
    channelId: string;
    records: readonly HallBreakPayload[];
  },
): Promise<void> {
  const payloadJson = JSON.stringify(args.records);
  await tx.hallRecordBreakOutbox.upsert({
    where: {
      guildId_matchId: { guildId: args.guildId, matchId: args.matchId },
    },
    create: {
      guildId: args.guildId,
      matchId: args.matchId,
      channelId: DiscordChannelIdSchema.parse(args.channelId),
      payloadJson,
    },
    update: {
      channelId: DiscordChannelIdSchema.parse(args.channelId),
      payloadJson,
    },
  });
}
