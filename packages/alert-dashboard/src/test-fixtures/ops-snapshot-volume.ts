import { Temporal } from "@js-temporal/polyfill";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import {
  SnapshotResponseSchema,
  type OpsIngest,
  type SignalInput,
  type SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";

import { ago, buildFixtureIngest } from "#test-fixtures/ops-snapshot";
import {
  MONOREPO_URL,
  logsLink,
  metricsLink,
  pullRequestLink,
} from "#test-fixtures/ops-snapshot-volume-links";
import { volumeMetrics } from "#test-fixtures/ops-snapshot-volume-metrics";
import {
  capacitySignals,
  errorSignals,
  observabilitySignals,
  platformSignals,
  productSignals,
  scheduleSignals,
  volumeChanges,
  workSignals,
} from "#test-fixtures/ops-snapshot-volume-sections";
import {
  alertSignals,
  deliverySignals,
} from "#test-fixtures/ops-snapshot-volume-triage";

/**
 * `per-update` is what the collector emits today: one signal per Renovate
 * update. `aggregate` is the same world once the collector groups them.
 */
export type VolumeVariant = "per-update" | "aggregate";

const NPM = `react react-dom react-router hono zod vite vitest typescript eslint
  prettier tailwindcss prisma @prisma/client @tanstack/react-query @trpc/server
  @trpc/client astro @astrojs/starlight discord.js openai @anthropic-ai/sdk
  @temporalio/client @temporalio/worker @temporalio/workflow @opentelemetry/api
  @opentelemetry/sdk-node @playwright/test lucide-react clsx tailwind-merge
  sanitize-html uplot satori @resvg/resvg-js sharp posthog-js posthog-node turbo
  lefthook knip jiti shadcn cdk8s cdk8s-plus-33 constructs kysely pg ioredis
  bullmq commander chalk execa p-limit p-retry remeda ts-pattern type-fest undici
  ws yaml`.split(/\s+/u);
const DOCKER = `postgres redis grafana/grafana grafana/loki grafana/tempo
  prom/prometheus temporalio/server woodpeckerci/woodpecker-server moby/buildkit
  itzg/minecraft-server linuxserver/plex linuxserver/sonarr linuxserver/radarr
  linuxserver/prowlarr linuxserver/qbittorrent freshrss/freshrss
  homeassistant/home-assistant chrislusf/seaweedfs velero/velero
  bugsink/bugsink`.split(/\s+/u);
const HELM =
  `argo-cd cert-manager kube-prometheus-stack loki tempo alloy pyroscope
  velero openebs tailscale-operator external-dns cloudflare-tunnel
  postgres-operator flipt kueue seaweedfs node-feature-discovery
  intel-device-plugins-operator connect chartmuseum`.split(/\s+/u);
const TOOLS = `bun node kubectl talosctl helm mise python rust go gradle ktlint
  swiftformat`.split(/\s+/u);

const DASHBOARD_LINK = {
  kind: "github",
  label: "Dependency Dashboard",
  url: `${MONOREPO_URL}/issues/1`,
} as const;
/** Updates the Dependency Dashboard lists as waiting on status checks. */
const RENOVATE_PENDING_CHECKS = 6;

/** Deterministic `vN` or `vN.N.N`, so titles vary the way Renovate's do. */
function version(index: number): string {
  const major = 2 + (index % 9);
  return index % 3 === 0
    ? `v${String(major)}`
    : `v${String(major)}.${String(index % 7)}.${String(index % 4)}`;
}

function renovateUpdates(): { branch: string; title: string }[] {
  const named = [
    ...NPM.map((name) => [name, `update dependency ${name}`] as const),
    ...DOCKER.map((name) => [name, `update ${name} docker tag`] as const),
    ...HELM.map((name) => [name, `update helm release ${name}`] as const),
  ];
  return named.map(([name, action], index) => {
    const target = version(index);
    const slug = name.replace(/^@/u, "").replaceAll("/", "-");
    return {
      branch: `renovate/${slug}-${target.slice(1).split(".")[0] ?? ""}.x`,
      title: `chore(deps): ${action} to ${target}`,
    };
  });
}

/** `truncateGraphemes(text, 500)` for the ASCII titles this fixture uses. */
function truncated(text: string): string {
  return text.length <= 500 ? text : `${text.slice(0, 499)}…`;
}

function approvalSignals(variant: VolumeVariant): SignalInput[] {
  const updates = renovateUpdates();
  const shared = {
    source: "renovate",
    section: "delivery",
    kind: "renovate-approval",
    severity: "info",
    needsMe: true,
  } as const;
  if (variant === "aggregate") {
    return [
      {
        ...shared,
        id: "renovate:awaiting-approval",
        title: `${String(updates.length)} Renovate updates awaiting approval`,
        detail: truncated(updates.map((update) => update.title).join("; ")),
        attributes: { count: updates.length },
        links: [DASHBOARD_LINK],
      },
    ];
  }
  return updates.map((update) => ({
    ...shared,
    id: `renovate:approve:${update.branch}`,
    title: update.title,
    attributes: { branch: update.branch },
    links: [DASHBOARD_LINK],
  }));
}

function renovatePullRequests(
  now: Temporal.Instant,
  variant: VolumeVariant,
): SignalInput[] {
  const open = TOOLS.map((tool, index) => {
    const number = 4690 + index * 3;
    // Two of the twelve have failing checks.
    const failing = index === 4 || index === 9;
    const hours = 6 + index * 11;
    const signal: SignalInput = {
      id: `renovate:pr:${String(number)}`,
      source: "renovate",
      section: "delivery",
      kind: "renovate-pr",
      severity: failing ? "warning" : "info",
      needsMe: false,
      title: `#${String(number)} chore(deps): update dependency ${tool} to ${version(index + 1)}`,
      since: ago(now, hours),
      attributes: {
        checks: failing ? "FAILURE" : "SUCCESS",
        mergeable: "MERGEABLE",
      },
      links: [pullRequestLink(number)],
    };
    return { signal, failing, hours };
  });
  if (variant === "per-update") return open.map((row) => row.signal);
  const healthy = open.filter((row) => !row.failing);
  return [
    ...open.filter((row) => row.failing).map((row) => row.signal),
    {
      id: "renovate:open-prs",
      source: "renovate",
      section: "delivery",
      kind: "renovate-open-prs",
      severity: "info",
      needsMe: false,
      title: `${String(healthy.length)} Renovate pull requests open`,
      // The oldest healthy pull request.
      since: ago(now, Math.max(...healthy.map((row) => row.hours))),
      attributes: { count: healthy.length },
      links: [DASHBOARD_LINK],
    },
  ];
}

function renovateSignals(
  now: Temporal.Instant,
  variant: VolumeVariant,
): SignalInput[] {
  return [
    ...approvalSignals(variant),
    {
      id: "renovate:pending-checks",
      source: "renovate",
      section: "delivery",
      kind: "renovate-pending",
      severity: "info",
      needsMe: false,
      title: `${String(RENOVATE_PENDING_CHECKS)} updates waiting on status checks`,
      attributes: { count: RENOVATE_PENDING_CHECKS },
      links: [DASHBOARD_LINK],
    },
    ...renovatePullRequests(now, variant),
  ];
}

const RESTORE_WORKLOADS = `plex sonarr radarr freshrss golink home-assistant
  tasknotes scout-beta birmel grafana`.split(/\s+/u);

/** Ten unclassified Velero Restore failures, 30 to 42 days old. */
function restoreSignals(
  now: Temporal.Instant,
  variant: VolumeVariant,
): SignalInput[] {
  return RESTORE_WORKLOADS.map((workload, index) => {
    const name = `restore-drill-${workload}`;
    return {
      id: `maintenance:velero-restore:velero:${name}`,
      source: "maintenance",
      section: "maintenance",
      kind: variant === "aggregate" ? "restore-failure" : "backup-failure",
      severity: "warning",
      needsMe: true,
      title: `Velero restore ${name}: PartiallyFailed`,
      detail:
        "Persisted failed or partial restore requires investigation. A later successful backup does not clear this recovery failure.",
      since: ago(now, (30 + (index * 12) / 9) * 24),
      attributes: {
        namespace: "velero",
        restore: name,
        backupName: `daily-backup-${workload}`,
        errors: 1 + (index % 4),
        classification: "unclassified",
        supersededBy: "",
        ...(variant === "aggregate" ? { phase: "PartiallyFailed" } : {}),
      },
      links: [logsLink("velero")],
    };
  });
}

type QuotaWindow = readonly [
  provider: string,
  windowId: string,
  windowKind: string,
  usedRatio: number,
  resetHours: number,
];

/** Brim's window ids and kinds; the first has reset since its last reading. */
const QUOTA_WINDOWS: readonly QuotaWindow[] = [
  ["claude-code", "five-hour", "rolling", 1, -0.05],
  ["claude-code", "weekly", "weekly", 0.83, 52],
  ["claude-code", "weekly-opus", "modelScoped", 0.97, 52],
  ["codex", "codex-primary-window", "rolling", 0.22, 3.5],
  ["codex", "codex-secondary-window", "weekly", 0.61, 96],
  ["antigravity", "antigravity-gemini-5h", "modelScoped", 0.48, 2],
  ["antigravity", "antigravity-claude-5h", "modelScoped", 0.91, 1.2],
  ["antigravity", "weekly", "weekly", 0.37, 120],
  ["cursor", "monthly", "monthly", 0.74, 260],
  ["grok", "weekly", "weekly", 0.12, 140],
  ["kimi", "five-hour", "rolling", 0.05, 4.4],
  ["kimi", "shared", "providerDefined", 0.29, 400],
  ["muse", "five-hour", "rolling", 0.66, 0.8],
  ["muse", "weekly", "weekly", 0.44, 75],
];

const USED_RATIO = 3;
const RESET_HOURS = 4;

/** `quotaSeverity`: OPS_POLICY warns at 80% and errors at 95%. */
function quotaSeverity(ratio: number): Severity {
  if (ratio >= 0.95) return "error";
  return ratio >= 0.8 ? "warning" : "ok";
}

function quotaSignals(
  now: Temporal.Instant,
  variant: VolumeVariant,
): SignalInput[] {
  return QUOTA_WINDOWS.map(
    ([provider, windowId, windowKind, usedRatio, resetHours]) => {
      const percent = String(Math.round(usedRatio * 100));
      const base = quotaSeverity(usedRatio);
      // Once fixed, the collector titles a window whose reset has passed as
      // reset, and caps one that has reset or resets within six hours at info.
      const reset = variant === "aggregate" && resetHours <= 0;
      const capped =
        variant === "aggregate" && resetHours <= 6 && base !== "ok";
      return {
        id: `ai:quota:${provider}:${windowId}`,
        source: "ai",
        section: "ai",
        kind: "quota-window",
        severity: capped ? "info" : base,
        needsMe: false,
        title: reset
          ? `${provider} ${windowKind}: reset since last reading (was ${percent}%)`
          : `${provider} ${windowKind}: ${percent}% used`,
        attributes: {
          provider,
          windowId,
          windowKind,
          usedRatio,
          resetsAt: ago(now, -resetHours),
        },
        links: [
          metricsLink(
            "Quota usage",
            `ai_subscription_quota_used_ratio{provider="${provider}",window_id="${windowId}"}`,
          ),
        ],
      };
    },
  );
}

const AI_MONTH_TO_DATE_USD = 71.4;
const AI_PROJECTED_USD = 118.2;

function aiSpendSignals(): SignalInput[] {
  const tools = [
    ["claude", 412.37],
    ["codex", 188.02],
    ["antigravity", 64.5],
    ["cursor", 21.18],
    ["kimi", 3.94],
  ] as const;
  return [
    {
      id: "ai:budget",
      source: "ai",
      section: "ai",
      kind: "budget",
      severity: "warning",
      needsMe: false,
      title: `API spend is on track for $${AI_PROJECTED_USD.toFixed(0)} against a $100 budget`,
      attributes: {
        monthToDateUsd: AI_MONTH_TO_DATE_USD,
        projectedUsd: AI_PROJECTED_USD,
        budgetUsd: 100,
      },
      links: [
        metricsLink(
          "Cluster LLM spend",
          'sum(increase(llm_cost_usd_total{type="catalog"}[1d]))',
        ),
      ],
    },
    {
      id: "ai:provider-billed-today",
      source: "ai",
      section: "ai",
      kind: "provider-cost",
      severity: "info",
      needsMe: false,
      title: "Provider-billed LLM cost today: $3.42",
      links: [
        metricsLink(
          "Provider-billed cost",
          'sum by (provider, account) (llm_billed_cost_usd{window="today"})',
        ),
      ],
    },
    ...tools.map(([source, monthToDateUsd]): SignalInput => ({
      id: `ai:tool-cost:${source}`,
      source: "ai",
      section: "ai",
      kind: "tool-usage",
      severity: "ok",
      needsMe: false,
      title: `${source}: $${monthToDateUsd.toFixed(2)} API-equivalent this month`,
      attributes: { source, monthToDateUsd },
    })),
  ];
}

/**
 * A production-volume ingest body: every source healthy, all nine sections
 * populated, and well over a hundred signals waiting on Jerred.
 */
export function volumeOpsIngest(
  generatedAt: string,
  variant: VolumeVariant,
): OpsIngest {
  const now = Temporal.Instant.from(generatedAt);
  const aggregate = variant === "aggregate";
  return buildFixtureIngest({
    now,
    signals: [
      ...alertSignals(now),
      ...platformSignals(now),
      ...deliverySignals(now),
      ...renovateSignals(now, variant),
      ...workSignals(now),
      ...errorSignals(now),
      ...productSignals(),
      ...quotaSignals(now, variant),
      ...aiSpendSignals(),
      ...restoreSignals(now, variant),
      ...capacitySignals(),
      ...scheduleSignals(now),
      ...observabilitySignals(),
    ],
    metrics: volumeMetrics({
      // Today the collector leaves `alerts.firing` at `ok` whatever fires.
      firing: aggregate ? "error" : "ok",
      // A window that has reset no longer counts as the fullest.
      fullestQuota: Math.max(
        ...QUOTA_WINDOWS.filter(
          (window) => !aggregate || window[RESET_HOURS] > 0,
        ).map((window) => window[USED_RATIO]),
      ),
      renovatePending:
        renovateUpdates().length + RENOVATE_PENDING_CHECKS + TOOLS.length,
      aiMonthToDateUsd: AI_MONTH_TO_DATE_USD,
      aiProjectedUsd: AI_PROJECTED_USD,
    }),
    changes: volumeChanges(now),
  });
}

/** The snapshot as `GET /api/v1/ops/snapshot` serves it the moment it lands. */
export function volumeSnapshotResponse(
  generatedAt: string,
  variant: VolumeVariant,
): SnapshotResponse {
  return SnapshotResponseSchema.parse({
    ...volumeOpsIngest(generatedAt, variant).snapshot,
    stale: false,
    ageMs: 0,
    receivedAt: generatedAt,
    newSignalIds: [],
  });
}
