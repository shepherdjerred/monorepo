import { describe, expect, test } from "vitest";
import { renderMonitorQuery } from "./contract.ts";
import {
  MonitorObservationSchema,
  MonitorQuerySchema,
  MonitorSchema,
  MonitorStatusSchema,
  monitorOutcome,
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
  ],
  policy: "automatic",
};

/** An accepted deployment and its claim, the instant alarms count from (W2). */
const ACCEPTED = {
  deploymentId: "dep-1",
  claimedAt: "2026-10-20T11:00:00.000Z",
};

describe("MonitorSchema", () => {
  test("parses the Scout prod monitor with default severities", () => {
    const monitor = MonitorSchema.parse(scoutProd);
    expect(monitor.alarms.severities).toEqual(["warning", "critical"]);
    expect(monitor.evidence.map((entry) => entry.key)).toEqual([
      "matches-processed",
    ]);
  });

  test("allows only the declared placeholders", () => {
    expect(
      MonitorQuerySchema.safeParse(
        'sum_over_time(up{v="$version",sha="$gitSha"}[$window]) and (timestamp(up) >= $acceptedAt)',
      ).success,
    ).toBe(true);
    expect(MonitorQuerySchema.safeParse('x{job=~"a.*$"}').success).toBe(true);
    const result = MonitorQuerySchema.safeParse(
      'sum(rate(x{env="$environment"}[$window])) > $threshold',
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(
      /found \$environment, \$threshold/u,
    );
    expect(
      unknownMonitorPlaceholders("$gitSha $sha $acceptedAt $acceptedAtMs"),
    ).toEqual(["sha", "acceptedAtMs"]);
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

describe("renderMonitorQuery", () => {
  const values = {
    window: "17m",
    version: "1.2.3",
    gitSha: "a".repeat(40),
  };

  test("renders existing templates without an acceptance value", () => {
    expect(
      renderMonitorQuery('x{git_sha="$gitSha",v="$version"}[$window]', values),
    ).toBe(`x{git_sha="${values.gitSha}",v="1.2.3"}[17m]`);
  });

  test("renders acceptance as an unquoted epoch scalar with millisecond precision", () => {
    expect(
      renderMonitorQuery(
        "(timestamp(x) >= $acceptedAt) and (x > $acceptedAt)",
        {
          ...values,
          acceptedAt: 1_792_627_200.123,
        },
      ),
    ).toBe("(timestamp(x) >= 1792627200.123) and (x > 1792627200.123)");
  });

  test.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses missing or non-finite acceptance time (%s)",
    (acceptedAt) => {
      expect(() =>
        renderMonitorQuery("timestamp(x) >= $acceptedAt", {
          ...values,
          ...(acceptedAt === undefined ? {} : { acceptedAt }),
        }),
      ).toThrow("$acceptedAt requires finite epoch seconds");
    },
  );
});

describe("observations", () => {
  const monitor = MonitorSchema.parse(scoutProd);
  const base = {
    observedAt: "2026-10-20T12:00:00.000Z",
    window: "17m",
    alarms: [],
    evidence: { "matches-processed": 60 },
  };

  test("classifies settled, watching and alarmed observations", () => {
    expect(monitorOutcome(monitor, base)).toBe("settled");
    expect(
      monitorOutcome(monitor, {
        ...base,
        evidence: { "matches-processed": 49 },
      }),
    ).toBe("watching");
    expect(monitorOutcome(monitor, { ...base, evidence: {} })).toBe("watching");
    expect(
      monitorOutcome(monitor, {
        ...base,
        alarms: [
          {
            alertname: "ScoutDown",
            severity: "critical",
            labels: {},
            activeAt: base.observedAt,
          },
        ],
      }),
    ).toBe("alarmed");
    expect(
      monitorOutcome(monitor, {
        ...base,
        alarms: [
          {
            alertname: "ScoutNoisy",
            severity: "info",
            labels: {},
            activeAt: base.observedAt,
          },
        ],
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
      ...ACCEPTED,
      state: "settled",
      policy: "automatic",
      settledAt: base.observedAt,
      alarmedAt: null,
      observations: 3,
      monitor: scoutProd,
      latestObservation: observation,
    };
    expect(MonitorStatusSchema.safeParse(status).success).toBe(true);
    expect(
      MonitorStatusSchema.safeParse({ ...status, latestObservation: null })
        .success,
    ).toBe(false);
    expect(
      MonitorStatusSchema.safeParse({
        ...status,
        latestObservation: { ...observation, deploymentId: "dep-2" },
      }).success,
    ).toBe(false);
    expect(
      MonitorStatusSchema.safeParse({ ...status, policy: "hold" }).success,
    ).toBe(false);
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
        claimedAt: null,
        state: "unmonitored",
        policy: null,
        settledAt: null,
        alarmedAt: null,
        observations: 0,
        monitor: null,
        latestObservation: null,
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

  test.each([
    ["a watching monitor with a settlement time", { state: "watching" }],
    [
      "a watching monitor with an alarm time",
      {
        state: "watching",
        settledAt: null,
        alarmedAt: "2026-10-20T12:05:00.000Z",
      },
    ],
    [
      "a settled monitor with an alarm time",
      { state: "settled", alarmedAt: "2026-10-20T12:05:00.000Z" },
    ],
    [
      "an alarmed monitor with a settlement time",
      { state: "alarmed", alarmedAt: "2026-10-20T12:05:00.000Z" },
    ],
    [
      "an unmonitored selection with an alarm time",
      {
        state: "unmonitored",
        policy: null,
        alarmedAt: "2026-10-20T12:05:00.000Z",
      },
    ],
  ])("refuses %s", (_name, fields) => {
    const status = {
      ...ACCEPTED,
      state: "settled",
      policy: "automatic",
      settledAt: "2026-10-20T12:00:00.000Z",
      alarmedAt: null,
      observations: 0,
      monitor: scoutProd,
      latestObservation: null,
    };
    expect(
      MonitorStatusSchema.safeParse({ ...status, ...fields }).success,
    ).toBe(false);
  });

  test("accepts an unmonitored selection that settled on acceptance", () => {
    expect(
      MonitorStatusSchema.safeParse({
        ...ACCEPTED,
        state: "unmonitored",
        policy: null,
        settledAt: "2026-10-20T12:00:00.000Z",
        alarmedAt: null,
        observations: 0,
        monitor: null,
        latestObservation: null,
      }).success,
    ).toBe(true);
  });
});

test("a monitor status carries the claim time exactly for an accepted deployment", () => {
  const accepted = {
    ...ACCEPTED,
    state: "unmonitored",
    policy: null,
    settledAt: null,
    alarmedAt: null,
    observations: 0,
    monitor: null,
    latestObservation: null,
  };
  expect(MonitorStatusSchema.safeParse(accepted).success).toBe(true);
  expect(
    MonitorStatusSchema.safeParse({ ...accepted, claimedAt: null }).success,
  ).toBe(false);
  expect(
    MonitorStatusSchema.safeParse({ ...accepted, deploymentId: null }).success,
  ).toBe(false);
});
