import { describe, expect, test } from "vitest";
import { defaultSnapshotsPath } from "#lib/brim/cache.ts";
import { PROVIDER_ORDER } from "#lib/brim/rank.ts";
import {
  HistoryApiBlocksResponseSchema,
  type HistoryApiBlocksResponse,
} from "#lib/history/api/report-schema.ts";
import { HistoryApiErrorSchema } from "#lib/history/api/schema.ts";
import {
  activeQuotaWindows,
  blockProjection,
  BRIM_PROVIDER_AGENTS,
  buildBlocksResponse,
  loadQuotaSnapshots,
} from "#lib/history/blocks.ts";
import { HISTORY_AGENT_NAMES } from "#lib/history/agents.ts";
import {
  useUsageFixtures,
  writeSnapshots,
  type SyntheticSession,
  type UsageFixture,
} from "#test/support/usage-index.ts";

const open = useUsageFixtures();

async function blocks(
  fixture: UsageFixture,
  query: string,
  now: string,
): Promise<HistoryApiBlocksResponse> {
  const { status, body } = await fixture.get(
    `/v1/blocks?${query}`,
    new Date(now),
  );
  expect(status, JSON.stringify(body)).toBe(200);
  return HistoryApiBlocksResponseSchema.parse(body);
}

function spans(response: HistoryApiBlocksResponse) {
  return response.blocks.map((block) => ({
    start: block.start,
    end: block.end,
    events: block.events,
    isActive: block.isActive,
    alignedToQuota: block.alignedToQuota,
  }));
}

/** Two expired blocks, a gap, and a third block from 22:00. */
const DAY: SyntheticSession = {
  source: "claude",
  id: "day",
  events: [
    { at: "2026-11-13T10:37:00.000Z" },
    { at: "2026-11-13T14:59:00.000Z" },
    { at: "2026-11-13T15:00:00.000Z" },
    {
      at: "2026-11-13T22:10:00.000Z",
      input: 5000,
      output: 1000,
      costUsd: 3,
    },
  ],
};

describe("rolling 5-hour blocks", () => {
  test("floors to the hour, lasts five hours, and reports gaps", async () => {
    const fixture = await open([DAY]);
    const response = await blocks(
      fixture,
      "since=all",
      "2026-11-13T23:10:00.000Z",
    );
    expect(spans(response)).toEqual([
      {
        start: "2026-11-13T10:00:00.000Z",
        end: "2026-11-13T15:00:00.000Z",
        events: 2,
        isActive: false,
        alignedToQuota: false,
      },
      {
        start: "2026-11-13T15:00:00.000Z",
        end: "2026-11-13T20:00:00.000Z",
        events: 1,
        isActive: false,
        alignedToQuota: false,
      },
      {
        start: "2026-11-13T22:00:00.000Z",
        end: "2026-11-14T03:00:00.000Z",
        events: 1,
        isActive: true,
        alignedToQuota: false,
      },
    ]);
    expect(response.gaps).toEqual([
      {
        agent: "claude",
        start: "2026-11-13T20:00:00.000Z",
        end: "2026-11-13T22:00:00.000Z",
      },
    ]);
    expect(response.blocks.map((block) => block.projection)).toEqual([
      null,
      null,
      {
        elapsedMinutes: 70,
        remainingMinutes: 230,
        tokensPerMinute: 100,
        costPerHour: 3,
        projectedTokens: 29_000,
        projectedCostUsd: 14.5,
      },
    ]);
    expect(response.blocks[2]).toEqual(
      expect.objectContaining({
        agent: "claude",
        firstEventAt: "2026-11-13T22:10:00.000Z",
        lastEventAt: "2026-11-13T22:10:00.000Z",
        machines: [null],
        models: ["claude-opus-5-5"],
        totalTokens: 6000,
        costUsd: 3,
        costComplete: true,
      }),
    );
  });

  test("starts no active block once the last one has expired", async () => {
    const fixture = await open([DAY]);
    const later = await blocks(
      fixture,
      "since=all",
      "2026-11-14T04:00:00.000Z",
    );
    expect(later.blocks.every((block) => !block.isActive)).toBe(true);
    const active = await blocks(
      fixture,
      "active=true",
      "2026-11-14T04:00:00.000Z",
    );
    expect(active.blocks).toEqual([]);
    expect(active.gaps).toEqual([]);
    expect(active.activeOnly).toBe(true);
  });

  test("lists only blocks ending after since, defaulting to three days", async () => {
    const fixture = await open([
      DAY,
      {
        source: "claude",
        id: "old",
        events: [{ at: "2026-11-09T09:00:00.000Z" }],
      },
    ]);
    const response = await blocks(fixture, "", "2026-11-13T23:10:00.000Z");
    expect(response.since).toBe("2026-11-10T23:10:00.000Z");
    expect(response.blocks.map((block) => block.start)[0]).toBe(
      "2026-11-13T10:00:00.000Z",
    );
    expect(response.gaps).toHaveLength(1);
    const recent = await blocks(
      fixture,
      "since=2026-11-13T20:00:00.000Z",
      "2026-11-13T23:10:00.000Z",
    );
    expect(recent.blocks.map((block) => block.start)).toEqual([
      "2026-11-13T22:00:00.000Z",
    ]);
  });

  test("matches a full-history build when the chain predates since", async () => {
    const hourly = Array.from({ length: 72 }, (_, hour) => ({
      at: new Date(
        Date.parse("2026-11-10T00:30:00.000Z") + hour * 3_600_000,
      ).toISOString(),
    }));
    const fixture = await open([
      { source: "claude", id: "marathon", events: hourly },
    ]);
    const now = "2026-11-13T02:00:00.000Z";
    const since = "2026-11-12T12:00:00.000Z";
    const response = await blocks(fixture, `since=${since}`, now);
    const expected = buildBlocksResponse(
      fixture.index.blockEvents({
        sources: null,
        machine: "local",
        from: null,
      }),
      { agent: null, activeOnly: false, since, machine: "local" },
      new Map(),
      new Date(now),
    );
    expect(response).toEqual(expected);
    expect(response.blocks.map((block) => block.start)).toEqual([
      "2026-11-12T12:00:00.000Z",
      "2026-11-12T17:00:00.000Z",
      "2026-11-12T22:00:00.000Z",
    ]);
    expect(response.blocks.at(-1)?.isActive).toBe(true);
  });

  test("keeps this machine by default and includes mirrors on request", async () => {
    const fixture = await open([
      DAY,
      {
        source: "claude-mirror",
        id: "desktop/day",
        machine: "desktop",
        events: [{ at: "2026-11-13T22:20:00.000Z", model: "claude-haiku-5-5" }],
      },
    ]);
    const now = "2026-11-13T23:10:00.000Z";
    const local = await blocks(fixture, "active=true", now);
    expect(local.machine).toBe("local");
    expect(local.blocks.map((block) => [block.machines, block.events])).toEqual(
      [[[null], 1]],
    );
    const all = await blocks(fixture, "active=true&machine=all", now);
    expect(all.blocks.map((block) => [block.machines, block.models])).toEqual([
      [
        [null, "desktop"],
        ["claude-haiku-5-5", "claude-opus-5-5"],
      ],
    ]);
    const desktop = await blocks(fixture, "machine=desktop&agent=claude", now);
    expect(desktop.blocks.map((block) => block.machines)).toEqual([
      ["desktop"],
    ]);
  });

  test.each([
    ["agent=claude-mirror", "Unknown agent"],
    ["active=yes", "active must be true or false"],
    ["since=soon", "Invalid --since value"],
  ])("rejects %s", async (query, message) => {
    const fixture = await open([DAY]);
    const { status, body } = await fixture.get(`/v1/blocks?${query}`);
    expect(status).toBe(400);
    expect(HistoryApiErrorSchema.parse(body).error).toContain(message);
  });
});

describe("quota-aligned blocks", () => {
  test("aligns the active block to the provider's 5-hour window", async () => {
    const fixture = await open([DAY]);
    await writeSnapshots(fixture.home, {
      "claude-code": [
        { label: "5-hour", resetAt: "2026-11-14T01:30:00.000Z" },
        { label: "Weekly", resetAt: "2026-11-16T00:00:00.000Z" },
      ],
    });
    const response = await blocks(
      fixture,
      "since=all",
      "2026-11-13T23:10:00.000Z",
    );
    expect(spans(response).slice(1)).toEqual([
      {
        start: "2026-11-13T15:00:00.000Z",
        end: "2026-11-13T20:00:00.000Z",
        events: 1,
        isActive: false,
        alignedToQuota: false,
      },
      {
        start: "2026-11-13T20:30:00.000Z",
        end: "2026-11-14T01:30:00.000Z",
        events: 1,
        isActive: true,
        alignedToQuota: true,
      },
    ]);
    expect(response.gaps.at(-1)).toEqual({
      agent: "claude",
      start: "2026-11-13T20:00:00.000Z",
      end: "2026-11-13T20:30:00.000Z",
    });
    expect(response.blocks.at(-1)?.projection).toEqual({
      elapsedMinutes: 160,
      remainingMinutes: 140,
      tokensPerMinute: 100,
      costPerHour: 3,
      projectedTokens: 20_000,
      projectedCostUsd: 10,
    });
  });

  test("ends the previous block where the quota window starts", async () => {
    const fixture = await open([
      {
        source: "claude",
        id: "overlap",
        events: [
          { at: "2026-11-13T15:00:00.000Z" },
          { at: "2026-11-13T19:30:00.000Z" },
        ],
      },
    ]);
    await writeSnapshots(fixture.home, {
      "claude-code": [{ label: "5-hour", resetAt: "2026-11-14T00:00:00.000Z" }],
    });
    const response = await blocks(
      fixture,
      "since=all",
      "2026-11-13T21:00:00.000Z",
    );
    expect(spans(response)).toEqual([
      {
        start: "2026-11-13T15:00:00.000Z",
        end: "2026-11-13T19:00:00.000Z",
        events: 1,
        isActive: false,
        alignedToQuota: false,
      },
      {
        start: "2026-11-13T19:00:00.000Z",
        end: "2026-11-14T00:00:00.000Z",
        events: 1,
        isActive: true,
        alignedToQuota: true,
      },
    ]);
    expect(response.gaps).toEqual([]);
  });

  test("ignores a window that already reset and other agents' windows", async () => {
    const fixture = await open([DAY]);
    await writeSnapshots(fixture.home, {
      "claude-code": [{ label: "5-hour", resetAt: "2026-11-13T20:00:00.000Z" }],
      codex: [{ label: "5-hour", resetAt: "2026-11-14T01:00:00.000Z" }],
    });
    const response = await blocks(
      fixture,
      "active=true",
      "2026-11-13T23:10:00.000Z",
    );
    expect(spans(response)).toEqual([
      {
        start: "2026-11-13T22:00:00.000Z",
        end: "2026-11-14T03:00:00.000Z",
        events: 1,
        isActive: true,
        alignedToQuota: false,
      },
    ]);
  });

  test("picks the most consumed of several 5-hour windows", async () => {
    const fixture = await open([]);
    await writeSnapshots(fixture.home, {
      antigravity: [
        {
          label: "Gemini 5-hour",
          resetAt: "2026-11-14T02:00:00.000Z",
          usedPercent: 20,
        },
        {
          label: "Claude 5-hour",
          resetAt: "2026-11-14T01:00:00.000Z",
          usedPercent: 80,
        },
        { label: "Weekly", resetAt: "2026-11-15T00:00:00.000Z" },
      ],
      "claude-code": [{ label: "5-hour", resetAt: null }],
      "api-platform": [
        { label: "5-hour", resetAt: "2026-11-14T01:00:00.000Z" },
      ],
    });
    const snapshots = await loadQuotaSnapshots(
      defaultSnapshotsPath(fixture.home),
    );
    expect(
      Object.fromEntries(
        activeQuotaWindows(
          snapshots ?? [],
          Date.parse("2026-11-13T23:10:00.000Z"),
        ),
      ),
    ).toEqual({
      antigravity: {
        startMs: Date.parse("2026-11-13T20:00:00.000Z"),
        endMs: Date.parse("2026-11-14T01:00:00.000Z"),
      },
    });
  });

  test("treats a missing Brim cache as no quota data", async () => {
    expect(await loadQuotaSnapshots("/nonexistent/snapshots.json")).toBeNull();
  });

  test("maps every Brim provider to a history agent", () => {
    for (const provider of PROVIDER_ORDER) {
      expect(HISTORY_AGENT_NAMES).toContain(BRIM_PROVIDER_AGENTS[provider]);
    }
  });
});

describe("block projection", () => {
  test("measures at least one minute so a fresh block stays finite", () => {
    const startMs = Date.parse("2026-11-13T22:00:00.000Z");
    expect(
      blockProjection(
        {
          startMs,
          endMs: startMs + 5 * 3_600_000,
          firstEventMs: startMs + 30 * 60_000,
        },
        { totalTokens: 500, costUsd: 0.5 },
        startMs + 30 * 60_000,
      ),
    ).toEqual({
      elapsedMinutes: 30,
      remainingMinutes: 270,
      tokensPerMinute: 500,
      costPerHour: 30,
      projectedTokens: 135_500,
      projectedCostUsd: 135.5,
    });
  });
});
