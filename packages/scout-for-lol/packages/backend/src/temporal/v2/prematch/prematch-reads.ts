import * as Sentry from "@sentry/bun";
import type { PlayerConfigEntry } from "@scout-for-lol/data";
import { MAX_PLAYERS_PER_RUN } from "@scout-for-lol/data/polling-config.ts";
import {
  RiotMatchIdSchema,
  type NotificationIntentKey,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ScoutFanOutV2ResultSchema,
  ScoutPrematchScanV2ResultSchema,
  type ScoutFanOutV2Result,
  type ScoutPrematchScanV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import {
  ScoutPrematchGameRefSchema,
  SCOUT_V2_PAGE_MAX,
  type ScoutPrematchGameRef,
} from "@scout-for-lol/temporal/contracts-v2";
import { prisma } from "#src/database/index.ts";
import { getAccountsWithState } from "#src/database/player-accounts.ts";
import { listIntentsForMatch } from "#src/database/durable/intent-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { getActiveServerIds } from "#src/discord/utils/guild-membership.ts";
import { prematchDeliveryKeyPrefix } from "#src/durable/match/delivery-intents.ts";
import { getActiveGame } from "#src/league/api/spectator.ts";
import { listLiveActiveGameMatchIds } from "#src/league/tasks/prematch/active-game-queries.ts";
import { createLogger } from "#src/logger.ts";
import { CircuitBreaker } from "#src/utils/circuit-breaker.ts";
import { shouldCheckPlayer } from "#src/utils/polling-intervals.ts";
import { DRIVABLE_INTENT_STATES } from "#src/temporal/v2/match-reads.ts";
import { isPrematchRosterComplete } from "#src/temporal/v2/prematch/prematch-context.ts";

/**
 * The V2 prematch path's reads: which live games exist, and what one game's
 * durable state calls for next.
 *
 * Both results are parsed through their frozen contract schemas before they
 * leave, for the reason the per-match reads are: these are the answers a
 * Workflow makes decisions from, and a page that quietly exceeded its budget
 * or an intent key a Workflow ID cannot carry would otherwise become a
 * Workflow-side failure — or a silently truncated fan-out — rather than a
 * named failure here.
 */

const logger = createLogger("scout-v2-prematch-reads");

/**
 * The spectator API's own breaker, kept apart from v1's by name so the two
 * pipelines' outage signals stay distinguishable on the same dashboard.
 *
 * `getActiveGame` deliberately reports upstream 5xx without touching Sentry
 * and leaves the judgement to its caller, so without a breaker a spectator
 * outage would be invisible here. It also stops a poll from spending its whole
 * budget on fifty reads that are already failing.
 */
const spectatorCircuit = new CircuitBreaker("spectator-api-v2");

/**
 * What one account's spectator read found.
 *
 * `idle` covers both "not in a game" and "in a game whose roster has not
 * filled yet", and folding them is deliberate: a pre-game countdown is a game
 * that has not started rather than one this scan failed to see. Surfacing it
 * would be worse than waiting — the per-game Workflow ID would be claimed by a
 * run holding a half-filled roster, and every later poll would deduplicate
 * against it.
 */
type PrematchProbe =
  | { kind: "game"; ref: ScoutPrematchGameRef }
  | { kind: "idle" }
  | { kind: "unreadable" };

async function probeAccountV2(
  config: PlayerConfigEntry,
): Promise<PrematchProbe> {
  const puuid = config.league.leagueAccount.puuid;
  const region = config.league.leagueAccount.region;
  try {
    const spectator = await getActiveGame(puuid, region);
    if (spectator.kind === "unavailable") {
      if (spectator.upstream) {
        spectatorCircuit.recordFailure(
          new Error(`Spectator API upstream error for ${puuid}`),
          { source: "spectator-v2", puuid, region },
        );
      } else {
        // Riot answered, just not usably; the API itself is reachable.
        spectatorCircuit.recordSuccess();
      }
      // Unreadable, never idle. An unanswered read says nothing about whether
      // this account is in a game, and calling it idle would drop a live game
      // from the page while reporting the scan complete.
      return { kind: "unreadable" };
    }
    // A 404 is an answer, so the API is reachable.
    spectatorCircuit.recordSuccess();
    if (
      spectator.kind === "not-in-game" ||
      !isPrematchRosterComplete(spectator.game)
    ) {
      return { kind: "idle" };
    }
    const game = spectator.game;
    return {
      kind: "game",
      ref: ScoutPrematchGameRefSchema.parse({
        puuid,
        platform: game.platformId,
        gameId: game.gameId.toString(),
      }),
    };
  } catch (error) {
    // One account's unreadable spectator state must not blind the poll to
    // every other account's live game, but it must not pass for silence
    // either: the scan reports itself incomplete and the next poll re-reads.
    logger.error(`❌ Prematch probe failed for ${puuid}`, error);
    Sentry.captureException(error, {
      tags: { source: "scout-v2-prematch-discovery", puuid },
    });
    return { kind: "unreadable" };
  }
}

function compareByLastCheckedAt(
  left: { lastCheckedAt: Date | undefined },
  right: { lastCheckedAt: Date | undefined },
): number {
  return (
    (left.lastCheckedAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
    (right.lastCheckedAt?.getTime() ?? Number.NEGATIVE_INFINITY)
  );
}

/**
 * Leave to v1 every game v1 is already announcing.
 *
 * v1 writes a live `ActiveGame` row before it announces a game, and V2's own
 * dedup — the per-game Workflow ID — cannot see it. Without this, the first V2
 * pass after the prematch ownership flag flips on would start a capture for a
 * game v1 announced a minute earlier, and that capture would mint intents for
 * any channel whose v1 delivery record never landed (v1 records fail-open).
 * The game stays v1's for the rest of its life; only games v1 never saw are
 * V2's.
 */
export async function withoutV1AnnouncedGames(
  games: ScoutPrematchGameRef[],
  now: Date,
): Promise<ScoutPrematchGameRef[]> {
  const identity = (ref: ScoutPrematchGameRef): string =>
    `${ref.platform}_${ref.gameId}`;
  const announcedByV1 = await listLiveActiveGameMatchIds(
    games.map((ref) => identity(ref)),
    now,
  );
  if (announcedByV1.size > 0) {
    logger.info(
      `⏭️  Prematch discovery left ${announcedByV1.size.toString()} live game(s) to v1, which is already announcing them`,
    );
  }
  return games.filter((ref) => !announcedByV1.has(identity(ref)));
}

/**
 * Discover the live games tracked accounts are in, as a bounded page of game
 * REFERENCES.
 *
 * The account selection is v1's, unchanged: `shouldCheckPlayer` applies the
 * per-account polling interval, the least recently checked go first, and
 * `MAX_PLAYERS_PER_RUN` caps a single run's Riot spend.
 *
 * What V2 drops is the `ActiveGame` table. v1 needs it because its notify step
 * runs inline and has no other way to avoid announcing one game twice; here
 * the per-game Workflow ID is the dedup, and it is a better one — it survives
 * a process restart, it collapses the same game surfaced through several
 * tracked accounts, and it cannot expire while the game is still live. V2
 * only READS the table, to leave v1's in-flight games to v1 across an
 * ownership flip (see `withoutV1AnnouncedGames`). The
 * games are deduplicated by that same identity before they are returned, so a
 * page counts distinct games rather than account sightings.
 *
 * `complete` folds every way this run saw less than it could have: accounts
 * deferred past the per-run cap, a read the spectator API could not answer,
 * and a page that hit the contract's budget. The caller does the same thing
 * with all three — the next poll covers what is left.
 */
export async function discoverPrematchGamesV2(): Promise<ScoutPrematchScanV2Result> {
  const accounts = await getAccountsWithState(prisma, getActiveServerIds());
  const now = new Date();
  const eligible = accounts
    .filter(({ lastMatchTime, lastCheckedAt }) =>
      shouldCheckPlayer(lastMatchTime, lastCheckedAt, now),
    )
    .toSorted(compareByLastCheckedAt);
  const polled = eligible.slice(0, MAX_PLAYERS_PER_RUN);

  const games = new Map<string, ScoutPrematchGameRef>();
  let sawEveryPolledAccount = true;
  for (const { config } of polled) {
    if (spectatorCircuit.shouldSkip()) {
      sawEveryPolledAccount = false;
      continue;
    }
    const probe = await probeAccountV2(config);
    if (probe.kind === "unreadable") {
      sawEveryPolledAccount = false;
      continue;
    }
    if (probe.kind === "idle") continue;
    // First sighting wins. The reference's puuid only says which account the
    // spectator read is re-issued through, and every account in the game is
    // equally able to serve it.
    const identity = `${probe.ref.platform}_${probe.ref.gameId}`;
    if (!games.has(identity)) games.set(identity, probe.ref);
  }

  const discovered = await withoutV1AnnouncedGames([...games.values()], now);
  logger.info(
    `🔍 Prematch discovery polled ${polled.length.toString()}/${eligible.length.toString()} eligible account(s) and found ${discovered.length.toString()} live game(s)`,
  );
  return ScoutPrematchScanV2ResultSchema.parse({
    games: discovered.slice(0, SCOUT_V2_PAGE_MAX),
    complete:
      sawEveryPolledAccount &&
      eligible.length <= MAX_PLAYERS_PER_RUN &&
      discovered.length <= SCOUT_V2_PAGE_MAX,
  });
}

/**
 * The intents a prematch fan-out may drive, out of everything stored for one
 * match.
 *
 * Two narrowings, and both are load-bearing. The PREMATCH prefix is what the
 * per-match fan-out has no reason to apply: both paths key their intents by
 * the same match id — that is what lets a prematch snapshot and the completed
 * match share one scope — so without it a prematch run reprocessed after the
 * game finished would fan out the post-match announcement too, and two
 * Workflows would drive one intent. The state filter is the per-match core's
 * own, and excludes `unknown-delivery` for the reason it names: starting a
 * child on an unobserved send is precisely how a user gets told twice.
 */
export function drivablePrematchIntentKeys(
  matchId: RiotMatchId,
  records: readonly MatchNotificationIntentRecord[],
): NotificationIntentKey[] {
  const prefix = `${prematchDeliveryKeyPrefix(matchId)}:`;
  return records
    .filter(
      (record) =>
        record.intent.key.startsWith(prefix) &&
        DRIVABLE_INTENT_STATES.has(record.intent.state.kind),
    )
    .map((record) => record.intent.key);
}

/**
 * What to start once one game's snapshot stands.
 *
 * The intent keys are READ from the durable rows rather than derived per
 * channel, the same discipline the per-match fan-out follows: a caller that
 * guessed a key per channel would miss intents another producer minted and
 * re-mint keys for intents that already exist.
 *
 * `lakeProjection` is false by construction. `scoutLakeProjectionV2Workflow`
 * projects the MatchV5 payload, which does not exist while the game is being
 * played; the snapshot's own lake rows are staged by `archivePrematchSnapshotV2`
 * and attested by its `lake-staging-prematch` receipt.
 */
export async function planPrematchFanOutV2(input: {
  riotMatchId: string;
}): Promise<ScoutFanOutV2Result> {
  const matchId = RiotMatchIdSchema.parse(input.riotMatchId);
  const intents = await listIntentsForMatch(prisma, { matchId });
  return ScoutFanOutV2ResultSchema.parse({
    notificationIntentKeys: drivablePrematchIntentKeys(
      matchId,
      withoutStaleUnsentIntents(intents, new Date()),
    ),
    lakeProjection: false,
  });
}

/**
 * Drop the intents no send could still honour.
 *
 * A prematch intent's freshness deadline is the game's own tracked lifetime,
 * and the domain's `beginSend` refuses any attempt that starts after it. A
 * `pending` or `ready` intent past that deadline therefore has nothing left a
 * notification run could do but refuse three times, so starting one is pure
 * cost — and on a capture replaced hours later it would be a child per
 * channel for a game long over. A `sending` intent is kept whatever its
 * deadline: its run has an unobserved attempt to record, and only a child can
 * record it.
 */
export function withoutStaleUnsentIntents(
  records: readonly MatchNotificationIntentRecord[],
  now: Date,
): MatchNotificationIntentRecord[] {
  return records.filter(
    (record) =>
      (record.intent.state.kind !== "pending" &&
        record.intent.state.kind !== "ready") ||
      new Date(record.intent.freshnessDeadline).getTime() > now.getTime(),
  );
}
