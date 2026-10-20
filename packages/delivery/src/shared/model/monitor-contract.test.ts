import { describe, expect, test } from "vitest";
import {
  MonitorObservationSchema,
  MonitorQuerySchema,
  MonitorSchema,
  MonitorStatusSchema,
  monitorOutcome,
  renderMonitorQuery,
  unknownMonitorPlaceholders,
  WatchingMonitorSchema,
} from "./monitor-contract.ts";

const scoutProd = {
  component: "image:scout-for-lol",
  alarms: {
    matchers: { alertname: "~Scout.*", environment: "prod" },
  },
  evidence: [
    {
      key: "matches-processed",
      query:
        'sum(increase(scout_durable_receipts_recorded_total{environment="prod",git_sha="$gitSha",outcome="applied"}[$window]))',
      threshold: 50,
    },
    {
      key: "discord-interactions",
      query:
        'sum(increase(discord_commands_total{environment="prod",git_sha="$gitSha"}[$window]))',
      threshold: 20,
    },
  ],
  policy: "automatic",
};

describe("MonitorSchema", () => {
  test("parses the Scout prod monitor with default severities", () => {
    const monitor = MonitorSchema.parse(scoutProd);
    expect(monitor.alarms.severities).toEqual(["warning", "critical"]);
    expect(monitor.evidence.map((entry) => entry.key)).toEqual([
      "matches-processed",
      "discord-interactions",
    ]);
  });

  test("allows only the window, version and gitSha placeholders", () => {
    expect(
      MonitorQuerySchema.safeParse('up{v="$version"}[$window]').success,
    ).toBe(true);
    expect(MonitorQuerySchema.safeParse('x{job=~"a.*$"}').success).toBe(true);
    const result = MonitorQuerySchema.safeParse(
      'sum(rate(x{env="$environment"}[$window])) > $threshold',
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(
      /found \$environment, \$threshold/u,
    );
    expect(unknownMonitorPlaceholders("$gitSha $sha")).toEqual(["sha"]);
  });

  test.each([
    [
      "matchers without an environment label",
      { alarms: { matchers: { alertname: "~Scout.*" } } },
    ],
    ["no evidence", { evidence: [] }],
    [
      "a zero threshold",
      { evidence: [{ key: "k", query: "up", threshold: 0 }] },
    ],
    [
      "duplicate evidence keys",
      {
        evidence: [
          { key: "k", query: "up", threshold: 1 },
          { key: "k", query: "down", threshold: 1 },
        ],
      },
    ],
    ["a chart as the observed component", { component: "chart:scout-prod" }],
    ["an unknown policy", { policy: "page" }],
  ])("refuses %s", (_name, overrides) => {
    expect(
      MonitorSchema.safeParse({ ...scoutProd, ...overrides }).success,
    ).toBe(false);
  });
});

describe("observations", () => {
  const monitor = MonitorSchema.parse(scoutProd);
  const base = {
    observedAt: "2026-10-20T12:00:00.000Z",
    window: "17m",
    alarms: [],
    evidence: { "matches-processed": 60, "discord-interactions": 25 },
  };

  test("renders placeholders from the accepted artifact", () => {
    expect(
      renderMonitorQuery('x{git_sha="$gitSha",v="$version"}[$window]', {
        window: "17m",
        version: "1.2.3",
        gitSha: "a".repeat(40),
      }),
    ).toBe(`x{git_sha="${"a".repeat(40)}",v="1.2.3"}[17m]`);
  });

  test("classifies settled, watching and alarmed observations", () => {
    expect(monitorOutcome(monitor, base)).toBe("settled");
    expect(
      monitorOutcome(monitor, {
        ...base,
        evidence: { "matches-processed": 60, "discord-interactions": 3 },
      }),
    ).toBe("watching");
    expect(
      monitorOutcome(monitor, {
        ...base,
        evidence: { "matches-processed": 60 },
      }),
    ).toBe("watching");
    expect(
      monitorOutcome(monitor, {
        ...base,
        alarms: [{ alertname: "ScoutDown", severity: "critical", labels: {} }],
      }),
    ).toBe("alarmed");
    expect(
      monitorOutcome(monitor, {
        ...base,
        alarms: [{ alertname: "ScoutNoisy", severity: "info", labels: {} }],
      }),
    ).toBe("settled");
  });

  test("records observations, watching deployments and status consistently", () => {
    const observation = MonitorObservationSchema.parse({
      ...base,
      id: "obs-1",
      deploymentId: "dep-1",
      sequence: 1,
      outcome: "settled",
      createdAt: base.observedAt,
    });
    expect(observation.alarms).toEqual([]);
    expect(
      MonitorObservationSchema.safeParse({ ...observation, window: "0m" })
        .success,
    ).toBe(false);
    const watching = {
      deploymentId: "dep-1",
      environmentId: "scout-for-lol/prod",
      serviceId: "scout-for-lol",
      acceptedAt: base.observedAt,
      monitor: scoutProd,
      artifact: {
        component: "image:scout-for-lol",
        version: "2026.10.20",
        gitSha: "b".repeat(40),
        digest: `sha256:${"c".repeat(64)}`,
      },
    };
    expect(WatchingMonitorSchema.safeParse(watching).success).toBe(true);
    expect(
      WatchingMonitorSchema.safeParse({
        ...watching,
        artifact: { ...watching.artifact, component: "image:other" },
      }).success,
    ).toBe(false);
    const status = {
      deploymentId: "dep-1",
      state: "settled",
      policy: "automatic",
      settledAt: base.observedAt,
      alarmedAt: null,
      observations: 3,
    };
    expect(MonitorStatusSchema.safeParse(status).success).toBe(true);
    expect(
      MonitorStatusSchema.safeParse({ ...status, settledAt: null }).success,
    ).toBe(false);
    expect(
      MonitorStatusSchema.safeParse({
        ...status,
        state: "alarmed",
        alarmedAt: null,
      }).success,
    ).toBe(false);
    expect(
      MonitorStatusSchema.safeParse({
        deploymentId: null,
        state: "unmonitored",
        policy: null,
        settledAt: null,
        alarmedAt: null,
        observations: 0,
      }).success,
    ).toBe(true);
    expect(
      MonitorStatusSchema.safeParse({
        ...status,
        state: "watching",
        policy: null,
      }).success,
    ).toBe(false);
  });
});
