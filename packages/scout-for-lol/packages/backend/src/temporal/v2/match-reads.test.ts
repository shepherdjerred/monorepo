import { describe, expect, test, vi } from "vitest";

/**
 * The one translation `discoverPostMatchIdsV2` owns: v1's discovery answer
 * into the closed scan-result union the Workflow decides from. Discovery
 * itself is replaced — it polls Riot and writes poll status — so the property
 * pinned here is exactly that a skipped pass and an empty pass leave as
 * different outcomes, because they oblige the Workflow differently.
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

  test("reports an empty but polled pass as a scan with nothing in it", async () => {
    // This pass DID open a poll and saw nothing; the Workflow owes maintenance.
    discovery.discoverPostMatchIntents.mockResolvedValueOnce({
      outcome: "polled",
      matches: [],
      evidenceComplete: true,
      evidenceWatermark: "2026-09-16T08:00:00.000Z",
    });

    expect(await discoverPostMatchIdsV2()).toEqual({
      outcome: "scanned",
      riotMatchIds: [],
      complete: true,
      evidenceWatermark: "2026-09-16T08:00:00.000Z",
    });
  });

  test("carries the discovered ids and v1's incompleteness through a scan", async () => {
    discovery.discoverPostMatchIntents.mockResolvedValueOnce({
      outcome: "polled",
      matches: [
        {
          matchId: "NA1_1",
          sourcePuuid: "p".repeat(78),
          region: "AMERICA_NORTH",
          delivery: "live",
        },
      ],
      evidenceComplete: false,
    });

    expect(await discoverPostMatchIdsV2()).toEqual({
      outcome: "scanned",
      riotMatchIds: ["NA1_1"],
      complete: false,
    });
  });
});
