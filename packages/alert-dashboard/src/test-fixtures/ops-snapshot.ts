import { Temporal } from "@js-temporal/polyfill";
import { assembleSnapshot } from "@shepherdjerred/ops-model/assemble.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import {
  SOURCE_IDS,
  parseOpsIngest,
  type ChangeEventInput,
  type Metric,
  type OpsIngest,
  type SectionId,
  type SignalInput,
  type SourceId,
} from "@shepherdjerred/ops-model/snapshot.ts";

import { toContractDate } from "#shared/time";

type FixtureMetric = Metric & { section: SectionId };

function metric(
  placement: { section: SectionId; source: SourceId },
  id: string,
  label: string,
  reading: {
    value: number | null;
    unit?: Metric["unit"];
    severity?: Metric["severity"];
  },
): FixtureMetric {
  return {
    ...placement,
    id,
    label,
    value: reading.value,
    unit: reading.unit ?? "count",
    severity: reading.severity ?? "ok",
  };
}

function ago(now: Temporal.Instant, hours: number): string {
  return now.subtract({ minutes: Math.round(hours * 60) }).toString();
}

function signals(now: Temporal.Instant): SignalInput[] {
  const github = "https://github.com/shepherdjerred/monorepo";
  return [
    {
      id: "alert:HomelabBackupStale",
      source: "alerts",
      section: "alerts",
      service: "storage",
      kind: "alert",
      severity: "error",
      needsMe: true,
      title: "Velero backup is 41 hours old",
      detail: "HomelabBackupStale · critical · firing 2h",
      since: ago(now, 2),
      links: [
        {
          kind: "native",
          label: "Alert",
          url: "https://alerts.tailnet-1a49.ts.net/alerts",
        },
      ],
    },
    {
      id: "argocd:scout-beta",
      source: "argocd",
      section: "platform",
      service: "scout-for-lol",
      kind: "argo-app",
      severity: "warning",
      needsMe: false,
      title: "scout-beta is OutOfSync",
      detail: "OutOfSync for 42 minutes · Healthy",
      since: ago(now, 0.7),
      links: [
        {
          kind: "argocd",
          label: "Argo CD",
          url: "https://argocd.tailnet-1a49.ts.net/applications/argocd/scout-beta",
        },
      ],
    },
    {
      id: "github:pr:3071",
      source: "github",
      section: "delivery",
      kind: "pull-request",
      severity: "info",
      needsMe: true,
      title: "#3071 feat(scout): season recap cards",
      detail: "Agent PR ready for review · CI green · 2 days old",
      since: ago(now, 50),
      links: [{ kind: "github", label: "PR", url: `${github}/pull/3071` }],
    },
    {
      id: "github:pr:3040",
      source: "github",
      section: "delivery",
      kind: "pull-request",
      severity: "warning",
      needsMe: false,
      title: "#3040 chore(homelab): bump Talos to 1.12",
      detail: "Stale 9 days · merge conflict",
      since: ago(now, 9 * 24),
      links: [{ kind: "github", label: "PR", url: `${github}/pull/3040` }],
    },
    {
      id: "ci:main",
      source: "ci",
      section: "delivery",
      kind: "ci-main",
      severity: "ok",
      needsMe: false,
      title: "main is green",
      links: [
        {
          kind: "buildkite",
          label: "Buildkite",
          url: "https://buildkite.com/shepherdjerred/monorepo",
        },
      ],
    },
    {
      id: "renovate:approve:react-router",
      source: "renovate",
      section: "delivery",
      kind: "renovate-approval",
      severity: "info",
      needsMe: true,
      title: "Renovate: approve react-router 8.4",
      links: [
        { kind: "github", label: "Dashboard", url: `${github}/issues/1` },
      ],
    },
    {
      id: "linear:AI-412",
      source: "linear",
      section: "work",
      kind: "linear-issue",
      severity: "info",
      needsMe: true,
      title: "SJ-88 Wi-Fi drops on the office AP",
      detail: "Triage · 3 days",
      since: ago(now, 72),
      links: [
        {
          kind: "linear",
          label: "Linear",
          url: "https://linear.app/sjerred/issue/SJ-88",
        },
      ],
    },
    {
      id: "bugsink:birmel:1882",
      source: "bugsink",
      section: "errors",
      service: "birmel",
      kind: "bugsink-issue",
      severity: "warning",
      needsMe: false,
      title: "TypeError: Cannot read properties of undefined (reading 'guild')",
      detail: "birmel · 14 events in 24h · new",
      since: ago(now, 6),
      links: [
        {
          kind: "bugsink",
          label: "Bugsink",
          url: "https://bugsink.tailnet-1a49.ts.net/issues/issue/1882/",
        },
      ],
    },
    {
      id: "maintenance:cert:grafana",
      source: "maintenance",
      section: "maintenance",
      service: "observability",
      kind: "certificate",
      severity: "warning",
      needsMe: false,
      title: "grafana.tailnet-1a49.ts.net certificate expires in 9 days",
      since: ago(now, 30),
    },
    {
      id: "maintenance:disk:zfs-tank",
      source: "maintenance",
      section: "maintenance",
      service: "storage",
      kind: "disk",
      severity: "ok",
      needsMe: false,
      title: "ZFS pool tank is 71% full",
    },
    ...quotaSignals(now),
  ];
}

function quotaSignals(now: Temporal.Instant): SignalInput[] {
  const windows = [
    ["claude", "5h", "session", 0.62, 3],
    ["claude", "7d", "weekly", 0.84, 60],
    ["codex", "5h", "session", 0.18, 4],
    ["codex", "7d", "weekly", 0.41, 110],
  ] as const;
  return windows.map(
    ([provider, windowId, windowKind, usedRatio, resetHours]) => ({
      id: `ai:quota:${provider}:${windowId}`,
      source: "ai",
      section: "ai",
      kind: "quota-window",
      severity: usedRatio >= 0.8 ? "warning" : "ok",
      needsMe: false,
      title: `${provider} ${windowKind} window ${String(Math.round(usedRatio * 100))}% used`,
      attributes: {
        provider,
        windowId,
        windowKind,
        usedRatio,
        resetsAt: now.add({ hours: resetHours }).toString(),
      },
    }),
  );
}

function metrics(): FixtureMetric[] {
  return [
    metric(
      { section: "alerts", source: "alerts" },
      METRIC_IDS.alertsFiring,
      "Firing",
      { value: 3, severity: "error" },
    ),
    metric(
      { section: "alerts", source: "alerts" },
      METRIC_IDS.alertsCritical,
      "Critical",
      { value: 1, severity: "error" },
    ),
    metric(
      { section: "platform", source: "kubernetes" },
      METRIC_IDS.nodesReady,
      "Nodes ready",
      { value: 1 },
    ),
    metric(
      { section: "platform", source: "kubernetes" },
      METRIC_IDS.podsUnhealthy,
      "Unhealthy pods",
      { value: 0 },
    ),
    metric(
      { section: "platform", source: "argocd" },
      METRIC_IDS.argoAppsOutOfSync,
      "Apps out of sync",
      { value: 1, severity: "warning" },
    ),
    metric(
      { section: "platform", source: "kubernetes" },
      METRIC_IDS.cpuUsedRatio,
      "CPU used",
      { value: 0.37, unit: "ratio" },
    ),
    metric(
      { section: "delivery", source: "github" },
      METRIC_IDS.prsOpen,
      "Open PRs",
      { value: 7 },
    ),
    metric(
      { section: "delivery", source: "github" },
      METRIC_IDS.prsMerged7d,
      "Merged 7d",
      { value: 23 },
    ),
    metric(
      { section: "delivery", source: "github" },
      METRIC_IDS.prMedianHoursToMerge30d,
      "Median hours to merge",
      { value: 5.5, unit: "hours" },
    ),
    metric(
      { section: "delivery", source: "renovate" },
      METRIC_IDS.renovatePending,
      "Renovate pending",
      { value: 4, severity: "info" },
    ),
    metric(
      { section: "work", source: "linear" },
      METRIC_IDS.linearOpen,
      "Open issues",
      { value: 31 },
    ),
    metric(
      { section: "work", source: "linear" },
      METRIC_IDS.linearTriage,
      "In triage",
      { value: 2, severity: "info" },
    ),
    metric(
      { section: "errors", source: "bugsink" },
      METRIC_IDS.bugsinkUnresolved,
      "Unresolved",
      { value: 12, severity: "warning" },
    ),
    metric(
      { section: "product", source: "probes" },
      METRIC_IDS.probesDown,
      "Probes down",
      { value: 0 },
    ),
    metric(
      { section: "ai", source: "ai" },
      METRIC_IDS.aiCostMonthToDateUsd,
      "Spend MTD",
      { value: 86.4, unit: "usd" },
    ),
    metric(
      { section: "ai", source: "ai" },
      METRIC_IDS.aiCostProjectedUsd,
      "Projected month",
      { value: 112.1, unit: "usd" },
    ),
    metric(
      { section: "ai", source: "ai" },
      METRIC_IDS.aiTokens24h,
      "Tokens 24h",
      { value: 18_400_000, unit: "tokens" },
    ),
    metric(
      { section: "ai", source: "ai" },
      METRIC_IDS.aiQuotaMaxUsedRatio,
      "Max quota used",
      { value: 0.84, unit: "ratio", severity: "warning" },
    ),
    metric(
      { section: "maintenance", source: "maintenance" },
      METRIC_IDS.diskMaxUsedRatio,
      "Max disk used",
      { value: 0.71, unit: "ratio" },
    ),
    metric(
      { section: "maintenance", source: "maintenance" },
      METRIC_IDS.certificatesExpiringSoon,
      "Certs expiring",
      { value: 1, severity: "warning" },
    ),
    metric(
      { section: "maintenance", source: "maintenance" },
      METRIC_IDS.backupsStale,
      "Stale backups",
      { value: 1, severity: "error" },
    ),
    metric(
      { section: "observability", source: "logs" },
      METRIC_IDS.logErrors1h,
      "Error logs 1h",
      { value: 214 },
    ),
  ];
}

function changes(now: Temporal.Instant): ChangeEventInput[] {
  return [
    {
      source: "argocd",
      externalId: "scout-beta:1042",
      kind: "sync",
      service: "scout-for-lol",
      title: "scout-beta synced to 8f3c2d1",
      occurredAt: ago(now, 1),
      severity: "info",
      url: "https://argocd.tailnet-1a49.ts.net/applications/argocd/scout-beta",
    },
    {
      source: "github",
      externalId: "pr:3066",
      kind: "merge",
      service: "scout-for-lol",
      title: "Merged #3066 fix(scout): recap timezone",
      occurredAt: ago(now, 5),
      severity: "info",
      url: "https://github.com/shepherdjerred/monorepo/pull/3066",
    },
    {
      source: "argocd",
      externalId: "birmel:77",
      kind: "deploy",
      service: "birmel",
      title: "birmel deployed 2.14.0",
      occurredAt: ago(now, 7),
      severity: "info",
    },
  ];
}

/**
 * A realistic, ops-model-valid ingest body: every section populated, one
 * source (PostHog) failed so the product section renders `unknown`.
 */
export function fixtureOpsIngest(generatedAt: string): OpsIngest {
  const now = Temporal.Instant.from(generatedAt);
  const snapshot = assembleSnapshot({
    generatedAt: toContractDate(now),
    sources: SOURCE_IDS.map((source) => ({
      source,
      ok: source !== "posthog",
      observedAt: now.toString(),
      durationMs: 120,
      ...(source === "posthog" ? { error: "PostHog query timed out" } : {}),
    })),
    signals: signals(now),
    metrics: metrics(),
  });
  return parseOpsIngest({ snapshot, changes: changes(now) });
}
