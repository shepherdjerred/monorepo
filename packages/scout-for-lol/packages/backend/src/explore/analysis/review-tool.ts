import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { tool } from "ai";
import { z } from "zod";
import type { ExploreAgentParams } from "#src/explore/analysis/agent-types.ts";
import {
  recordedMatchRoster,
  summarizeRecordedMatch,
} from "#src/explore/analysis/match-review.ts";
import { readRawDocuments } from "#src/explore/analysis/raw-lake-read.ts";
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
 */
type StoredDocuments = {
  readonly documents: Awaited<ReturnType<typeof readRawDocuments>>["documents"];
};

export function createMatchReviewTools(
  params: Pick<ExploreAgentParams, "abortSignal">,
  track: ToolTracker,
) {
  // Paging through one game's events re-reads the same documents.
  const loaded = new Map<RiotMatchId, StoredDocuments>();
  async function documentsFor(matchId: RiotMatchId): Promise<StoredDocuments> {
    const cached = loaded.get(matchId);
    if (cached !== undefined) return cached;
    const raw = await readRawDocuments({
      matchIds: [matchId],
      kinds: ["match", "timeline"],
      signal: params.abortSignal,
    });
    const data = { documents: raw.documents };
    loaded.set(matchId, data);
    return data;
  }
  return {
    review_match: tool({
      description:
        "Review one stored game from its match and timeline documents. Call with participantId null to get the roster (participantId, champion, Riot ID, team, role, KDA, CS, gold, damage, vision). Then call with the reviewed player's participantId and offset 0: the first page has their stats, timeline coverage, and named deaths and objective events with gameTime labels, bounties and preceding team-gold snapshots; follow nextOffset for more. Use it first for any single-game review.",
      inputSchema: z.strictObject({
        matchId: RiotMatchIdSchema.describe(
          "The match_id from a query or match card, such as NA1_5123456789.",
        ),
        participantId: z.number().int().min(1).max(10).nullable(),
        offset: z.number().int().nonnegative(),
      }),
      outputSchema: z.json(),
      execute: (input) =>
        track("review_match", async () => {
          const data = await documentsFor(input.matchId);
          return z
            .json()
            .parse(
              input.participantId === null
                ? recordedMatchRoster(data, input.matchId)
                : summarizeRecordedMatch(
                    data,
                    input.matchId,
                    input.participantId,
                    input.offset,
                  ),
            );
        }),
    }),
  };
}
