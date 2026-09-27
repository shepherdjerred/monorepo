import { describe, expect, test } from "vitest";
import type { BugsinkIssue } from "@shepherdjerred/ops-clients/bugsink.ts";
import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import {
  mapAi,
  monthProgress,
  monthToDateWindow,
  quotaSeverity,
  type AiSamples,
} from "./ai.ts";
import { mapBugsink, unresolvedByProject } from "./bugsink.ts";
import { mapLogs } from "./logs.ts";
import {
  certificateSeverity,
  diskSeverity,
  mapMaintenance,
  type MaintenanceSamples,
} from "./maintenance.ts";
import { mapPostHog, mapProbes } from "./product.ts";

const now = new Date("2026-09-24T12:00:00.000Z");
const context = { now, services: new ServiceIndex() };

function hoursAgo(hours: number): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

function sample(
  value: number,
  metric: Record<string, string> = {},
): PrometheusSample {
  return { metric, value };
}

function issue(id: string, overrides: Partial<BugsinkIssue>): BugsinkIssue {
  return {
    id,
    projectId: 1,
    firstSeen: hoursAgo(100),
    lastSeen: hoursAgo(1),
    events: 3,
    type: "TypeError",
    value: "boom",
    transaction: "GET /",
    muted: false,
    ...overrides,
  };
}

describe("bugsink", () => {
  test("new issues warn, old ones inform, muted and long-quiet ones are skipped", () => {
    const projects = [
      {
        project: { id: 1, name: "Birmel", slug: "birmel" },
        issues: [
          issue("new", { firstSeen: hoursAgo(2) }),
          issue("old", {}),
          issue("muted", { muted: true }),
          issue("quiet", { lastSeen: hoursAgo(24 * 30) }),
        ],
      },
    ];
    const result = mapBugsink(projects, context);
    expect(result.signals.map((s) => [s.id, s.severity, s.service])).toEqual([
      ["bugsink:issue:new", "warning", "birmel"],
      ["bugsink:issue:old", "info", "birmel"],
    ]);
    expect(result.signals[0]?.links?.[0]?.url).toBe(
      "https://bugsink.sjer.red/issues/issue/new/event/last/",
    );
    expect(result.metrics[0]?.value).toBe(3);
    expect(unresolvedByProject(projects).get("birmel")).toBe(3);
  });
});

describe("product", () => {
  test("down probes are errors mapped to a service", () => {
    const result = mapProbes(
      [
        sample(1, {
          job: "probe-birmel-internal",
          namespace: "birmel",
          service: "birmel",
          path: "internal",
        }),
        sample(0, {
          job: "probe-birmel-public",
          namespace: "birmel",
          service: "birmel",
          path: "public",
          instance: "x",
        }),
        sample(0, {
          job: "static-site-sjer.red",
          site: "sjer.red",
          endpoint: "root",
          instance: "https://sjer.red",
        }),
        // Live static-site probes carry namespace and path but no service.
        sample(0, {
          job: "probe-s3-static-sites-public",
          namespace: "s3-static-sites",
          path: "/app/",
        }),
      ],
      context,
    );
    expect(result.signals.map((s) => [s.title, s.service])).toEqual([
      ["birmel/birmel (public) is down", "birmel"],
      ["sjer.red is down", "static-sites"],
      ["s3-static-sites (/app/) is down", "static-sites"],
    ]);
    expect(result.metrics[0]).toMatchObject({ value: 3, severity: "error" });
  });

  test("every catalogued site gets a traffic signal", () => {
    const result = mapPostHog(
      [
        { siteKey: "scout-prod", host: "scout-for-lol.com", pageviews: 100 },
        { siteKey: "scout-prod", host: "www.scout-for-lol.com", pageviews: 5 },
      ],
      [{ host: "scout-for-lol.com", path: "/", pageviews: 80 }],
      context,
    );
    const scout = result.signals.find(
      (s) => s.id === "posthog:site:scout-prod",
    );
    expect(scout).toMatchObject({
      service: "scout-for-lol",
      title: "scout-prod: 105 pageviews (24h)",
      detail: "Top: / (80)",
    });
    expect(
      result.signals.find((s) => s.id === "posthog:site:resume")?.title,
    ).toBe("resume: 0 pageviews (24h)");
    expect(result.metrics[0]?.value).toBe(105);
  });
});

function maintenance(
  overrides: Partial<MaintenanceSamples>,
): MaintenanceSamples {
  return {
    certificates: [],
    probeCertificates: [],
    filesystems: [],
    zpools: [],
    seaweedfsBackups: [],
    veleroBackups: [],
    cpu: [sample(0.25)],
    memory: [sample(0.5)],
    ...overrides,
  };
}

describe("maintenance", () => {
  test("threshold policies", () => {
    expect(certificateSeverity(20 * 86_400)).toBe("ok");
    expect(certificateSeverity(10 * 86_400)).toBe("warning");
    expect(certificateSeverity(3 * 86_400)).toBe("error");
    expect(diskSeverity(0.5)).toBe("ok");
    expect(diskSeverity(0.85)).toBe("warning");
    expect(diskSeverity(0.95)).toBe("error");
  });

  test("lists expiring certificates, full disks, and stale backups", () => {
    const result = mapMaintenance(
      maintenance({
        certificates: [
          sample(5 * 86_400, { namespace: "postal", name: "smtp" }),
        ],
        zpools: [sample(0.92, { zpool_name: "tank" })],
        filesystems: [
          sample(0.3, { instance: "torvalds", mountpoint: "/var" }),
          sample(0.82, { instance: "liskov", mountpoint: "/var/mnt/ci" }),
        ],
        seaweedfsBackups: [sample(40 * 3600, { cadence: "daily" })],
        veleroBackups: [sample(3600, { schedule: "nightly" })],
      }),
    );
    expect(result.signals.map((s) => [s.id, s.severity])).toEqual([
      ["maintenance:certificate:postal/smtp", "error"],
      ["maintenance:filesystem:liskov:/var/mnt/ci", "warning"],
      ["maintenance:zpool:zpool tank", "error"],
      ["maintenance:backup:SeaweedFS daily", "warning"],
    ]);
    expect(result.signals[1]).toMatchObject({
      kind: "filesystem",
      attributes: {
        instance: "liskov",
        mountpoint: "/var/mnt/ci",
        usedRatio: 0.82,
      },
    });
    expect(result.signals[2]?.attributes).toEqual({
      zpool: "tank",
      usedRatio: 0.92,
    });
    const metrics = Object.fromEntries(
      result.metrics.map((m) => [m.id, [m.value, m.section]]),
    );
    expect(metrics).toEqual({
      "maintenance.disk.max_used_ratio": [0.92, "maintenance"],
      "maintenance.certificates.expiring_soon": [1, "maintenance"],
      "maintenance.backups.stale": [1, "maintenance"],
      "cluster.cpu.used_ratio": [0.25, "platform"],
      "cluster.memory.used_ratio": [0.5, "platform"],
    });
  });

  test("a sample without its identifying label is a broken contract", () => {
    expect(() =>
      mapMaintenance(maintenance({ zpools: [sample(0.5)] })),
    ).toThrow(/zpool_name/);
  });
});

describe("logs", () => {
  test("lists the noisiest namespaces as info and totals every line", () => {
    const result = mapLogs(
      [
        { namespace: "birmel", lines: 12 },
        { namespace: "quiet", lines: 0 },
      ],
      context,
    );
    expect(result.signals.map((s) => [s.id, s.severity, s.service])).toEqual([
      ["logs:errors:birmel", "info", "birmel"],
    ]);
    expect(result.metrics[0]?.value).toBe(12);
  });
});

function ai(overrides: Partial<AiSamples>): AiSamples {
  return {
    clusterMtd: [],
    billedToday: [],
    macCostMtd: [],
    macTokens24h: [],
    clusterTokens24h: [],
    quotas: [],
    quotaResets: [],
    ...overrides,
  };
}

describe("ai", () => {
  test("month progress and window", () => {
    const { start, elapsed } = monthProgress(now);
    expect(start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(elapsed).toBeCloseTo((23.5 * 24) / (30 * 24));
    expect(monthToDateWindow(now)).toBe(`${String(23.5 * 86_400)}s`);
    expect(monthToDateWindow(new Date("2026-10-01T00:00:10Z"))).toBe("60s");
  });

  test("quota thresholds", () => {
    expect(quotaSeverity(0.5)).toBe("ok");
    expect(quotaSeverity(0.8)).toBe("warning");
    expect(quotaSeverity(0.97)).toBe("error");
  });

  test("projects month-end spend and warns before the budget is spent", () => {
    // 80% of the budget spent by the 24th projects past the budget at month end.
    const spent = OPS_POLICY.monthlyApiBudgetUsd * 0.8;
    const result = mapAi(
      ai({
        clusterMtd: [sample(spent)],
        macCostMtd: [sample(310.5, { source: "claude-code" })],
        macTokens24h: [sample(1000)],
        quotas: [
          sample(0.85, {
            provider: "anthropic",
            window_id: "5h",
            window_kind: "session",
          }),
        ],
        quotaResets: [
          sample(Date.parse("2026-09-24T15:00:00Z") / 1000, {
            provider: "anthropic",
            window_id: "5h",
          }),
        ],
      }),
      now,
    );
    const metrics = Object.fromEntries(
      result.metrics.map((m) => [m.id, [m.value, m.severity]]),
    );
    expect(metrics["ai.cost.month_to_date_usd"]).toEqual([spent, "ok"]);
    expect(metrics["ai.cost.projected_month_usd"]?.[1]).toBe("warning");
    expect(metrics["ai.tokens_24h"]).toEqual([1000, "ok"]);
    expect(metrics["ai.quota.max_used_ratio"]).toEqual([0.85, "warning"]);
    expect(result.signals[0]?.attributes).toEqual({
      provider: "anthropic",
      windowId: "5h",
      windowKind: "session",
      usedRatio: 0.85,
      resetsAt: "2026-09-24T15:00:00.000Z",
    });
    expect(result.signals.map((s) => [s.id, s.severity])).toEqual([
      ["ai:quota:anthropic:5h", "warning"],
      ["ai:budget", "warning"],
      ["ai:tool-cost:claude-code", "ok"],
    ]);
  });

  test("no token series at all is null, not zero", () => {
    const result = mapAi(ai({}), now);
    expect(
      result.metrics.find((m) => m.id === "ai.tokens_24h")?.value,
    ).toBeNull();
    expect(result.signals).toEqual([]);
  });
});
