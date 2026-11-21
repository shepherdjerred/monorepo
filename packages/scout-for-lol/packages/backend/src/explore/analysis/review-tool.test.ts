import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  LiveGameRecordingPayloadSchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import fixtures from "@scout-for-lol/data/scout-client/live-game-recording.fixtures.json" with { type: "json" };
import { classicEndOfGameMatch } from "#src/testing/scout-client/end-of-game-fixtures.ts";
import { passthroughTracker } from "#src/testing/explore-tool-runner.ts";
import { CRAWLED_MATCH_REVIEW_REFUSAL } from "./crawled-match.ts";
import { END_OF_GAME_NOT_A_PLAYER_REFUSAL } from "./end-of-game-review.ts";
import {
  createMatchReviewTools,
  type MatchReviewReads,
  type ReviewedMatch,
} from "./review-tool.ts";

const OPTIONS = { toolCallId: "test-call", messages: [], context: {} };
const requesterId = DiscordAccountIdSchema.parse("100000000000000001");
const endOfGame = await classicEndOfGameMatch();
const endOfGamePlayer = endOfGame.info.participants.find(
  (participant) => participant.puuid !== null,
);
if (endOfGamePlayer?.puuid == null)
  throw new Error("The Classic game has players");
const playerPuuid = endOfGamePlayer.puuid;

function document(matchId: RiotMatchId, value: unknown) {
  const stored = JSON.stringify(value);
  return {
    matchId,
    kind: "match" as const,
    sourceKey: null,
    digest: "digest",
    capturedAt: "2026-11-21 00:00:00",
    // The lake stores the document as JSON text.
    document: z.json().parse(JSON.parse(stored)),
  };
}

function setup(overrides: Partial<MatchReviewReads>) {
  const reads: MatchReviewReads = {
    documents: vi.fn(() => Promise.resolve([])),
    isCrawlOnly: vi.fn(() => Promise.resolve(false)),
    askerPuuids: vi.fn(() => Promise.resolve(new Set<string>())),
    ownRecording: vi.fn(() => Promise.resolve(null)),
    ...overrides,
  };
  const reviewed: ReviewedMatch[] = [];
  const tools = createMatchReviewTools(
    {
      abortSignal: new AbortController().signal,
      requesterId,
      guildIds: [],
    },
    passthroughTracker,
    (review) => reviewed.push(review),
    reads,
  );
  const review = async (input: {
    matchId: RiotMatchId;
    participantId: number | null;
    offset: number;
  }): Promise<unknown> => {
    const execute = tools.review_match.execute;
    if (execute === undefined) throw new Error("review_match has no execute");
    return await execute(input, OPTIONS);
  };
  return { reads, reviewed, review };
}

describe("review_match on an end-of-game record", () => {
  const matchId = endOfGame.metadata.matchId;

  test("reviews the asker's own game with their recording, labelled as having no timeline", async () => {
    const recording = LiveGameRecordingPayloadSchema.parse(fixtures.recording);
    const { reads, reviewed, review } = setup({
      documents: () => Promise.resolve([document(matchId, endOfGame)]),
      askerPuuids: () => Promise.resolve(new Set([playerPuuid])),
      ownRecording: vi.fn(() => Promise.resolve(recording)),
    });
    const result = await review({ matchId, participantId: null, offset: 0 });
    expect(result).toMatchObject({
      ok: true,
      coverage: {
        record: "end_of_game",
        riotTimeline: false,
        liveRecording: true,
      },
      player: { champion: endOfGamePlayer.championName },
      liveRecording: { included: true },
    });
    expect(reads.ownRecording).toHaveBeenCalledWith({
      requesterId,
      matchId,
      puuid: playerPuuid,
    });
    // A match card, but no loadout card: that keys on participant numbers.
    expect(reviewed).toEqual([
      { matchId, participantId: null, puuid: null, cardSupported: true },
    ]);
  });

  test("a participant number does not apply to it", async () => {
    const { review } = setup({
      documents: () => Promise.resolve([document(matchId, endOfGame)]),
      askerPuuids: () => Promise.resolve(new Set([playerPuuid])),
    });
    expect(
      await review({ matchId, participantId: 3, offset: 0 }),
    ).toMatchObject({
      ok: true,
      coverage: { record: "end_of_game", liveRecording: false },
    });
  });

  test("is refused when the asker did not play in the game", async () => {
    const { reads, reviewed, review } = setup({
      documents: () => Promise.resolve([document(matchId, endOfGame)]),
      askerPuuids: () => Promise.resolve(new Set(["q".repeat(78)])),
    });
    expect(await review({ matchId, participantId: null, offset: 0 })).toEqual(
      END_OF_GAME_NOT_A_PLAYER_REFUSAL,
    );
    // Someone else's recording is never read.
    expect(reads.ownRecording).not.toHaveBeenCalled();
    expect(reviewed).toEqual([]);
  });
});

describe("review_match refusals that do not change", () => {
  test("a crawled game is refused for review", async () => {
    const matchId = endOfGame.metadata.matchId;
    const { reads, reviewed, review } = setup({
      isCrawlOnly: vi.fn(() => Promise.resolve(true)),
    });
    expect(await review({ matchId, participantId: null, offset: 0 })).toEqual(
      CRAWLED_MATCH_REVIEW_REFUSAL,
    );
    expect(reads.askerPuuids).not.toHaveBeenCalled();
    expect(reviewed).toEqual([]);
  });

  test("a complete match still gets the timeline review's roster", async () => {
    const match = RawMatchSchema.parse(
      await Bun.file("../../testdata/rift.json").json(),
    );
    const matchId = match.metadata.matchId;
    const { reads, review } = setup({
      documents: () => Promise.resolve([document(matchId, match)]),
    });
    const result = await review({ matchId, participantId: null, offset: 0 });
    expect(result).toMatchObject({ ok: true });
    expect(result).toHaveProperty("participants");
    expect(result).not.toHaveProperty("coverage");
    expect(reads.askerPuuids).not.toHaveBeenCalled();
  });
});
