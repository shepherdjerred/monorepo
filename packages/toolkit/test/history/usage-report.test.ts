import { afterEach, describe, expect, test } from "vitest";
import {
  HistoryApiUsageReportResponseSchema,
  type HistoryApiUsageReportResponse,
} from "#lib/history/api/report-schema.ts";
import {
  HistoryApiErrorSchema,
  HistoryApiUsageResponseSchema,
} from "#lib/history/api/schema.ts";
import {
  usageFixture,
  type SyntheticSession,
  type UsageFixture,
} from "#test/support/usage-index.ts";

const fixtures: UsageFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

async function open(sessions: readonly SyntheticSession[]) {
  const fixture = await usageFixture(sessions);
  fixtures.push(fixture);
  return fixture;
}

async function report(
  fixture: UsageFixture,
  query: string,
): Promise<HistoryApiUsageReportResponse> {
  const { status, body } = await fixture.get(`/v1/usage?${query}`);
  expect(status, JSON.stringify(body)).toBe(200);
  return HistoryApiUsageReportResponseSchema.parse(body);
}

function periods(response: HistoryApiUsageReportResponse) {
  return response.periods.map((period) => [period.period, period.events]);
}

describe("usage period report bucketing", () => {
  test("buckets days by the requested zone's calendar", async () => {
    const fixture = await open([
      {
        source: "claude",
        id: "late",
        // 23:30 on Nov 7 in Los Angeles (PST), already Nov 8 in UTC.
        events: [{ at: "2026-11-08T07:30:00.000Z" }],
      },
    ]);
    expect(periods(await report(fixture, "period=day&timezone=UTC"))).toEqual([
      ["2026-11-08", 1],
    ]);
    const pacific = await report(
      fixture,
      "period=day&timezone=America/Los_Angeles",
    );
    expect(periods(pacific)).toEqual([["2026-11-07", 1]]);
    expect(pacific.timezone).toBe("America/Los_Angeles");
    expect(pacific.periods[0]).toEqual(
      expect.objectContaining({
        start: "2026-11-07T08:00:00.000Z",
        end: "2026-11-08T08:00:00.000Z",
      }),
    );
  });

  test("keeps quarter-hour zone offsets exact", async () => {
    const fixture = await open([
      {
        source: "claude",
        id: "kathmandu",
        events: [
          // UTC+5:45: 23:59 on Nov 7 and 00:00 on Nov 8.
          { at: "2026-11-07T18:14:59.000Z" },
          { at: "2026-11-07T18:15:00.000Z" },
        ],
      },
    ]);
    expect(
      periods(await report(fixture, "period=day&timezone=Asia/Kathmandu")),
    ).toEqual([
      ["2026-11-07", 1],
      ["2026-11-08", 1],
    ]);
  });

  test("spans 25- and 23-hour days across DST transitions", async () => {
    const fixture = await open([
      {
        source: "codex",
        id: "dst",
        events: [
          // 23:30 PST on Nov 1, the day DST ended.
          { at: "2026-11-02T07:30:00.000Z", model: "gpt-5.5" },
          // 01:30 PST on Mar 8, the day DST began.
          { at: "2026-03-08T09:30:00.000Z", model: "gpt-5.5" },
        ],
      },
    ]);
    const response = await report(
      fixture,
      "period=day&timezone=America/Los_Angeles",
    );
    expect(
      response.periods.map(({ period, start, end }) => ({
        period,
        start,
        end,
      })),
    ).toEqual([
      {
        period: "2026-03-08",
        start: "2026-03-08T08:00:00.000Z",
        end: "2026-03-09T07:00:00.000Z",
      },
      {
        period: "2026-11-01",
        start: "2026-11-01T07:00:00.000Z",
        end: "2026-11-02T08:00:00.000Z",
      },
    ]);
  });

  test("starts weeks on Monday by default or Sunday on request", async () => {
    const fixture = await open([
      {
        source: "claude",
        id: "weekend",
        events: [
          { at: "2026-11-07T18:00:00.000Z" }, // Saturday
          { at: "2026-11-08T18:00:00.000Z" }, // Sunday
          { at: "2026-11-09T18:00:00.000Z" }, // Monday
        ],
      },
    ]);
    const monday = await report(fixture, "period=week&timezone=UTC");
    expect(monday.startOfWeek).toBe("monday");
    expect(periods(monday)).toEqual([
      ["2026-11-02", 2],
      ["2026-11-09", 1],
    ]);
    expect(monday.periods[0]?.end).toBe("2026-11-09T00:00:00.000Z");
    expect(
      periods(
        await report(fixture, "period=week&timezone=UTC&startOfWeek=sunday"),
      ),
    ).toEqual([
      ["2026-11-01", 1],
      ["2026-11-08", 2],
    ]);
  });

  test("buckets months and rolls December into January", async () => {
    const fixture = await open([
      {
        source: "claude",
        id: "months",
        events: [
          { at: "2026-12-31T23:00:00.000Z" },
          { at: "2027-01-01T00:30:00.000Z" },
        ],
      },
    ]);
    const response = await report(fixture, "period=month&timezone=UTC");
    expect(periods(response)).toEqual([
      ["2026-12", 1],
      ["2027-01", 1],
    ]);
    expect(response.periods[0]?.end).toBe("2027-01-01T00:00:00.000Z");
    // In Tokyo both events are already January.
    expect(
      periods(await report(fixture, "period=month&timezone=Asia/Tokyo")),
    ).toEqual([["2027-01", 2]]);
  });

  test("reads a bare since/until date as midnight in the zone", async () => {
    const fixture = await open([
      {
        source: "claude",
        id: "bounds",
        events: [
          { at: "2026-11-08T07:59:00.000Z" }, // Nov 7 PST
          { at: "2026-11-08T08:00:00.000Z" }, // Nov 8 PST
          { at: "2026-11-09T08:00:00.000Z" }, // Nov 9 PST
        ],
      },
    ]);
    const response = await report(
      fixture,
      "period=day&timezone=America/Los_Angeles&since=2026-11-08&until=2026-11-09",
    );
    expect(response.since).toBe("2026-11-08T08:00:00.000Z");
    expect(response.until).toBe("2026-11-09T08:00:00.000Z");
    expect(periods(response)).toEqual([["2026-11-08", 1]]);
  });
});

const MIXED: readonly SyntheticSession[] = [
  {
    source: "claude",
    id: "local-claude",
    workspace: "/repo/alpha",
    events: [
      { at: "2026-11-09T10:00:00.000Z", input: 1000, output: 100, costUsd: 1 },
      {
        at: "2026-11-09T11:00:00.000Z",
        model: "claude-haiku-5-5",
        input: 10,
        output: 1,
        cacheRead: 500,
        cacheWrite: 50,
        costUsd: 0.25,
      },
    ],
  },
  {
    source: "claude-mirror",
    id: "desktop/remote-claude",
    machine: "desktop",
    workspace: "/repo/beta",
    events: [
      { at: "2026-11-09T12:00:00.000Z", input: 2000, output: 200, costUsd: 2 },
    ],
  },
  {
    source: "codex",
    id: "local-codex",
    workspace: "/repo/alpha",
    events: [
      {
        at: "2026-11-09T13:00:00.000Z",
        model: "gpt-unknown",
        input: 300,
        output: 30,
        costUsd: null,
      },
      {
        at: "2026-11-09T13:30:00.000Z",
        model: "gpt-empty",
        input: 0,
        output: 0,
        costUsd: null,
      },
    ],
  },
];

describe("usage period report breakdowns", () => {
  test("totals every period and lists unpriced billable models", async () => {
    const fixture = await open(MIXED);
    const response = await report(fixture, "period=day&timezone=UTC");
    expect(response.breakdown).toEqual([]);
    expect(response.periods[0]?.breakdown).toEqual([]);
    expect(response.total).toEqual({
      inputTokens: 3310,
      outputTokens: 331,
      cacheReadTokens: 500,
      cacheCreationTokens: 50,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 4191,
      events: 5,
      costUsd: 3.25,
      costComplete: false,
      unpricedModels: ["gpt-unknown"],
    });
  });

  test("counts a mirror as its agent and splits it by machine", async () => {
    const fixture = await open(MIXED);
    const byAgent = await report(
      fixture,
      "period=day&breakdown=agent&timezone=UTC",
    );
    expect(
      byAgent.periods[0]?.breakdown.map((row) => [
        row.agent,
        row.machine,
        row.events,
      ]),
    ).toEqual([
      ["claude", null, 3],
      ["codex", null, 2],
    ]);
    const byAgentMachine = await report(
      fixture,
      "period=day&breakdown=machine,agent&timezone=UTC",
    );
    expect(byAgentMachine.breakdown).toEqual(["agent", "machine"]);
    expect(
      byAgentMachine.periods[0]?.breakdown.map((row) => [
        row.agent,
        row.machine,
        row.costUsd,
      ]),
    ).toEqual([
      ["claude", "desktop", 2],
      ["claude", null, 1.25],
      ["codex", null, 0],
    ]);
  });

  test("breaks down by model and project together", async () => {
    const fixture = await open(MIXED);
    const response = await report(
      fixture,
      "period=week&breakdown=model,project&timezone=UTC",
    );
    expect(
      response.periods[0]?.breakdown.map((row) => [
        row.agent,
        row.model,
        row.project,
        row.totalTokens,
      ]),
    ).toEqual([
      [null, "claude-opus-5-5", "/repo/beta", 2200],
      [null, "claude-opus-5-5", "/repo/alpha", 1100],
      [null, "claude-haiku-5-5", "/repo/alpha", 561],
      [null, "gpt-unknown", "/repo/alpha", 330],
      [null, "gpt-empty", "/repo/alpha", 0],
    ]);
  });

  test("filters by agent, source, machine, and project", async () => {
    const fixture = await open(MIXED);
    const total = async (query: string) => {
      const response = await report(
        fixture,
        `period=month&timezone=UTC&${query}`,
      );
      return response.total.events;
    };
    expect(await total("agent=claude")).toBe(3);
    expect(await total("source=claude-mirror")).toBe(1);
    expect(await total("agent=claude&machine=local")).toBe(2);
    expect(await total("machine=desktop")).toBe(1);
    expect(await total("project=/repo/alpha")).toBe(4);
    const codex = await report(
      fixture,
      "period=month&timezone=UTC&agent=codex",
    );
    expect(codex.filters).toEqual({
      agent: "codex",
      source: null,
      machine: null,
      project: null,
    });
    expect(codex.total.unpricedModels).toEqual(["gpt-unknown"]);
    const claude = await report(
      fixture,
      "period=month&timezone=UTC&agent=claude",
    );
    expect(claude.total.unpricedModels).toEqual([]);
    expect(claude.total.costComplete).toBe(true);
  });

  test("keeps the groupBy shape when no period is asked for", async () => {
    const fixture = await open(MIXED);
    const { status, body } = await fixture.get("/v1/usage?groupBy=source");
    expect(status).toBe(200);
    expect(
      HistoryApiUsageResponseSchema.parse(body).rows.map((row) => row.key),
    ).toEqual(["claude-mirror", "claude", "codex"]);
  });

  test.each([
    ["period=hour", "period must be one of day, week, month"],
    ["period=day&groupBy=day", "period and groupBy cannot be combined"],
    ["breakdown=agent", "breakdown requires period=day|week|month"],
    [
      "period=day&breakdown=agent,repo",
      "breakdown must be a comma-separated list of agent, model, project, machine",
    ],
    ["period=day&timezone=Mars/Olympus", 'Unknown timezone "Mars/Olympus"'],
    [
      "period=day&startOfWeek=friday",
      "startOfWeek must be one of monday, sunday",
    ],
    ["period=day&agent=claude-mirror", "Unknown agent"],
    [
      "period=day&since=2026-11-09&until=2026-11-08",
      "since must be before until",
    ],
    ["period=day&until=soon", "until must be"],
  ])("rejects %s", async (query, message) => {
    const fixture = await open(MIXED);
    const { status, body } = await fixture.get(`/v1/usage?${query}`);
    expect(status).toBe(400);
    expect(HistoryApiErrorSchema.parse(body).error).toContain(message);
  });
});
