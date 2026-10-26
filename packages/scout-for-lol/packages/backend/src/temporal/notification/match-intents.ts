import {
  getIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { getObservation } from "#src/database/durable/observation-repository.ts";
import type { Db } from "#src/database/index.ts";
import {
  deliveryIntentKey,
  postmatchDeliveryKeyPrefix,
} from "#src/durable/match/delivery-intents.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";
import { readReportScoreboard } from "#src/evidence/report-scoreboard.ts";
import { resolvePostmatchDeliveryChannels } from "#src/league/tasks/notification-filters.ts";
import { postmatchReportFreshnessDeadline } from "#src/league/tasks/postmatch/match-report-delivery.ts";
import { createLogger } from "#src/logger.ts";
import { durableCommit } from "#src/temporal/match/match-commits.ts";
import { resolveQueueTypeFromGame } from "@scout-for-lol/data";
import type { OpaqueVersionedEnvelope } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  NotificationIntentKeySchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordChannelIdSchema,
  type DiscordChannelId,
} from "@scout-for-lol/domain/identity/discord.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import type { NotificationIntentKind } from "@scout-for-lol/domain/notifications/intent.ts";
import { z } from "zod";
const logger = createLogger("scout-match-intents");
export type MatchIntentMint = "minted" | "existing" | "conflict" | "silent";

/** What one minting pass did, counted so a silent match is visible as silent. */
export type MatchIntentsSummary = {
  minted: number;
  existing: number;
  conflicts: number;
  silent: number;
  /** Announcements with nowhere to go; see {@link mintSettlementIntents}. */
  undeliverable: number;
};

function emptySummary(): MatchIntentsSummary {
  return { minted: 0, existing: 0, conflicts: 0, silent: 0, undeliverable: 0 };
}

function countMint(
  summary: MatchIntentsSummary,
  outcome: MatchIntentMint,
): void {
  if (outcome === "minted") summary.minted += 1;
  if (outcome === "existing") summary.existing += 1;
  if (outcome === "conflict") summary.conflicts += 1;
  if (outcome === "silent") summary.silent += 1;
}

/**
 * Whether this match may be announced at all.
 *
 * A match with no observation is a broken caller contract — every minting site
 * runs after the observation commit — and it throws rather than defaulting,
 * because the two possible defaults are "announce a backfill" and "silence a
 * live match" and neither is recoverable from here.
 */
export async function matchMayAnnounce(
  db: Db,
  matchId: RiotMatchId,
  kind?: NotificationIntentKind,
): Promise<boolean> {
  const observation = await getObservation(db, { matchId });
  if (observation === null) {
    if (
      kind === "postmatch" &&
      (await readReportScoreboard(matchId, db)) !== null
    ) {
      const admission = await db.matchEvidenceAdmission.findUniqueOrThrow({
        where: { riotMatchId: matchId },
      });
      return (
        z.enum(["FULL", "HISTORY_ONLY"]).parse(admission.policy) === "FULL"
      );
    }
    throw new Error(
      `Refusing to mint notification intents for ${matchId}: no observation stands for it, so whether it is owed a public delivery is unknown`,
    );
  }
  return observation.policy === "FULL" && observation.deliveryMode === "live";
}

/**
 * Refuse to treat a standing row as this run's replay unless it IS this
 * instruction.
 *
 * The key is derived from the decision, but every reader uses the row's own
 * columns: the fan-out selects by the match column and the delivery goes to
 * the target column. A row under this key naming a different match or channel
 * would be accepted as "already minted" and then never found for this one, so
 * the audience would silently never hear. State progression is deliberately
 * not checked — a row already `ready` or `delivered` is this instruction
 * further along.
 */
function requireIntentMatches(
  standing: MatchNotificationIntentRecord,
  matchId: RiotMatchId,
  channelId: DiscordChannelId,
): void {
  const target = standing.intent.target;
  const sameTarget =
    target.kind === "channel" && target.channelId === channelId;
  if (sameTarget && standing.matchId === matchId) return;
  throw new Error(
    `Intent ${standing.intent.key} stands for ${standing.matchId} → ${target.kind === "channel" ? target.channelId : target.kind}, not for ${matchId} → ${channelId}; refusing to treat it as this match's instruction`,
  );
}

/**
 * Mint one channel intent, at most once, if the match may announce at all.
 *
 * The silence check is per call rather than hoisted, so no minting site can
 * add a row by forgetting to ask. It is one indexed point read against a row
 * the caller has already touched.
 */
async function mintMatchIntent(
  db: Db,
  args: {
    matchId: RiotMatchId;
    key: string;
    kind: NotificationIntentKind;
    channelId: DiscordChannelId;
    createdAt: Date;
    freshnessDeadline: Date;
    announcement?: OpaqueVersionedEnvelope | undefined;
  },
): Promise<MatchIntentMint> {
  if (!(await matchMayAnnounce(db, args.matchId, args.kind))) return "silent";
  const key = NotificationIntentKeySchema.parse(args.key);
  const standing = await getIntent(db, { intentKey: key });
  if (standing !== null) {
    requireIntentMatches(standing, args.matchId, args.channelId);
    return "existing";
  }

  const commit = durableCommit(
    await upsertIntent(db, {
      matchId: args.matchId,
      intent: {
        key,
        kind: args.kind,
        origin: { kind: "live" },
        target: {
          kind: "channel",
          channelId: DiscordChannelIdSchema.parse(args.channelId),
        },
        freshnessDeadline: toIsoInstant(args.freshnessDeadline),
        createdAt: toIsoInstant(args.createdAt),
        attemptCount: 0,
        ...(args.announcement === undefined
          ? {}
          : { announcement: args.announcement }),
        state: { kind: "pending" },
      },
    }),
  );
  if (commit.outcome !== "conflict") return "minted";
  logger.warn(
    `⚠️  ${args.kind} intent ${key} was minted by another producer between this run's read and its write (${commit.reason}); the stored row stands`,
  );
  return "conflict";
}

/**
 * Mint the visible post-match report's intents: one per deliverable channel.
 *
 * The audience is v1's own, through `resolvePostmatchDeliveryChannels`, so the
 * queue filter and the subscription rules exist once. The freshness deadline
 * is v1's too: past it the report is about a game too old to announce, and the
 * machine suppresses rather than sends.
 */
export async function mintPostmatchIntents(
  db: Db,
  args: {
    matchId: RiotMatchId;
    puuids: readonly LeaguePuuid[];
    /** v1's own three queue inputs, so one match resolves one queue type. */
    queue: { queueId: number; gameMode: string; gameType: string };
    gameCreation: number;
    createdAt: Date;
  },
): Promise<MatchIntentsSummary> {
  const summary = emptySummary();
  const { deliverable } = await resolvePostmatchDeliveryChannels({
    puuids: [...args.puuids],
    queueType: resolveQueueTypeFromGame(
      args.queue.queueId,
      args.queue.gameMode,
      args.queue.gameType,
    ),
  });
  const freshnessDeadline = postmatchReportFreshnessDeadline(args.gameCreation);
  for (const channel of deliverable) {
    countMint(
      summary,
      await mintMatchIntent(db, {
        matchId: args.matchId,
        key: deliveryIntentKey(
          postmatchDeliveryKeyPrefix(args.matchId),
          channel.channel,
        ),
        kind: "postmatch",
        channelId: channel.channel,
        createdAt: args.createdAt,
        freshnessDeadline,
      }),
    );
  }
  return summary;
}
