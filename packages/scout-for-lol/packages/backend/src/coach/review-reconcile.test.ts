import { describe, expect, test } from "vitest";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { DiscordAccountId } from "@scout-for-lol/data";
import type { ScoutCoachReviewInput } from "@scout-for-lol/temporal";
import {
  COACH_REVIEW_RECONCILE_BATCH,
  COACH_REVIEW_RECONCILE_WINDOW_MS,
  reconcileCoachReviews,
  type CoachReviewSweepClient,
} from "./review-reconcile.ts";

type Pair = Omit<ScoutCoachReviewInput, "stage">;
const NOW = new Date("2026-11-19T12:00:00.000Z");
const OWNER = DiscordAccountIdSchema.parse("123456789012345678");
const OTHER = DiscordAccountIdSchema.parse("223456789012345678");
const match = (id: string): RiotMatchId => RiotMatchIdSchema.parse(id);

type Row = {
  platformId: string | null;
  gameId: string | null;
  owner: DiscordAccountId;
};

function world(options: {
  recordings: Row[];
  artifacts?: { ownerId: DiscordAccountId; matchId: RiotMatchId }[];
  outcomes?: Record<string, "started" | "not_ready" | Error>;
}) {
  const triggered: Pair[] = [];
  const queries: unknown[] = [];
  const client: CoachReviewSweepClient = {
    scoutClientObservation: {
      findMany: (query) => {
        queries.push(query);
        return Promise.resolve(
          options.recordings.map((row) => ({
            platformId: row.platformId,
            gameId: row.gameId,
            device: { ownerId: row.owner },
          })),
        );
      },
    },
    scoutCoachArtifact: {
      findMany: () => Promise.resolve(options.artifacts ?? []),
    },
  };
  const deps = {
    client,
    now: () => NOW,
    trigger: (input: Pair) => {
      triggered.push(input);
      const outcome =
        options.outcomes?.[`${input.ownerId}:${input.matchId}`] ?? "started";
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
  };
  return { deps, triggered, queries };
}

describe("reconcileCoachReviews", () => {
  test("starts the review for a recorded game that has no artifact", async () => {
    const { deps, triggered } = world({
      recordings: [{ platformId: "NA1", gameId: "5123456789", owner: OWNER }],
    });
    await expect(reconcileCoachReviews(deps, "review")).resolves.toEqual({
      considered: 1,
      alreadyReviewed: 0,
      started: 1,
      notReady: 0,
    });
    expect(triggered).toEqual([
      { ownerId: OWNER, matchId: match("NA1_5123456789") },
    ]);
  });

  test("leaves a game whose review already began alone", async () => {
    const { deps, triggered } = world({
      recordings: [{ platformId: "NA1", gameId: "5123456789", owner: OWNER }],
      artifacts: [{ ownerId: OWNER, matchId: match("NA1_5123456789") }],
    });
    await expect(reconcileCoachReviews(deps, "review")).resolves.toMatchObject({
      alreadyReviewed: 1,
      started: 0,
    });
    expect(triggered).toEqual([]);
  });

  test("an artifact for another owner does not hide this owner's game", async () => {
    const { deps, triggered } = world({
      recordings: [
        { platformId: "NA1", gameId: "5123456789", owner: OWNER },
        { platformId: "NA1", gameId: "5123456789", owner: OTHER },
      ],
      artifacts: [{ ownerId: OTHER, matchId: match("NA1_5123456789") }],
    });
    await reconcileCoachReviews(deps, "review");
    expect(triggered).toEqual([
      { ownerId: OWNER, matchId: match("NA1_5123456789") },
    ]);
  });

  test("two recordings of one game are one start", async () => {
    const { deps, triggered } = world({
      recordings: [
        { platformId: "NA1", gameId: "5123456789", owner: OWNER },
        { platformId: "NA1", gameId: "5123456789", owner: OWNER },
      ],
    });
    await reconcileCoachReviews(deps, "review");
    expect(triggered).toHaveLength(1);
  });

  test("counts a game whose evidence is not resolved yet as not ready", async () => {
    const { deps } = world({
      recordings: [{ platformId: "NA1", gameId: "5123456789", owner: OWNER }],
      outcomes: { [`${OWNER}:NA1_5123456789`]: "not_ready" },
    });
    await expect(reconcileCoachReviews(deps, "review")).resolves.toMatchObject({
      started: 0,
      notReady: 1,
    });
  });

  test("ignores a recording that names no game", async () => {
    const { deps, triggered } = world({
      recordings: [
        { platformId: null, gameId: "5123456789", owner: OWNER },
        { platformId: "NA1", gameId: null, owner: OWNER },
      ],
    });
    await expect(reconcileCoachReviews(deps, "review")).resolves.toMatchObject({
      considered: 0,
    });
    expect(triggered).toEqual([]);
  });

  test("tries every game, then fails loudly when one start failed", async () => {
    const { deps, triggered } = world({
      recordings: [
        { platformId: "NA1", gameId: "1", owner: OWNER },
        { platformId: "NA1", gameId: "2", owner: OWNER },
      ],
      outcomes: { [`${OWNER}:NA1_1`]: new Error("Temporal is unavailable") },
    });
    await expect(reconcileCoachReviews(deps, "review")).rejects.toThrow(
      "1 post-game review start(s) failed",
    );
    expect(triggered.map((entry) => entry.matchId)).toEqual(["NA1_1", "NA1_2"]);
  });

  test("reads only recent, accepted recordings, bounded", async () => {
    const { deps, queries } = world({ recordings: [] });
    await reconcileCoachReviews(deps, "review");
    expect(queries).toEqual([
      expect.objectContaining({
        where: expect.objectContaining({
          kind: "live_game_recording",
          disposition: "ACCEPTED",
          receivedAt: {
            gte: new Date(NOW.getTime() - COACH_REVIEW_RECONCILE_WINDOW_MS),
          },
        }),
        take: COACH_REVIEW_RECONCILE_BATCH,
      }),
    ]);
  });
});
