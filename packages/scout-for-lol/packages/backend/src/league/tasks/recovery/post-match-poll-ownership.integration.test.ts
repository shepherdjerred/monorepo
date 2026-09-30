import { beforeEach, describe, expect, test, vi } from "vitest";
import type * as DatabaseModule from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("scout-post-match-poll-ownership");

// Poll ownership is read and written through the process client, exactly as
// every Activity that opens or closes a poll does.
vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

const {
  claimPostMatchPoll,
  markPostMatchPollCompleted,
  markPostMatchPollFailed,
  markPostMatchPollStarted,
  PostMatchPollOwnershipError,
  POST_MATCH_POLL_STALE_AFTER_MS,
  renewPostMatchPollClaim,
} = await import("#src/league/tasks/recovery/app-state.ts");

const BOT_STATE_ID = 1;
const FIRST = new Date("2026-09-17T10:00:00.000Z");
const SECOND = new Date("2026-09-17T10:00:30.000Z");

async function pollRow() {
  return await prisma.botState.findUnique({ where: { id: BOT_STATE_ID } });
}

beforeEach(async () => {
  await prisma.botState.deleteMany({});
});

describe("claiming the post-match poll", () => {
  test("claims a poll nothing holds, and refuses the next claimant", async () => {
    expect(await claimPostMatchPoll({ startedAt: FIRST })).toEqual({
      outcome: "claimed",
      owner: { startedAt: FIRST },
    });
    // The row did not exist; the claim created it and opened the poll.
    const opened = await pollRow();
    expect(opened?.pollStatus).toBe("running");

    // The overlap this exists for: a second discovery starting while the first
    // run is still awaiting its children.
    expect(await claimPostMatchPoll({ startedAt: SECOND })).toEqual({
      outcome: "held",
      since: FIRST,
    });
    const afterSecond = await pollRow();
    expect(afterSecond?.pollStartedAt).toEqual(FIRST);
  });

  test("takes over a claim left standing past the staleness bound", async () => {
    // Only a TERMINATED run leaves a claim standing — a worker that dies is
    // replaced from history and its maintenance still closes the poll — so the
    // bound is the safety valve for that case, not a bound on an ordinary run.
    await claimPostMatchPoll({ startedAt: FIRST });
    const afterStale = new Date(
      FIRST.getTime() + POST_MATCH_POLL_STALE_AFTER_MS + 1,
    );

    expect(await claimPostMatchPoll({ startedAt: afterStale })).toEqual({
      outcome: "claimed",
      owner: { startedAt: afterStale },
    });
    const takenOver = await pollRow();
    expect(takenOver?.pollStartedAt).toEqual(afterStale);
  });

  test("re-acquires its own claim when the same instant is presented again", async () => {
    // The retry a died-mid-Activity attempt leaves behind. The discovery
    // Activity's first-scheduled timestamp is the same on every attempt, so a
    // retry presents the instant its predecessor claimed. Reading that as
    // another run's poll would leave it standing until the staleness bound
    // with no run left to close it — the Workflow would have no-opped.
    await claimPostMatchPoll({ startedAt: FIRST });

    expect(await claimPostMatchPoll({ startedAt: FIRST })).toEqual({
      outcome: "claimed",
      owner: { startedAt: FIRST },
    });
    const reclaimed = await pollRow();
    expect(reclaimed?.pollStatus).toBe("running");
    expect(reclaimed?.pollStartedAt).toEqual(FIRST);
  });

  test("hands the poll to exactly one of two concurrent claimants", async () => {
    const outcomes = await Promise.all([
      claimPostMatchPoll({ startedAt: FIRST }),
      claimPostMatchPoll({ startedAt: SECOND }),
    ]);

    expect(
      outcomes.filter((claim) => claim.outcome === "claimed"),
    ).toHaveLength(1);
    expect(outcomes.filter((claim) => claim.outcome === "held")).toHaveLength(
      1,
    );
  });
});

describe("closing a poll the row no longer names", () => {
  test("refuses the first run's close after a takeover, leaving the second run's poll open", async () => {
    // The defect this guard exists for. The first run's ownership has to span
    // its whole execution — discovery, the children it awaits, and the
    // maintenance that closes the poll. Without the guard its maintenance
    // marked whatever poll was standing complete, which after a takeover is
    // the SECOND run's live poll, flipping the status under a poll still
    // running and freeing a third run to start on top of it.
    const first = await claimPostMatchPoll({ startedAt: FIRST });
    if (first.outcome !== "claimed") throw new Error("expected the claim");
    const afterStale = new Date(
      FIRST.getTime() + POST_MATCH_POLL_STALE_AFTER_MS + 1,
    );
    await claimPostMatchPoll({ startedAt: afterStale });

    await expect(
      markPostMatchPollCompleted({
        completedAt: new Date(),
        evidenceComplete: true,
        owner: first.owner,
      }),
    ).rejects.toThrow(PostMatchPollOwnershipError);

    const standing = await pollRow();
    expect(standing?.pollStatus).toBe("running");
    expect(standing?.pollStartedAt).toEqual(afterStale);
    expect(standing?.pollCompletedAt).toBeNull();
  });

  test("refuses the owner's failure close too", async () => {
    const first = await claimPostMatchPoll({ startedAt: FIRST });
    if (first.outcome !== "claimed") throw new Error("expected the claim");
    const afterStale = new Date(
      FIRST.getTime() + POST_MATCH_POLL_STALE_AFTER_MS + 1,
    );
    await claimPostMatchPoll({ startedAt: afterStale });

    await expect(
      markPostMatchPollFailed(new Error("discovery blew up"), new Date(), {
        owner: first.owner,
      }),
    ).rejects.toThrow(PostMatchPollOwnershipError);
    const untouched = await pollRow();
    expect(untouched?.pollStatus).toBe("running");
  });

  test("closes the owner's own poll and frees the next claim", async () => {
    const first = await claimPostMatchPoll({ startedAt: FIRST });
    if (first.outcome !== "claimed") throw new Error("expected the claim");

    await markPostMatchPollCompleted({
      completedAt: SECOND,
      evidenceComplete: true,
      owner: first.owner,
    });

    const closed = await pollRow();
    expect(closed?.pollStatus).toBe("healthy");
    expect(closed?.lastSuccessfulPollAt).toEqual(SECOND);
    expect(await claimPostMatchPoll({ startedAt: SECOND })).toMatchObject({
      outcome: "claimed",
    });
  });
});

describe("V2 discovery's durable claim", () => {
  test("reports a second discovery as skipped after the first returns", async () => {
    // The defect, at the seam it was reported on. The first discovery's
    // Activity has RETURNED — its in-process flag is released and its Workflow
    // is away awaiting children — but the poll it opened is still live, and
    // the maintenance that closes it has not run. A second discovery starting
    // here used to open a poll of its own, after which the first run's
    // maintenance marked the SECOND run's poll complete underneath it.
    const { discoverPostMatchIdsV2 } =
      await import("#src/temporal/v2/match-reads.ts");

    const first = await discoverPostMatchIdsV2();
    expect(first.outcome).toBe("scanned");
    if (first.outcome !== "scanned") throw new Error("expected a scan");
    // The claim rides the result, so the close can present it.
    const claimed = await pollRow();
    expect(claimed?.pollStartedAt).toEqual(new Date(first.pollOwner));

    expect(await discoverPostMatchIdsV2()).toEqual({ outcome: "skipped" });
    // The second pass opened nothing: the row still names the first poll.
    const afterSkip = await pollRow();
    expect(afterSkip?.pollStartedAt).toEqual(new Date(first.pollOwner));

    // Once the first run's maintenance closes ITS poll, the next discovery
    // runs — ownership spans the run and no longer than it.
    await markPostMatchPollCompleted({
      completedAt: new Date(),
      evidenceComplete: true,
      owner: { startedAt: new Date(first.pollOwner) },
    });
    const third = await discoverPostMatchIdsV2();
    expect(third.outcome).toBe("scanned");
  }, 30_000);
});

describe("v1's unowned poll writes", () => {
  test("open and close whatever stands, exactly as before", async () => {
    // v1's poll and the maintenance that closes it are one Activity, and its
    // Schedule serializes the runs. It has never needed the row to refuse it,
    // and a durable claim it could not release would refuse the next tick
    // after a worker died mid-pass.
    await claimPostMatchPoll({ startedAt: FIRST });

    await markPostMatchPollStarted(SECOND);
    const reopened = await pollRow();
    expect(reopened?.pollStartedAt).toEqual(SECOND);

    await markPostMatchPollCompleted({
      completedAt: SECOND,
      evidenceComplete: false,
    });
    const overwritten = await pollRow();
    expect(overwritten?.pollStatus).toBe("incomplete");
  });
});

/** The first instant at which a claim last touched at `from` is stale. */
function afterBound(from: Date): Date {
  return new Date(from.getTime() + POST_MATCH_POLL_STALE_AFTER_MS + 1);
}

describe("renewing a held claim", () => {
  test("keeps a renewed claim live past the staleness bound", async () => {
    // A delegated v1 pass ingesting a backlog outlives the bound. Its owner
    // renewed the claim 25 minutes in, so a claimant 30 minutes after the
    // START is still refused.
    await claimPostMatchPoll({ startedAt: FIRST });
    const renewedAt = new Date(FIRST.getTime() + 25 * 60 * 1000);
    expect(
      await renewPostMatchPollClaim({
        owner: { startedAt: FIRST },
        renewedAt,
      }),
    ).toBe(true);

    expect(await claimPostMatchPoll({ startedAt: afterBound(FIRST) })).toEqual({
      outcome: "held",
      since: FIRST,
    });
    // Once the renewal itself is past the bound, the claim is stale again.
    const takeover = afterBound(renewedAt);
    expect(await claimPostMatchPoll({ startedAt: takeover })).toEqual({
      outcome: "claimed",
      owner: { startedAt: takeover },
    });
  });

  test("keeps the renewal when the owner re-presents its claim", async () => {
    // The delegated v1 discovery re-takes the handoff's claim. Doing so must
    // not reset a renewal, or a late re-take would make a live claim stale.
    await claimPostMatchPoll({ startedAt: FIRST });
    await renewPostMatchPollClaim({
      owner: { startedAt: FIRST },
      renewedAt: new Date(FIRST.getTime() + 25 * 60 * 1000),
    });
    expect(await claimPostMatchPoll({ startedAt: FIRST })).toEqual({
      outcome: "claimed",
      owner: { startedAt: FIRST },
    });

    expect(await claimPostMatchPoll({ startedAt: afterBound(FIRST) })).toEqual({
      outcome: "held",
      since: FIRST,
    });
  });

  test("never revives a claim that was closed or taken over", async () => {
    await claimPostMatchPoll({ startedAt: FIRST });
    await markPostMatchPollCompleted({
      completedAt: SECOND,
      evidenceComplete: true,
      owner: { startedAt: FIRST },
    });
    expect(
      await renewPostMatchPollClaim({
        owner: { startedAt: FIRST },
        renewedAt: SECOND,
      }),
    ).toBe(false);
    const closed = await pollRow();
    expect(closed?.pollStatus).toBe("healthy");

    await claimPostMatchPoll({ startedAt: SECOND });
    expect(
      await renewPostMatchPollClaim({
        owner: { startedAt: FIRST },
        renewedAt: SECOND,
      }),
    ).toBe(false);
  });

  test("a fresh claim does not inherit the previous holder's renewal", async () => {
    await claimPostMatchPoll({ startedAt: FIRST });
    await renewPostMatchPollClaim({
      owner: { startedAt: FIRST },
      renewedAt: new Date(FIRST.getTime() + 25 * 60 * 1000),
    });
    await markPostMatchPollCompleted({
      completedAt: SECOND,
      evidenceComplete: true,
      owner: { startedAt: FIRST },
    });
    await claimPostMatchPoll({ startedAt: SECOND });

    const takeover = afterBound(SECOND);
    expect(await claimPostMatchPoll({ startedAt: takeover })).toEqual({
      outcome: "claimed",
      owner: { startedAt: takeover },
    });
  });
});
