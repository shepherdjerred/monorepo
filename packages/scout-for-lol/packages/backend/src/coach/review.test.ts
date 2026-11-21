import { expect, test } from "vitest";
import {
  LeaguePuuidSchema,
  type LeaguePuuid,
} from "@scout-for-lol/domain/identity/league-account.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { ExploreActiveRun } from "@scout-for-lol/data";
import {
  readCoachReview,
  readCoachReviewByGame,
  readReviewEvidence,
  reviewReady,
  settleCoachReview,
  splitMatchId,
  startCoachReview,
  type CoachReviewClient,
  type CoachReviewDependencies,
} from "./review.ts";

const OWNER = "123456789012345678";
const MATCH = "NA1_5123456789";
const PUUID = LeaguePuuidSchema.parse("a".repeat(78));
const RUN: ExploreActiveRun = {
  runId: "3d8f1a62-7b4c-4e29-9a05-c61e2f7b8d43",
  conversationId: "7c3e5a91-2b64-4d0f-8e17-5a9c4b2d6f30",
  questionMessageId: "e5b7c9d1-3f24-4a6b-8c8e-0d2f4a6b8c01",
  leafIdAtStart: null,
  versionCountAtStart: 0,
  startedAt: "2026-11-19T00:00:00.000Z",
};

type Artifact = {
  ownerId: string;
  matchId: RiotMatchId;
  kind: string;
  status: string;
  runId: string | null;
  conversationId: string | null;
  createdAt: Date;
};

type World = {
  artifacts: Artifact[];
  turns: { runId: string; conversationId: string }[];
  recordings: { deviceId: string; localPuuid: string | null; owner: string }[];
  verified: { puuid: LeaguePuuid }[];
  participants: string[] | null;
  coach: boolean;
  access: boolean;
  starts: Parameters<CoachReviewDependencies["startRun"]>[];
  quotaRefused: boolean;
  outcome: "succeeded" | "failed" | null;
  queries: unknown[];
};

function world(overrides: Partial<World> = {}): World {
  return {
    artifacts: [],
    turns: [],
    recordings: [{ deviceId: "device-1", localPuuid: PUUID, owner: OWNER }],
    verified: [{ puuid: PUUID }],
    participants: [PUUID],
    coach: true,
    access: true,
    starts: [],
    quotaRefused: false,
    outcome: null,
    queries: [],
    ...overrides,
  };
}

class QuotaRefused extends Error {}

function dependencies(state: World): CoachReviewDependencies {
  const find = (key: {
    ownerId: string;
    matchId: RiotMatchId;
    kind: string;
  }): Artifact | null =>
    state.artifacts.find(
      (row) =>
        row.ownerId === key.ownerId &&
        row.matchId === key.matchId &&
        row.kind === key.kind,
    ) ?? null;
  const client: CoachReviewClient = {
    scoutCoachArtifact: {
      findUnique: ({ where }) =>
        Promise.resolve(find(where.ownerId_matchId_kind)),
      upsert: ({ where, create }) => {
        if (find(where.ownerId_matchId_kind) === null) {
          state.artifacts.push({
            ...create,
            runId: null,
            conversationId: null,
            createdAt: new Date("2026-11-19T00:00:00.000Z"),
          });
        }
        return Promise.resolve();
      },
      update: ({ where, data }) => {
        const row = find(where.ownerId_matchId_kind);
        if (row === null) throw new Error("missing artifact");
        Object.assign(row, data);
        return Promise.resolve(row);
      },
      updateMany: ({ where, data }) => {
        for (const row of state.artifacts) {
          if (find(where) === row && row.status === where.status) {
            Object.assign(row, data);
          }
        }
        return Promise.resolve({ count: 1 });
      },
    },
    scoutCoachTurn: {
      findFirst: () => Promise.resolve(state.turns[0] ?? null),
    },
    scoutClientObservation: {
      findMany: (query) => {
        state.queries.push(query);
        return Promise.resolve(
          state.recordings
            .filter((row) => row.owner === OWNER)
            .map(({ deviceId, localPuuid }) => ({ deviceId, localPuuid })),
        );
      },
    },
    riotAccountPreference: {
      findMany: () => Promise.resolve(state.verified),
    },
  };
  return {
    client,
    guildIds: () => Promise.resolve(state.access ? [] : null),
    coachEnabled: () => Promise.resolve(state.coach),
    matchParticipants: () => Promise.resolve(state.participants),
    startRun: (...args) => {
      state.starts.push(args);
      return state.quotaRefused
        ? Promise.reject(new QuotaRefused("quota"))
        : Promise.resolve(RUN);
    },
    durableOutcome: () => Promise.resolve(state.outcome),
    isQuotaRefusal: (error) => error instanceof QuotaRefused,
  };
}

const input = { stage: "dev", ownerId: OWNER, matchId: MATCH } as const;
const owner = DiscordAccountIdSchema.parse(OWNER);
const matchId = RiotMatchIdSchema.parse(MATCH);

test("splits a Riot match ID into platform and game", () => {
  expect(splitMatchId(MATCH)).toEqual({
    platform: "NA1",
    gameId: "5123456789",
  });
  expect(splitMatchId("nonsense")).toBeNull();
});

test("evidence is ready only with an owned recording and a resolved match the owner played", async () => {
  expect(await readReviewEvidence(dependencies(world()), owner, MATCH)).toEqual(
    {
      kind: "ready",
      deviceId: "device-1",
    },
  );
  expect(
    await readReviewEvidence(
      dependencies(world({ recordings: [] })),
      owner,
      MATCH,
    ),
  ).toEqual({ kind: "skipped", reason: "no_recording" });
  expect(
    await readReviewEvidence(
      dependencies(world({ participants: null })),
      owner,
      MATCH,
    ),
  ).toEqual({ kind: "skipped", reason: "evidence_unresolved" });
  expect(
    await readReviewEvidence(
      dependencies(world({ participants: ["b".repeat(78)] })),
      owner,
      MATCH,
    ),
  ).toEqual({ kind: "skipped", reason: "not_a_participant" });
});

test("a recording from an account the owner has not verified is not theirs", async () => {
  const state = world({ verified: [] });
  expect(await readReviewEvidence(dependencies(state), owner, MATCH)).toEqual({
    kind: "skipped",
    reason: "no_recording",
  });
});

test("the evidence query is scoped to the owner's own devices and this game", async () => {
  const state = world();
  await readReviewEvidence(dependencies(state), owner, MATCH);
  expect(state.queries[0]).toMatchObject({
    where: {
      kind: "live_game_recording",
      gameId: "5123456789",
      platformId: "NA1",
      device: { ownerId: OWNER },
    },
  });
});

test("the trigger is ready only when the coach is on and both inputs exist", async () => {
  expect(await reviewReady(dependencies(world()), owner, MATCH)).toBe(true);
  expect(
    await reviewReady(dependencies(world({ coach: false })), owner, MATCH),
  ).toBe(false);
  expect(
    await reviewReady(
      dependencies(world({ participants: null })),
      owner,
      MATCH,
    ),
  ).toBe(false);
});

test("starts one app_postgame turn that carries only the postgame section", async () => {
  const state = world();
  const result = await startCoachReview(dependencies(state), input);
  expect(result).toEqual({ outcome: "started", runId: RUN.runId });
  expect(state.starts).toHaveLength(1);
  const [, request, , coach] = state.starts[0] ?? [];
  expect(request?.question).not.toBeNull();
  expect(coach?.initiation).toBe("app_postgame");
  expect(coach?.gameKey).toBe(MATCH);
  expect(coach?.deviceId).toBe("device-1");
  expect(coach?.projection.accepted).toEqual(["postgame"]);
  expect(coach?.projection.context).toEqual({ postgame: { matchId: MATCH } });
  expect(coach?.flags.liveAnswersEnabled).toBe(false);
  expect(state.artifacts[0]).toMatchObject({
    status: "pending",
    runId: RUN.runId,
    conversationId: RUN.conversationId,
  });
});

test("starting twice starts one turn", async () => {
  const state = world();
  const deps = dependencies(state);
  await startCoachReview(deps, input);
  expect(await startCoachReview(deps, input)).toEqual({
    outcome: "started",
    runId: RUN.runId,
  });
  expect(state.starts).toHaveLength(1);
});

test("a turn that started before a crash is found by its audit row, not started again", async () => {
  const state = world({
    turns: [{ runId: RUN.runId, conversationId: RUN.conversationId }],
  });
  expect(await startCoachReview(dependencies(state), input)).toEqual({
    outcome: "started",
    runId: RUN.runId,
  });
  expect(state.starts).toHaveLength(0);
  expect(state.artifacts[0]?.conversationId).toBe(RUN.conversationId);
});

test("a game the owner did not record, or a disabled coach, starts nothing", async () => {
  const unrecorded = world({ recordings: [] });
  expect(await startCoachReview(dependencies(unrecorded), input)).toEqual({
    outcome: "skipped",
    reason: "no_recording",
  });
  const disabled = world({ coach: false });
  expect(await startCoachReview(dependencies(disabled), input)).toEqual({
    outcome: "skipped",
    reason: "coach_disabled",
  });
  const closed = world({ access: false });
  expect(await startCoachReview(dependencies(closed), input)).toEqual({
    outcome: "skipped",
    reason: "no_explore_access",
  });
  for (const state of [unrecorded, disabled, closed]) {
    expect(state.starts).toHaveLength(0);
    expect(state.artifacts).toHaveLength(0);
  }
});

test("an Explore quota refusal is recorded as declined and not retried", async () => {
  const state = world({ quotaRefused: true });
  const deps = dependencies(state);
  expect(await startCoachReview(deps, input)).toEqual({ outcome: "declined" });
  expect(state.artifacts[0]?.status).toBe("declined");
  expect(await startCoachReview(deps, input)).toEqual({
    outcome: "settled",
    status: "declined",
  });
  expect(state.starts).toHaveLength(1);
});

test("an unexpected start failure is raised for the activity retry", async () => {
  const state = world();
  const deps = dependencies(state);
  const failing: CoachReviewDependencies = {
    ...deps,
    startRun: () => Promise.reject(new Error("temporal down")),
  };
  await expect(startCoachReview(failing, input)).rejects.toThrow(
    "temporal down",
  );
});

test("settling records where the turn ended, once", async () => {
  const state = world();
  const deps = dependencies(state);
  await startCoachReview(deps, input);
  const settle = { ...input, runId: RUN.runId, giveUp: false };
  expect(await settleCoachReview(deps, settle)).toBe("pending");
  state.outcome = "succeeded";
  expect(await settleCoachReview(deps, settle)).toBe("ready");
  expect(state.artifacts[0]?.status).toBe("ready");
  state.outcome = "failed";
  await settleCoachReview(deps, settle);
  expect(state.artifacts[0]?.status).toBe("ready");
});

test("a turn still unresolved at the last poll fails", async () => {
  const state = world();
  const deps = dependencies(state);
  await startCoachReview(deps, input);
  expect(
    await settleCoachReview(deps, { ...input, runId: RUN.runId, giveUp: true }),
  ).toBe("failed");
  expect(state.artifacts[0]?.status).toBe("failed");
});

test("the desktop reads the review by owner and match, nothing else's", async () => {
  const state = world();
  const deps = dependencies(state);
  expect(await readCoachReview(deps.client, owner, matchId)).toBeNull();
  await startCoachReview(deps, input);
  expect(await readCoachReview(deps.client, owner, matchId)).toEqual({
    matchId: MATCH,
    status: "pending",
    conversationId: RUN.conversationId,
    createdAt: "2026-11-19T00:00:00.000Z",
  });
  expect(
    await readCoachReview(
      deps.client,
      DiscordAccountIdSchema.parse("999999999999999999"),
      matchId,
    ),
  ).toBeNull();
});

test("a review read by game id is named only from the caller's own capture", async () => {
  const state = world();
  const deps = dependencies(state);
  await startCoachReview(deps, input);
  const other = DiscordAccountIdSchema.parse("999999999999999999");
  // Accepted observations of game 5123456789: the owner's, and another
  // owner's, who played the same game.
  const observations = [
    { ownerId: owner, gameId: "5123456789", platformId: "na1" },
    { ownerId: other, gameId: "5123456789", platformId: "NA1" },
  ];
  const queries: unknown[] = [];
  const client = {
    scoutCoachArtifact: deps.client.scoutCoachArtifact,
    scoutClientObservation: {
      findFirst: (query: {
        where: { gameId: string; device: { ownerId: string } };
      }) => {
        queries.push(query);
        const row = observations.find(
          (observation) =>
            observation.gameId === query.where.gameId &&
            observation.ownerId === query.where.device.ownerId,
        );
        return Promise.resolve(
          row === undefined ? null : { platformId: row.platformId },
        );
      },
    },
  };
  expect(await readCoachReviewByGame(client, owner, "5123456789")).toEqual({
    matchId: MATCH,
    status: "pending",
    conversationId: RUN.conversationId,
    createdAt: "2026-11-19T00:00:00.000Z",
  });
  expect(queries[0]).toEqual({
    where: {
      gameId: "5123456789",
      disposition: "ACCEPTED",
      platformId: { not: null },
      device: { ownerId: owner },
    },
    select: { platformId: true },
    orderBy: { capturedAt: "asc" },
  });
  // Another owner who captured the same game names the same match from their
  // own capture, but reads nothing: the review is this owner's.
  expect(await readCoachReviewByGame(client, other, "5123456789")).toBeNull();
  // An owner with no capture of the game reads nothing either.
  expect(
    await readCoachReviewByGame(
      client,
      DiscordAccountIdSchema.parse("888888888888888888"),
      "5123456789",
    ),
  ).toBeNull();
  // A game this owner never captured answers like a game with no review.
  expect(await readCoachReviewByGame(client, owner, "42")).toBeNull();
});
