import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type * as DatabaseModule from "#src/database/index.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("scout-postmatch-ownership");

// The handoff reads the poll row through the process client, as the Activity
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
const { resolvePostMatchDiscoveryOwnerV2 } =
  await import("#src/temporal/v2/postmatch-ownership.ts");

const FLAG = "scout_v2_postmatch_ownership_enabled";
const CLAIMED_AT = new Date("2026-09-23T10:00:00.000Z");
const SHORTLY_AFTER = new Date(CLAIMED_AT.getTime() + 60_000);

function turnV2OwnershipOff(): void {
  clearFlagOverrides(FLAG);
  addFlagOverride(FLAG, false, {});
}

beforeEach(async () => {
  await prisma.botState.deleteMany({});
});

afterEach(() => {
  resetFlagOverrides(FLAG);
});

describe("resolvePostMatchDiscoveryOwnerV2", () => {
  test("keeps V2 as the owner by default, even while a poll is held", async () => {
    await claimPostMatchPoll({ startedAt: CLAIMED_AT });

    await expect(
      resolvePostMatchDiscoveryOwnerV2({ now: SHORTLY_AFTER }),
    ).resolves.toEqual({ decision: "run-v2" });
  });

  test("hands the pass to v1 when V2 ownership is off and nothing holds the poll", async () => {
    turnV2OwnershipOff();

    await expect(
      resolvePostMatchDiscoveryOwnerV2({ now: SHORTLY_AFTER }),
    ).resolves.toEqual({ decision: "delegate-v1" });
  });

  test("hands the pass to v1 once the last poll has closed", async () => {
    turnV2OwnershipOff();
    const claim = await claimPostMatchPoll({ startedAt: CLAIMED_AT });
    if (claim.outcome !== "claimed") throw new Error("expected a claim");
    await markPostMatchPollCompleted({
      completedAt: SHORTLY_AFTER,
      evidenceComplete: true,
      owner: claim.owner,
    });

    await expect(
      resolvePostMatchDiscoveryOwnerV2({ now: SHORTLY_AFTER }),
    ).resolves.toEqual({ decision: "delegate-v1" });
  });

  test("defers v1 while a V2 run still holds its poll claim", async () => {
    // The in-flight V2 run is still processing what it discovered. v1 opens
    // its poll without claiming it, so starting v1 now would rediscover the
    // same matches.
    turnV2OwnershipOff();
    await claimPostMatchPoll({ startedAt: CLAIMED_AT });

    await expect(
      resolvePostMatchDiscoveryOwnerV2({ now: SHORTLY_AFTER }),
    ).resolves.toEqual({
      decision: "defer-v1",
      pollHeldSince: CLAIMED_AT.toISOString(),
    });
  });

  test("stops deferring once a standing claim passes the staleness bound", async () => {
    // Only a terminated run leaves a claim standing this long. The bound frees
    // it for V2's claim, and it frees it for the v1 handoff the same way.
    turnV2OwnershipOff();
    await claimPostMatchPoll({ startedAt: CLAIMED_AT });
    const afterStale = new Date(
      CLAIMED_AT.getTime() + POST_MATCH_POLL_STALE_AFTER_MS + 1,
    );

    await expect(
      resolvePostMatchDiscoveryOwnerV2({ now: afterStale }),
    ).resolves.toEqual({ decision: "delegate-v1" });
  });
});
