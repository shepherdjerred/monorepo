import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type * as DatabaseModule from "#src/database/index.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("scout-postmatch-ownership");

// The handoff claims the poll through the process client, as the Activity
// does in production.
vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

const {
  claimPostMatchPoll,
  markPostMatchPollCompleted,
  POST_MATCH_POLL_STALE_AFTER_MS,
} = await import("#src/league/tasks/recovery/app-state.ts");
const {
  DelegatedPostMatchDiscoverySkippedError,
  discoverDelegatedPostMatchIntents,
  releasePostMatchPollClaimV2,
  renewPostMatchPollClaimV2,
  resolvePostMatchDiscoveryOwnerV2,
} = await import("#src/temporal/v2/postmatch-ownership.ts");
const { beginPollingRun, endPollingRun } =
  await import("#src/league/tasks/postmatch/poll-ownership.ts");

const FLAG = "scout_v2_postmatch_ownership_enabled";
const BOT_STATE_ID = 1;
const SCHEDULED = new Date("2026-09-23T10:00:00.000Z");
const OPERATOR = new Date("2026-09-23T10:00:20.000Z");

function turnV2OwnershipOff(): void {
  clearFlagOverrides(FLAG);
  addFlagOverride(FLAG, false, {});
}

async function pollRow() {
  return await prisma.botState.findUnique({ where: { id: BOT_STATE_ID } });
}

beforeEach(async () => {
  await prisma.botState.deleteMany({});
});

afterEach(() => {
  resetFlagOverrides(FLAG);
});

describe("resolvePostMatchDiscoveryOwnerV2", () => {
  test("keeps V2 as the owner by default, and takes no claim for it", async () => {
    await expect(
      resolvePostMatchDiscoveryOwnerV2({ claimAt: SCHEDULED }),
    ).resolves.toEqual({ decision: "run-v2" });
    // V2 discovery takes its own claim; the gate must not take one for it.
    expect(await pollRow()).toBeNull();
  });

  test("claims the poll for v1 before handing the pass over", async () => {
    turnV2OwnershipOff();

    await expect(
      resolvePostMatchDiscoveryOwnerV2({ claimAt: SCHEDULED }),
    ).resolves.toEqual({
      decision: "delegate-v1",
      pollOwner: SCHEDULED.toISOString(),
    });
    const claimed = await pollRow();
    expect(claimed?.pollStatus).toBe("running");
    expect(claimed?.pollStartedAt).toEqual(SCHEDULED);

    // The v1 child re-presents the same instant and re-acquires the claim,
    // while a V2 discovery starting meanwhile is refused.
    expect(await claimPostMatchPoll({ startedAt: SCHEDULED })).toEqual({
      outcome: "claimed",
      owner: { startedAt: SCHEDULED },
    });
    expect(await claimPostMatchPoll({ startedAt: OPERATOR })).toEqual({
      outcome: "held",
      since: SCHEDULED,
    });
  });

  test("lets exactly one of two concurrent handoffs delegate", async () => {
    // The overlap SKIP cannot stop: a scheduled run and an operator's run
    // both reach the gate with the flag off and nothing holding the poll.
    turnV2OwnershipOff();

    const decisions = await Promise.all([
      resolvePostMatchDiscoveryOwnerV2({ claimAt: SCHEDULED }),
      resolvePostMatchDiscoveryOwnerV2({ claimAt: OPERATOR }),
    ]);

    const delegated = decisions.filter(
      (decision) => decision.decision === "delegate-v1",
    );
    const deferred = decisions.filter(
      (decision) => decision.decision === "defer-v1",
    );
    expect(delegated).toHaveLength(1);
    expect(deferred).toHaveLength(1);
    const winner = delegated[0];
    if (winner?.decision !== "delegate-v1") throw new Error("no winner");
    expect(deferred[0]).toEqual({
      decision: "defer-v1",
      pollHeldSince: winner.pollOwner,
    });
    const standing = await pollRow();
    expect(standing?.pollStartedAt?.toISOString()).toBe(winner.pollOwner);
  });

  test("defers v1 while a V2 run still holds its poll claim", async () => {
    turnV2OwnershipOff();
    await claimPostMatchPoll({ startedAt: SCHEDULED });

    await expect(
      resolvePostMatchDiscoveryOwnerV2({ claimAt: OPERATOR }),
    ).resolves.toEqual({
      decision: "defer-v1",
      pollHeldSince: SCHEDULED.toISOString(),
    });
    // The held claim is untouched.
    const standing = await pollRow();
    expect(standing?.pollStartedAt).toEqual(SCHEDULED);
  });

  test("delegates once the last poll has closed", async () => {
    turnV2OwnershipOff();
    const claim = await claimPostMatchPoll({ startedAt: SCHEDULED });
    if (claim.outcome !== "claimed") throw new Error("expected a claim");
    await markPostMatchPollCompleted({
      completedAt: OPERATOR,
      evidenceComplete: true,
      owner: claim.owner,
    });

    await expect(
      resolvePostMatchDiscoveryOwnerV2({ claimAt: OPERATOR }),
    ).resolves.toEqual({
      decision: "delegate-v1",
      pollOwner: OPERATOR.toISOString(),
    });
  });

  test("takes over a claim left standing past the staleness bound", async () => {
    turnV2OwnershipOff();
    await claimPostMatchPoll({ startedAt: SCHEDULED });
    const afterStale = new Date(
      SCHEDULED.getTime() + POST_MATCH_POLL_STALE_AFTER_MS + 1,
    );

    await expect(
      resolvePostMatchDiscoveryOwnerV2({ claimAt: afterStale }),
    ).resolves.toEqual({
      decision: "delegate-v1",
      pollOwner: afterStale.toISOString(),
    });
  });
});

describe("releasePostMatchPollClaimV2", () => {
  test("closes the delegated claim as failed", async () => {
    await claimPostMatchPoll({ startedAt: SCHEDULED });

    await expect(
      releasePostMatchPollClaimV2({
        pollOwner: SCHEDULED,
        releasedAt: OPERATOR,
      }),
    ).resolves.toEqual({ outcome: "released" });
    const released = await pollRow();
    expect(released?.pollStatus).toBe("failed");
  });

  test("closes nothing when the claim is already closed or someone else's", async () => {
    await claimPostMatchPoll({ startedAt: OPERATOR });

    await expect(
      releasePostMatchPollClaimV2({
        pollOwner: SCHEDULED,
        releasedAt: OPERATOR,
      }),
    ).resolves.toEqual({ outcome: "not-held" });
    const standing = await pollRow();
    expect(standing?.pollStatus).toBe("running");
    expect(standing?.pollStartedAt).toEqual(OPERATOR);
  });
});

describe("discoverDelegatedPostMatchIntents", () => {
  test("throws instead of skipping while this worker's polling flag is held", async () => {
    // The claim is the handoff's, but a V2 discovery on the same worker holds
    // the in-process flag for the moment it takes to be refused. A `skipped`
    // answer would send v1 into maintenance, which would close the unused
    // claim as a completed pass.
    await claimPostMatchPoll({ startedAt: SCHEDULED });
    expect(beginPollingRun(new Date())).toBe(true);
    try {
      await expect(
        discoverDelegatedPostMatchIntents({ pollOwner: SCHEDULED }),
      ).rejects.toBeInstanceOf(DelegatedPostMatchDiscoverySkippedError);
    } finally {
      endPollingRun();
    }
    const standing = await pollRow();
    expect(standing?.pollStatus).toBe("running");
    expect(standing?.pollStartedAt).toEqual(SCHEDULED);
  });

  test("throws instead of skipping when another run holds the claim", async () => {
    await claimPostMatchPoll({ startedAt: OPERATOR });

    await expect(
      discoverDelegatedPostMatchIntents({ pollOwner: SCHEDULED }),
    ).rejects.toBeInstanceOf(DelegatedPostMatchDiscoverySkippedError);
    const standing = await pollRow();
    expect(standing?.pollStartedAt).toEqual(OPERATOR);
  });
});

describe("renewPostMatchPollClaimV2", () => {
  test("renews the handoff's claim while it is held, and nothing after", async () => {
    await claimPostMatchPoll({ startedAt: SCHEDULED });
    await expect(
      renewPostMatchPollClaimV2({ pollOwner: SCHEDULED, renewedAt: OPERATOR }),
    ).resolves.toEqual({ outcome: "renewed" });
    const renewed = await pollRow();
    expect(renewed?.pollClaimRenewedAt).toEqual(OPERATOR);

    await releasePostMatchPollClaimV2({
      pollOwner: SCHEDULED,
      releasedAt: OPERATOR,
    });
    await expect(
      renewPostMatchPollClaimV2({ pollOwner: SCHEDULED, renewedAt: OPERATOR }),
    ).resolves.toEqual({ outcome: "not-held" });
  });
});
