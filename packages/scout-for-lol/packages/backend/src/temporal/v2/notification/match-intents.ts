import { resolveQueueTypeFromGame, sumToPoolTotal } from "@scout-for-lol/data";
import {
  NotificationIntentKeySchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import type { OpaqueVersionedEnvelope } from "@scout-for-lol/domain/codec/versioned.ts";
import type { NotificationIntentKind } from "@scout-for-lol/domain/notifications/intent.ts";
import type { Db } from "#src/database/index.ts";
import {
  getIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { getObservation } from "#src/database/durable/observation-repository.ts";
import {
  dareSummaryDeliveryKeyPrefix,
  deliveryIntentKey,
  lateBindingEarningsDeliveryKeyPrefix,
  postmatchDeliveryKeyPrefix,
  settlementDeliveryKeyPrefix,
} from "#src/durable/match/delivery-intents.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settlement-types.ts";
import type { EarnedAward } from "#src/betting/accounts/earnings.ts";
import {
  prepareSettlementAnnouncement,
  type SettlementAnnouncementInput,
} from "#src/betting/notify/announce-prepare.ts";
import { buildAnnouncements } from "#src/betting/notify/announce.ts";
import type { ParlaySettlementSummary } from "#src/betting/parlays/runtime/parlay-settlement-types.ts";
import type { SettlementSummary } from "#src/betting/settlement/settlement-types.ts";
import { resolvePostmatchDeliveryChannels } from "#src/league/tasks/notification-filters.ts";
import { postmatchReportFreshnessDeadline } from "#src/league/tasks/postmatch/match-report-delivery.ts";
import { VOID_GRACE_MS } from "#src/betting/constants.ts";
import { createLogger } from "#src/logger.ts";
import { durableCommitV2 } from "#src/temporal/v2/match-commits.ts";
import { z } from "zod";
import { RiotTeamIdSchema } from "@scout-for-lol/data";
import type {
  ClosedPool,
  ClosedPosition,
} from "#src/betting/settlement/sweep-types.ts";
import {
  DareSummaryAnnouncementSchema,
  EarnedAwardSchema,
  ParlaySettlementSummarySchema,
  SettlementSummarySchema,
  dareSettlementSummaryOf,
  parlaySummaryOf,
  settlementSummaryOf,
  dareSummaryAnnouncementEnvelope,
  settlementAnnouncementEnvelope,
} from "#src/temporal/v2/notification/announcement-codecs.ts";
import type {
  SettlementAnnouncementFamily,
  SettlementAnnouncementItem,
} from "#src/database/durable/settlement-announcement-repository.ts";

const logger = createLogger("scout-v2-match-intents");
const EMPTY_POOL_TOTAL = sumToPoolTotal([]);

/**
 * The post-match lane's notification intents: one durable row per decision to
 * tell someone something about a finished match.
 *
 * Three kinds are minted here — the visible report, one guild's settlement
 * recap, one Dare's resolution — and they are minted in two different places
 * for one reason: an announcement may only be minted where the facts it
 * announces were produced. The report needs only the match, so the Workflow
 * mints it after the observation stands. The settlement recap and the Dare
 * summary carry the summaries settlement itself produced, which exist only
 * inside the fenced settlement effect, so they are minted there.
 *
 * ## Silence is enforced here, and nowhere else
 *
 * A `silent-backfill` match mints NOTHING. The gate is at the mint rather than
 * at the fan-out or in the notification machine, because an intent row is
 * itself the evidence that a delivery was intended: it carries a target, a
 * freshness deadline and a drivable state, it is counted by the operator
 * backlog gauge, and the reconciliation sweep re-drives it. A gate anywhere
 * later would leave that evidence standing and, in the sweep's case, would
 * eventually announce the backfill anyway.
 *
 * The mode is read from the COMMITTED observation rather than taken as a
 * parameter. Settlement must still run for a silent match — money moves either
 * way, only the announcement is silent — so the Workflow cannot enforce this
 * by declining to call the effect, and a caller that handed in the wrong mode
 * must not be able to produce an intent. Reading the row makes the rule one
 * rule, over the same fact the observation claim already defends against drift.
 *
 * ## Every write is read-gated and strict
 *
 * `upsertIntent` compares the whole stored row, and `createdAt` is stamped
 * from the clock, so a second attempt that wrote blind would be answered
 * `intent-differs` and look like two producers disagreeing about one decision.
 * Reading first means a retry finds its own row and writes nothing. A conflict
 * that survives the read is reported, not thrown: it is two producers minting
 * the SAME instruction during the window where v1 and V2 both run, and the
 * stored row is a valid instruction whoever wrote it.
 */

/** What one attempt did to one intent row. */
export type MatchIntentMint = "minted" | "existing" | "conflict" | "silent";

/** What one minting pass did, counted so a silent match is visible as silent. */
export type MatchIntentsV2Summary = {
  minted: number;
  existing: number;
  conflicts: number;
  silent: number;
  /** Announcements with nowhere to go; see {@link mintSettlementIntentsV2}. */
  undeliverable: number;
};

function emptySummary(): MatchIntentsV2Summary {
  return { minted: 0, existing: 0, conflicts: 0, silent: 0, undeliverable: 0 };
}

function countMint(
  summary: MatchIntentsV2Summary,
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
): Promise<boolean> {
  const observation = await getObservation(db, { matchId });
  if (observation === null) {
    throw new Error(
      `Refusing to mint notification intents for ${matchId}: no observation stands for it, so whether it is owed a public delivery is unknown`,
    );
  }
  return observation.deliveryMode === "live";
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
  channelId: string,
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
    channelId: string;
    createdAt: Date;
    freshnessDeadline: Date;
    announcement?: OpaqueVersionedEnvelope | undefined;
  },
): Promise<MatchIntentMint> {
  if (!(await matchMayAnnounce(db, args.matchId))) return "silent";
  const key = NotificationIntentKeySchema.parse(args.key);
  const standing = await getIntent(db, { intentKey: key });
  if (standing !== null) {
    requireIntentMatches(standing, args.matchId, args.channelId);
    return "existing";
  }

  const commit = durableCommitV2(
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
export async function mintPostmatchIntentsV2(
  db: Db,
  args: {
    matchId: RiotMatchId;
    puuids: readonly LeaguePuuid[];
    /** v1's own three queue inputs, so one match resolves one queue type. */
    queue: { queueId: number; gameMode: string; gameType: string };
    gameCreation: number;
    createdAt: Date;
  },
): Promise<MatchIntentsV2Summary> {
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

/**
 * The announcement instructions a settlement calls for, as data.
 *
 * Split out from the minting so the SAME instructions can be checkpointed
 * before anything is written and replayed by a takeover. `buildAnnouncements`
 * is v1's own set — it folds in a closure with positions but no settlement and
 * a parlay whose pool settled on an earlier tick — and the earnings are
 * narrowed to each announcement's own guild here, once, so the checkpoint
 * stores exactly what the mint will use.
 */
export function settlementAnnouncementInputs(input: {
  closures: readonly ClosedPool[];
  settlements: readonly SettlementSummary[];
  parlaySettlements: readonly ParlaySettlementSummary[];
  earnings: readonly EarnedAward[];
}): readonly SettlementAnnouncementInput[] {
  return buildAnnouncements({
    closures: input.closures,
    settlements: input.settlements,
    parlaySettlements: input.parlaySettlements,
  }).map((announcement) => ({
    ...announcement,
    earnings: input.earnings.filter(
      (award) => award.serverId === announcement.summary.serverId,
    ),
  }));
}

/**
 * A closed pool, as the fold reads it.
 *
 * Spelled in full rather than projected to the two fields `buildAnnouncements`
 * happens to read today, because a projection would silently drop whatever it
 * reads tomorrow and the fold-equivalence test would only notice if its data
 * exercised that field. `satisfies` pins it to v1's own type, so a field added
 * there fails this module's typecheck.
 */
const ClosedPositionSchema = z.strictObject({
  betId: z.number().int(),
  discordId: z.string().min(1),
  teamId: RiotTeamIdSchema,
  submittedStake: z.number().int(),
  matchedStake: z.number().int(),
  unmatchedStake: z.number().int(),
}) satisfies z.ZodType<ClosedPosition>;

const ClosedPoolSchema = z.strictObject({
  matchId: z.string().min(1),
  serverId: z.string().min(1),
  messageRefs: z.array(
    z.strictObject({
      channelId: z.string().min(1),
      messageId: z.string().min(1),
    }),
  ),
  humanMatchedPerSide: z.number().int(),
  houseFill: z.number().int(),
  totalMatchedPerSide: z.number().int(),
  positions: z.array(ClosedPositionSchema),
}) satisfies z.ZodType<ClosedPool>;

function payloadsOfFamily(
  items: readonly SettlementAnnouncementItem[],
  family: SettlementAnnouncementFamily,
): readonly unknown[] {
  return items
    .filter((item) => item.family === family)
    .map((item) => item.payload);
}

/**
 * Rebuild the announcement instructions from recovered items.
 *
 * The SAME fold the live path runs, over the same four families, so a takeover
 * announces what the original run would have announced. It has to be the same
 * fold rather than a per-item reconstruction: `buildAnnouncements` folds in a
 * closure carrying positions but no settlement, and a parlay whose pool
 * settled on an earlier tick, and a recovery that walked the items one at a
 * time would drop exactly those.
 */
/**
 * The settlement RECORDS a match's standing checkpoints attest to.
 *
 * The same payloads {@link recoveredAnnouncementsOf} folds into announcements,
 * parsed back to the shapes settlement itself returned rather than to the
 * presentation inputs — because the caller needs them as evidence, not as
 * something to render.
 *
 * This exists so a receipt can name what the WHOLE match settled rather than
 * what the last attempt happened to settle. Settlement's steps are one-shot,
 * so an attempt resuming a partly-settled match legitimately returns little or
 * nothing; a receipt built from that alone would record an empty settlement
 * for a match whose bets were all resolved.
 */
export function recoveredSettlementRecordsOf(
  items: readonly SettlementAnnouncementItem[],
): {
  readonly closures: readonly ClosedPool[];
  readonly settlements: readonly SettlementSummary[];
  readonly parlaySettlements: readonly ParlaySettlementSummary[];
  readonly earnings: readonly EarnedAward[];
  readonly dareSettlements: readonly DareSettlementSummary[];
} {
  return {
    closures: payloadsOfFamily(items, "closure").map((payload): ClosedPool =>
      ClosedPoolSchema.parse(payload),
    ),
    settlements: payloadsOfFamily(items, "settlement").map(
      (payload): SettlementSummary =>
        settlementSummaryOf(SettlementSummarySchema.parse(payload)),
    ),
    parlaySettlements: payloadsOfFamily(items, "parlay").map(
      (payload): ParlaySettlementSummary =>
        parlaySummaryOf(ParlaySettlementSummarySchema.parse(payload)),
    ),
    earnings: payloadsOfFamily(items, "earnings").flatMap((payload) =>
      z.array(EarnedAwardSchema).parse(payload),
    ),
    dareSettlements: payloadsOfFamily(items, "dare-summary").map((payload) =>
      dareSettlementSummaryOf(DareSummaryAnnouncementSchema.parse(payload)),
    ),
  };
}

/** Earnings checkpointed specifically by post-pipeline client late binding. */
export function recoveredLateBindingEarningsOf(
  items: readonly SettlementAnnouncementItem[],
): readonly EarnedAward[] {
  return payloadsOfFamily(items, "late-earnings").flatMap((payload) =>
    z.array(EarnedAwardSchema).parse(payload),
  );
}

/**
 * Build earnings-only settlement carriers, one per guild.
 *
 * These use a distinct intent key from the ordinary settlement recap because
 * that recap may already be delivered before a client observation binds the
 * match to a managed game.
 */
export function lateBindingEarningAnnouncementInputs(input: {
  matchId: RiotMatchId;
  earnings: readonly EarnedAward[];
}): readonly SettlementAnnouncementInput[] {
  const byGuild = new Map<string, EarnedAward[]>();
  for (const award of input.earnings) {
    byGuild.set(award.serverId, [
      ...(byGuild.get(award.serverId) ?? []),
      award,
    ]);
  }
  return [...byGuild.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([serverId, earnings]) => ({
      summary: {
        matchId: input.matchId,
        serverId,
        winningTeamId: undefined,
        voidReason: undefined,
        winnersPool: EMPTY_POOL_TOTAL,
        losersPool: EMPTY_POOL_TOTAL,
        houseCut: EMPTY_POOL_TOTAL,
        bets: [],
      },
      includeOutcome: true,
      parlay: undefined,
      earnings,
    }));
}

export function recoveredAnnouncementsOf(
  items: readonly SettlementAnnouncementItem[],
): {
  readonly settlements: readonly SettlementAnnouncementInput[];
  readonly dareSummaries: readonly DareSettlementSummary[];
} {
  // A FOLD of the same records, not a second parse of the same rows. Both
  // readers want every family back in the shapes settlement returned; only
  // this one then folds four of them into announcements. Parsing twice meant
  // two places where a family could be read differently from the other.
  const records = recoveredSettlementRecordsOf(items);
  return {
    // Through the module's own mappers, which is also what the live
    // announcement path parses with: the v1 types require these keys
    // present-but-undefined where the schema makes them optional, and one
    // normalisation for both paths is what keeps them identical.
    settlements: settlementAnnouncementInputs({
      closures: records.closures,
      settlements: records.settlements,
      parlaySettlements: records.parlaySettlements,
      earnings: records.earnings,
    }),
    dareSummaries: records.dareSettlements,
  };
}

/**
 * Mint the settlement recaps this match owes, one per channel a pool's
 * bettors are watching.
 *
 * The announcement SET is v1's own `buildAnnouncements`, not a re-derivation:
 * it folds in a closure with positions but no settlement and a parlay whose
 * pool settled on an earlier tick, both of which a loop over `settlements`
 * alone would silently drop. The decision to say anything is v1's too —
 * `prepareSettlementAnnouncement` answers `pool-missing` for a guild whose
 * pool never existed and `nothing-to-report` for one whose settlement says
 * nothing a player can read — so neither mints a row the delivery arm would
 * then refuse to render.
 *
 * The destination is the pool's own recorded refs. Zero refs is v1's
 * undeliverable case: the prematch message never landed, so there is nowhere
 * its bettors are watching, and v1 deliberately does not substitute a guess.
 * Minting an intent with a guessed target would post a guild's payouts in a
 * channel nobody opted into, so this mints nothing and counts it instead.
 *
 * `earnings` are filtered to the announcement's own guild before they go on
 * the envelope, because the envelope is what the send renders and another
 * guild's awards are not this channel's business.
 */
/**
 * How long a MONETARY announcement stays deliverable.
 *
 * Not the report's window, which is what these two mints used to borrow. A
 * match report is news about a game and goes stale; a settlement notice is a
 * receipt for money that already moved, and v1 never applied the report's
 * age check to it — `deliverPostmatchReport` is the only caller of
 * `isPostmatchReportStale`, and the settlement and Dare announcements go out
 * whenever settlement runs. Borrowing it meant a live match processed after
 * an outage, a long game or repeated retries minted intents that were
 * already expired: the send is refused, reconciliation excludes them, and
 * nobody is ever told what they were paid.
 *
 * Derived rather than picked round, in the style `VOID_GRACE_MS` sets. The
 * latest a settlement can legitimately happen is the void sweep, which fires
 * `VOID_GRACE_MS` past a pool's close and itself produces a refund somebody
 * is owed word of. So the bound is the report's window plus that grace: past
 * it, no settlement this pipeline performs can still be waiting to announce.
 *
 * RESIDUAL, stated because the bound is not conceptually required: a
 * settlement performed beyond this window — a takeover after a very long
 * outage — still loses its announcement. Removing the bound entirely means
 * making `freshnessDeadline` optional in the notification contract, which is
 * a replay-affecting change to a recorded shape and is not made here.
 */
export function monetaryAnnouncementFreshnessDeadline(
  gameCreation: number,
): Date {
  return new Date(
    postmatchReportFreshnessDeadline(gameCreation).getTime() + VOID_GRACE_MS,
  );
}

async function mintSettlementAnnouncementIntentsV2(
  db: Db,
  args: SettlementIntentMintInput & { readonly keyPrefix: string },
): Promise<MatchIntentsV2Summary> {
  const summary = emptySummary();
  const freshnessDeadline = monetaryAnnouncementFreshnessDeadline(
    args.gameCreation,
  );
  const announcements =
    args.announcements ??
    settlementAnnouncementInputs({
      closures: args.closures ?? [],
      settlements: args.settlements ?? [],
      parlaySettlements: args.parlaySettlements ?? [],
      earnings: args.earnings ?? [],
    });
  for (const input of announcements) {
    // Deliberately on the ambient client rather than `db`: this reads the
    // pool that settlement already COMMITTED before this mint began, so it
    // needs no view of the mint's own writes, and v1's helper takes the full
    // client a transaction handle cannot satisfy. It touches only pool tables
    // while the mint writes only intent rows, so the two cannot contend.
    const prepared = await prepareSettlementAnnouncement(input);
    if (prepared.kind !== "message") continue;
    if (prepared.refs.length === 0) {
      summary.undeliverable += 1;
      logger.warn(
        `⚠️  Settlement for ${input.summary.serverId} on ${args.matchId} has no recorded pool message to announce under; minting nothing rather than guessing a channel`,
      );
      continue;
    }
    const envelope = settlementAnnouncementEnvelope(input);
    for (const ref of prepared.refs) {
      countMint(
        summary,
        await mintMatchIntent(db, {
          matchId: args.matchId,
          key: deliveryIntentKey(args.keyPrefix, ref.channelId),
          kind: "settlement",
          channelId: ref.channelId,
          createdAt: args.createdAt,
          freshnessDeadline,
          announcement: envelope,
        }),
      );
    }
  }
  return summary;
}

type SettlementIntentMintInput = {
  matchId: RiotMatchId;
  /** Recovered instructions; when present the summaries below are unused. */
  announcements?: readonly SettlementAnnouncementInput[] | undefined;
  closures?: readonly ClosedPool[] | undefined;
  settlements?: readonly SettlementSummary[] | undefined;
  parlaySettlements?: readonly ParlaySettlementSummary[] | undefined;
  earnings?: readonly EarnedAward[] | undefined;
  gameCreation: number;
  createdAt: Date;
};

export async function mintSettlementIntentsV2(
  db: Db,
  args: SettlementIntentMintInput,
): Promise<MatchIntentsV2Summary> {
  return await mintSettlementAnnouncementIntentsV2(db, {
    ...args,
    keyPrefix: settlementDeliveryKeyPrefix(args.matchId),
  });
}

/** Mint the separate earnings-only recap created by client late binding. */
export async function mintLateBindingEarningIntentsV2(
  db: Db,
  args: {
    matchId: RiotMatchId;
    earnings: readonly EarnedAward[];
    gameCreation: number;
    createdAt: Date;
  },
): Promise<MatchIntentsV2Summary> {
  return await mintSettlementAnnouncementIntentsV2(db, {
    matchId: args.matchId,
    announcements: lateBindingEarningAnnouncementInputs(args),
    gameCreation: args.gameCreation,
    createdAt: args.createdAt,
    keyPrefix: lateBindingEarningsDeliveryKeyPrefix(args.matchId),
  });
}

/** Resolutions that announce nothing: nothing was staked, or nothing settled. */
const UNANNOUNCED_DARE_RESOLUTIONS: ReadonlySet<string> = new Set([
  "captured",
  "abandoned",
]);

/**
 * Mint one intent per Dare this match resolved.
 *
 * `captured` and `abandoned` announce nothing — the first is a Dare still in
 * flight whose evidence was merely recorded, the second one that never became
 * a contract — so they mint no row rather than a row the arm would refuse.
 * Only match-bound summaries are minted here: a Dare that resolved on a
 * deadline rather than on this match belongs to maintenance, which is a
 * different decision with a different clock.
 */
export async function mintDareSummaryIntentsV2(
  db: Db,
  args: {
    matchId: RiotMatchId;
    dareSettlements: readonly DareSettlementSummary[];
    gameCreation: number;
    createdAt: Date;
  },
): Promise<MatchIntentsV2Summary> {
  const summary = emptySummary();
  const freshnessDeadline = monetaryAnnouncementFreshnessDeadline(
    args.gameCreation,
  );
  for (const dare of args.dareSettlements) {
    if (UNANNOUNCED_DARE_RESOLUTIONS.has(dare.resolution)) continue;
    // A summary with no match id was resolved by a DEADLINE sweep, not by
    // this match, and announcing it under this match's id would tell people
    // a game decided something it had nothing to do with. Every resolution a
    // match produces carries its id; one that does not is the sweep's.
    if (dare.matchId === undefined) continue;
    countMint(
      summary,
      await mintMatchIntent(db, {
        matchId: args.matchId,
        key: deliveryIntentKey(
          dareSummaryDeliveryKeyPrefix(String(dare.dareId)),
          dare.channelId,
        ),
        kind: "dare-summary",
        channelId: dare.channelId,
        createdAt: args.createdAt,
        freshnessDeadline,
        announcement: dareSummaryAnnouncementEnvelope(dare),
      }),
    );
  }
  return summary;
}
