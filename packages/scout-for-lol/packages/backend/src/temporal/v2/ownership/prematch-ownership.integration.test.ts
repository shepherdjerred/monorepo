import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type * as DatabaseModule from "#src/database/index.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("scout-prematch-ownership");

// The router claims the pass through the process client, as the Activity
// does in production. The V2 discovery module is imported for its v1 guard
// alone; its Discord and Riot edges are never reached.
vi.mock("#src/discord/utils/guild-membership.ts", () => ({
  getActiveServerIds: () => new Set<string>(),
}));
vi.mock("#src/league/api/spectator.ts", () => ({
  getActiveGame: () => Promise.reject(new Error("not reached")),
}));
vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

const {
  claimPrematchPass,
  PREMATCH_PASS_STALE_AFTER_MS,
  releasePrematchPassClaimV2,
  renewPrematchPassClaimV2,
  resolvePrematchPassOwnerV2,
} = await import("#src/temporal/v2/ownership/prematch-ownership.ts");
const { listLiveActiveGameMatchIds } =
  await import("#src/league/tasks/prematch/active-game-queries.ts");
const { withoutV1AnnouncedGames } =
  await import("#src/temporal/v2/prematch/prematch-reads.ts");
const { ScoutPrematchGameRefSchema } =
  await import("@scout-for-lol/temporal/contracts-v2");

const FLAG = "scout_v2_prematch_ownership_enabled";
const BOT_STATE_ID = 1;
const SCHEDULED_RUN = "scheduled-run";
const OPERATOR_RUN = "operator-run";
const SCHEDULED = new Date("2026-09-25T06:00:00.000Z");
const OPERATOR = new Date("2026-09-25T06:00:10.000Z");

function turnV2OwnershipOn(): void {
  clearFlagOverrides(FLAG);
  addFlagOverride(FLAG, true, {});
}

async function passRow() {
  return await prisma.botState.findUnique({ where: { id: BOT_STATE_ID } });
}

async function heldBy(): Promise<string | null | undefined> {
  const row = await passRow();
  return row?.prematchPassHolder;
}

async function lastRenewedAt(): Promise<Date | null | undefined> {
  const row = await passRow();
  return row?.prematchPassRenewedAt;
}

function resolveAs(holder: string, claimedAt: Date, now: Date = claimedAt) {
  return resolvePrematchPassOwnerV2({ holder, claimedAt, now });
}

beforeEach(async () => {
  await prisma.botState.deleteMany({});
  await prisma.activeGame.deleteMany({});
});

afterEach(() => {
  resetFlagOverrides(FLAG);
});

describe("resolvePrematchPassOwnerV2", () => {
  test("leaves the pass with v1 by default, under a claim", async () => {
    await expect(resolveAs(SCHEDULED_RUN, SCHEDULED)).resolves.toEqual({
      decision: "run-v1",
      holder: SCHEDULED_RUN,
      claimedAt: SCHEDULED.toISOString(),
    });
    const claimed = await passRow();
    expect(claimed?.prematchPassHolder).toBe(SCHEDULED_RUN);
    expect(claimed?.prematchPassClaimedAt).toEqual(SCHEDULED);
    // The post-match poll shares the row and must be left exactly as it was.
    expect(claimed?.pollStatus).toBe("never");
    expect(claimed?.pollStartedAt).toBeNull();
  });

  test("hands the pass to V2 when the flag is on, under the same claim", async () => {
    turnV2OwnershipOn();

    await expect(resolveAs(SCHEDULED_RUN, SCHEDULED)).resolves.toEqual({
      decision: "run-v2",
      holder: SCHEDULED_RUN,
      claimedAt: SCHEDULED.toISOString(),
    });
    expect(await heldBy()).toBe(SCHEDULED_RUN);
  });

  test("lets exactly one of two concurrent passes proceed", async () => {
    // The overlap the Schedule's SKIP cannot stop: a scheduled pass and an
    // operator's both reach the router with nothing holding the pass.
    const decisions = await Promise.all([
      resolveAs(SCHEDULED_RUN, SCHEDULED),
      resolveAs(OPERATOR_RUN, OPERATOR),
    ]);

    const proceeding = decisions.filter(
      (decision) => decision.decision === "run-v1",
    );
    const deferred = decisions.filter(
      (decision) => decision.decision === "defer",
    );
    expect(proceeding).toHaveLength(1);
    expect(deferred).toHaveLength(1);
    const winner = proceeding[0];
    if (winner?.decision !== "run-v1") throw new Error("no winner");
    expect(deferred[0]).toEqual({
      decision: "defer",
      heldSince: winner.claimedAt,
    });
    expect(await heldBy()).toBe(winner.holder);
  });

  test("never lets V2 start while the last v1 pass still holds the claim", async () => {
    // The flip itself: v1 owns a pass in flight, the operator turns V2 on,
    // and the next tick arrives before v1 finishes. It must wait, not run V2
    // discovery beside v1's detection.
    await resolveAs(SCHEDULED_RUN, SCHEDULED);
    turnV2OwnershipOn();

    await expect(resolveAs(OPERATOR_RUN, OPERATOR)).resolves.toEqual({
      decision: "defer",
      heldSince: SCHEDULED.toISOString(),
    });

    await expect(
      releasePrematchPassClaimV2({ holder: SCHEDULED_RUN }),
    ).resolves.toEqual({ outcome: "released" });
    await expect(resolveAs(OPERATOR_RUN, OPERATOR)).resolves.toMatchObject({
      decision: "run-v2",
      holder: OPERATOR_RUN,
    });
  });

  test("lets a retried ownership Activity re-acquire its own claim", async () => {
    await resolveAs(SCHEDULED_RUN, SCHEDULED);

    await expect(
      resolveAs(SCHEDULED_RUN, SCHEDULED, OPERATOR),
    ).resolves.toMatchObject({ decision: "run-v1", holder: SCHEDULED_RUN });
  });

  test("frees a claim nothing renewed once it is past the bound", async () => {
    await resolveAs(SCHEDULED_RUN, SCHEDULED);
    const justInside = new Date(
      SCHEDULED.getTime() + PREMATCH_PASS_STALE_AFTER_MS - 1,
    );
    const pastBound = new Date(
      SCHEDULED.getTime() + PREMATCH_PASS_STALE_AFTER_MS + 1,
    );

    await expect(
      resolveAs(OPERATOR_RUN, justInside, justInside),
    ).resolves.toMatchObject({ decision: "defer" });
    await expect(
      resolveAs(OPERATOR_RUN, pastBound, pastBound),
    ).resolves.toMatchObject({ decision: "run-v1", holder: OPERATOR_RUN });
    const taken = await passRow();
    expect(taken?.prematchPassHolder).toBe(OPERATOR_RUN);
    expect(taken?.prematchPassRenewedAt).toBeNull();
  });

  test("keeps a renewed claim live past the bound its start alone would set", async () => {
    await resolveAs(SCHEDULED_RUN, SCHEDULED);
    const renewedAt = new Date(
      SCHEDULED.getTime() + PREMATCH_PASS_STALE_AFTER_MS - 1000,
    );
    await prisma.botState.update({
      where: { id: BOT_STATE_ID },
      data: { prematchPassRenewedAt: renewedAt },
    });
    const pastStartBound = new Date(
      SCHEDULED.getTime() + PREMATCH_PASS_STALE_AFTER_MS + 1000,
    );

    await expect(
      resolveAs(OPERATOR_RUN, pastStartBound, pastStartBound),
    ).resolves.toEqual({
      decision: "defer",
      heldSince: SCHEDULED.toISOString(),
    });
  });
});

describe("renewing and releasing the prematch pass", () => {
  test("renews and releases only the holder's own claim", async () => {
    await resolveAs(SCHEDULED_RUN, SCHEDULED);

    await expect(
      renewPrematchPassClaimV2({ holder: OPERATOR_RUN, renewedAt: OPERATOR }),
    ).resolves.toEqual({ outcome: "not-held" });
    await expect(
      releasePrematchPassClaimV2({ holder: OPERATOR_RUN }),
    ).resolves.toEqual({ outcome: "not-held" });
    expect(await heldBy()).toBe(SCHEDULED_RUN);

    await expect(
      renewPrematchPassClaimV2({ holder: SCHEDULED_RUN, renewedAt: OPERATOR }),
    ).resolves.toEqual({ outcome: "renewed" });
    expect(await lastRenewedAt()).toEqual(OPERATOR);

    await expect(
      releasePrematchPassClaimV2({ holder: SCHEDULED_RUN }),
    ).resolves.toEqual({ outcome: "released" });
    const released = await passRow();
    expect(released?.prematchPassHolder).toBeNull();
    expect(released?.prematchPassClaimedAt).toBeNull();
    expect(released?.prematchPassRenewedAt).toBeNull();
  });

  test("never lets a taken-over router renew or free its successor's claim", async () => {
    await resolveAs(SCHEDULED_RUN, SCHEDULED);
    const pastBound = new Date(
      SCHEDULED.getTime() + PREMATCH_PASS_STALE_AFTER_MS + 1,
    );
    await claimPrematchPass({
      holder: OPERATOR_RUN,
      claimedAt: pastBound,
      now: pastBound,
    });

    await expect(
      renewPrematchPassClaimV2({ holder: SCHEDULED_RUN, renewedAt: pastBound }),
    ).resolves.toEqual({ outcome: "not-held" });
    await expect(
      releasePrematchPassClaimV2({ holder: SCHEDULED_RUN }),
    ).resolves.toEqual({ outcome: "not-held" });
    expect(await heldBy()).toBe(OPERATOR_RUN);
  });
});

const NOW = new Date("2026-09-25T06:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function ref(gameId: string) {
  return ScoutPrematchGameRefSchema.parse({
    puuid: "a".repeat(78),
    platform: "NA1",
    gameId,
  });
}

async function seedV1Games(): Promise<void> {
  // One game v1 is announcing now, and one whose row outlived its game.
  const now = NOW;
  const hour = HOUR;
  await prisma.activeGame.createMany({
    data: [
      {
        gameId: 9101n,
        prematchMatchId: "NA1_9101",
        trackedPuuids: "[]",
        detectedAt: new Date(now.getTime() - hour),
        expiresAt: new Date(now.getTime() + hour),
      },
      {
        gameId: 9102n,
        prematchMatchId: "NA1_9102",
        trackedPuuids: "[]",
        detectedAt: new Date(now.getTime() - 4 * hour),
        expiresAt: new Date(now.getTime() - hour),
      },
    ],
  });
}

describe("the v1 guard on V2 discovery", () => {
  test("names only the games v1 is still tracking as live", async () => {
    await seedV1Games();

    await expect(
      listLiveActiveGameMatchIds(["NA1_9101", "NA1_9102", "NA1_9103"], NOW),
    ).resolves.toEqual(new Set(["NA1_9101"]));
    await expect(listLiveActiveGameMatchIds([], NOW)).resolves.toEqual(
      new Set(),
    );
  });

  test("leaves a game v1 is announcing to v1 after the flag flips on", async () => {
    // v1 announced NA1_9101 a minute before the flip. The first V2 pass must
    // not start a capture for it, or it would mint intents for any channel
    // whose fail-open v1 delivery record never landed.
    await seedV1Games();

    await expect(
      withoutV1AnnouncedGames([ref("9101"), ref("9102"), ref("9103")], NOW),
    ).resolves.toEqual([ref("9102"), ref("9103")]);
  });
});
