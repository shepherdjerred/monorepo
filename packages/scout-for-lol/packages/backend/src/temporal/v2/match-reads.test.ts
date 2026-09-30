import { describe, expect, test, vi } from "vitest";

/**
 * The one translation `discoverPostMatchIdsV2` owns: the discovery answer into
 * the closed scan-result union the Workflow decides from. Discovery itself is
 * replaced — it polls Riot and claims the poll — so the properties pinned here
 * are exactly that a skipped pass and an empty pass leave as different
 * outcomes, because they oblige the Workflow differently, and that a pass that
 * polled carries its poll claim out for the close to present.
 */

const discovery = vi.hoisted(() => ({
  discoverPostMatchIntents: vi.fn(),
}));

vi.mock("#src/league/tasks/postmatch/match-history-polling.ts", () => ({
  discoverPostMatchIntents: discovery.discoverPostMatchIntents,
}));
vi.mock("#src/database/index.ts", () => ({ prisma: {} }));

const { discoverPostMatchIdsV2 } =
  await import("#src/temporal/v2/match-reads.ts");

const POLL_CLAIMED_AT = new Date("2026-09-16T07:59:00.000Z");

describe("discoverPostMatchIdsV2", () => {
  test("reports a skipped pass as skipped, not as an empty scan", async () => {
    // A poll was already running on this worker; nothing was opened, so the
    // Workflow must not run the maintenance that would close the other
    // execution's poll under it.
    discovery.discoverPostMatchIntents.mockResolvedValueOnce({
      outcome: "skipped",
      matches: [],
      evidenceComplete: false,
    });

    expect(await discoverPostMatchIdsV2()).toEqual({ outcome: "skipped" });
  });

  test("refuses to report a scan whose poll nothing can close", async () => {
    // A durable pass that polled holds a claim by construction. Reporting a
    // scan without one would hand the Workflow a poll no close can name, and
    // the next discovery would find it standing until the staleness bound.
    discovery.discoverPostMatchIntents.mockResolvedValueOnce({
      outcome: "polled",
      matches: [],
      evidenceComplete: true,
    });

    await expect(discoverPostMatchIdsV2()).rejects.toThrow(
      /without a durable poll claim/,
    );
  });

  test("reports an empty but polled pass as a scan with nothing in it", async () => {
    // This pass DID open a poll and saw nothing; the Workflow owes maintenance.
    discovery.discoverPostMatchIntents.mockResolvedValueOnce({
      outcome: "polled",
      matches: [],
      evidenceComplete: true,
      evidenceWatermark: "2026-09-16T08:00:00.000Z",
      pollOwner: { startedAt: POLL_CLAIMED_AT },
    });

    expect(await discoverPostMatchIdsV2()).toEqual({
      outcome: "scanned",
      riotMatchIds: [],
      matches: [],
      complete: true,
      pollOwner: POLL_CLAIMED_AT.toISOString(),
      evidenceWatermark: "2026-09-16T08:00:00.000Z",
    });
  });

  test("carries the discovered ids and v1's incompleteness through a scan", async () => {
    // Both delivery modes in one page, because v1 decides it per match: a
    // scan that collapsed them would hand a backfilled match to a child that
    // then announced it.
    discovery.discoverPostMatchIntents.mockResolvedValueOnce({
      outcome: "polled",
      matches: [
        {
          matchId: "NA1_1",
          sourcePuuid: "p".repeat(78),
          region: "AMERICA_NORTH",
          delivery: "live",
          gameEndTimestamp: 1,
        },
        {
          matchId: "NA1_2",
          sourcePuuid: "q".repeat(78),
          region: "AMERICA_NORTH",
          delivery: "silent-backfill",
          gameEndTimestamp: 2,
        },
      ],
      evidenceComplete: false,
      pollOwner: { startedAt: POLL_CLAIMED_AT },
    });

    expect(await discoverPostMatchIdsV2()).toEqual({
      outcome: "scanned",
      riotMatchIds: ["NA1_1", "NA1_2"],
      matches: [
        {
          riotMatchId: "NA1_1",
          sourcePuuid: "p".repeat(78),
          deliveryMode: "live",
          gameEndTimestamp: 1,
        },
        {
          riotMatchId: "NA1_2",
          sourcePuuid: "q".repeat(78),
          deliveryMode: "silent-backfill",
          gameEndTimestamp: 2,
        },
      ],
      complete: false,
      pollOwner: POLL_CLAIMED_AT.toISOString(),
    });
  });
});
