import { beforeEach, describe, expect, test, vi } from "vitest";
import type * as DatabaseModule from "#src/database/index.ts";
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

const { claimPostMatchPoll } =
  await import("#src/league/tasks/recovery/app-state.ts");
const {
  DelegatedPostMatchDiscoverySkippedError,
  discoverDelegatedPostMatchIntents,
  releasePostMatchPollClaimV2,
  renewPostMatchPollClaimV2,
  resolvePostMatchDiscoveryOwnerV2,
} = await import("#src/temporal/v2/ownership/postmatch-ownership.ts");
const { beginPollingRun, endPollingRun } =
  await import("#src/league/tasks/postmatch/poll-ownership.ts");

const BOT_STATE_ID = 1;
const SCHEDULED = new Date("2026-09-23T10:00:00.000Z");
const OPERATOR = new Date("2026-09-23T10:00:20.000Z");

async function pollRow() {
  return await prisma.botState.findUnique({ where: { id: BOT_STATE_ID } });
}

beforeEach(async () => {
  await prisma.botState.deleteMany({});
});

describe("resolvePostMatchDiscoveryOwnerV2", () => {
  test("answers V2 for a retired ownership read, and takes no claim for it", async () => {
    // Only a discovery recorded before the read was retired still asks, on
    // replay or on a retry; V2 discovery takes its own claim afterwards.
    await expect(resolvePostMatchDiscoveryOwnerV2()).resolves.toEqual({
      decision: "run-v2",
    });
    expect(await pollRow()).toBeNull();
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
