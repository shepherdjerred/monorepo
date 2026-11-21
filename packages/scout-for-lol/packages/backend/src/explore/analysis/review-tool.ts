import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { EndOfGameMatch } from "@scout-for-lol/data";
import { tool } from "ai";
import { z } from "zod";
import {
  LeaguePuuidSchema,
  type LeaguePuuid,
} from "@scout-for-lol/domain/identity/league-account.ts";
import type { ExploreAgentParams } from "#src/explore/analysis/agent-types.ts";
import {
  recordedMatchRoster,
  reviewedMatchFacts,
  storedMatchRecord,
  summarizeRecordedMatch,
} from "#src/explore/analysis/match-review.ts";
import {
  END_OF_GAME_NOT_A_PLAYER_REFUSAL,
  endOfGameReviewedPlayer,
  summarizeEndOfGameMatch,
} from "#src/explore/analysis/end-of-game-review.ts";
import {
  endOfGameReviewReads,
  type EndOfGameReviewReads,
} from "#src/explore/analysis/end-of-game-review-reads.ts";
import { readRawDocuments } from "#src/explore/analysis/raw-lake-read.ts";
import {
  CRAWLED_MATCH_REVIEW_REFUSAL,
  isCrawlOnlyMatch,
} from "#src/explore/analysis/crawled-match.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/**
 * One game's stored match and timeline, reviewed in a single tool.
 *
 * The timeline summary was reachable only through the analysis sandbox: a
 * ScoutQL dataset, then a raw-documents dataset, then the summary. With the
 * sandbox off — as in prod — no review could name a death or a turning point,
 * and exposing just the last two steps left the model a chain it could not
 * start. This reads the documents for one match id directly. Match data is
 * not server-scoped (queries without servers already read every ingested
 * match), and the output is the same paged, deterministic summary.
 *
 * A game Scout knows only from the League client's end-of-game screen gets
 * its own review: the asker's end-of-game stats and their own recording,
 * labelled as having no timeline, and only for a player in that game.
 */
type StoredDocuments = {
  readonly documents: Awaited<ReturnType<typeof readRawDocuments>>["documents"];
};

/** A successful review in this turn, recorded for automatic card attachment. */
export type ReviewedMatch = {
  readonly matchId: RiotMatchId;
  readonly participantId: number | null;
  readonly puuid: LeaguePuuid | null;
  readonly cardSupported: boolean;
};

/** The reads `review_match` makes, replaceable in tests. */
export type MatchReviewReads = EndOfGameReviewReads & {
  readonly documents: (
    matchId: RiotMatchId,
    abortSignal: AbortSignal,
  ) => Promise<StoredDocuments["documents"]>;
  readonly isCrawlOnly: (
    matchId: RiotMatchId,
    abortSignal: AbortSignal,
  ) => Promise<boolean>;
};

const matchReviewReads: MatchReviewReads = {
  ...endOfGameReviewReads,
  documents: async (matchId, abortSignal) => {
    const raw = await readRawDocuments({
      matchIds: [matchId],
      kinds: ["match", "timeline", "prematch"],
      signal: abortSignal,
    });
    return raw.documents;
  },
  isCrawlOnly: async (matchId, abortSignal) =>
    await isCrawlOnlyMatch({ matchId, abortSignal }),
};

export function createMatchReviewTools(
  params: Pick<ExploreAgentParams, "abortSignal" | "requesterId" | "guildIds">,
  track: ToolTracker,
  onReviewed?: (review: ReviewedMatch) => void,
  reads: MatchReviewReads = matchReviewReads,
) {
  // Paging through one game's events re-reads the same documents. A game
  // without a timeline is not cached: acquire_match_timelines may fetch it
  // later in the same turn, and the next review must see it.
  const loaded = new Map<RiotMatchId, StoredDocuments>();
  async function documentsFor(matchId: RiotMatchId): Promise<StoredDocuments> {
    const cached = loaded.get(matchId);
    if (cached !== undefined) return cached;
    const data = {
      documents: await reads.documents(matchId, params.abortSignal),
    };
    if (data.documents.some((document) => document.kind === "timeline"))
      loaded.set(matchId, data);
    return data;
  }

  async function reviewEndOfGame(match: EndOfGameMatch) {
    const reviewed = endOfGameReviewedPlayer(
      match,
      await reads.askerPuuids({
        requesterId: params.requesterId,
        guildIds: params.guildIds,
      }),
    );
    if (reviewed?.puuid == null) return END_OF_GAME_NOT_A_PLAYER_REFUSAL;
    const recording = await reads.ownRecording({
      requesterId: params.requesterId,
      matchId: match.metadata.matchId,
      puuid: LeaguePuuidSchema.parse(reviewed.puuid),
    });
    return summarizeEndOfGameMatch({ match, reviewed, recording });
  }

  return {
    review_match: tool({
      description:
        "Review one stored game from its match and timeline documents. Call with participantId null to get the roster (participantId, champion, Riot ID, team, role, KDA, CS, gold, damage, vision). Then call with the reviewed player's participantId and offset 0: the first page has their stats, timeline coverage, and named deaths and objective events with gameTime labels, bounties and preceding team-gold snapshots; follow nextOffset for more. A game Scout recorded only from the League client's end-of-game screen has no participant numbers and no timeline: the participantId-null call returns its whole review (the asker's own end-of-game stats, team totals and their own Scout Desktop recording), only when the asker played in it. Use it first for any single-game review.",
      inputSchema: z.strictObject({
        matchId: RiotMatchIdSchema.describe(
          "The match_id from a query or match card, such as NA1_5123456789.",
        ),
        // Arena games run to 16 players; the match decides which ids exist.
        participantId: z.number().int().min(1).nullable(),
        offset: z.number().int().nonnegative(),
      }),
      outputSchema: z.json(),
      execute: (input) =>
        track("review_match", async () => {
          const data = await documentsFor(input.matchId);
          const record = storedMatchRecord(data, input.matchId);
          if (
            record === null &&
            (await reads.isCrawlOnly(input.matchId, params.abortSignal))
          ) {
            return z.json().parse(CRAWLED_MATCH_REVIEW_REFUSAL);
          }
          const result =
            record?.coverage === "end_of_game"
              ? await reviewEndOfGame(record.match)
              : input.participantId === null
                ? recordedMatchRoster(data, input.matchId)
                : summarizeRecordedMatch(
                    data,
                    input.matchId,
                    input.participantId,
                    input.offset,
                  );
          if (onReviewed !== undefined && result.ok) {
            const facts = reviewedMatchFacts(
              data,
              input.matchId,
              record?.coverage === "end_of_game" ? null : input.participantId,
            );
            onReviewed({
              matchId: input.matchId,
              participantId:
                record?.coverage === "end_of_game" ? null : input.participantId,
              puuid: facts.puuid,
              cardSupported: facts.cardSupported,
            });
          }
          return z.json().parse(result);
        }),
    }),
  };
}
