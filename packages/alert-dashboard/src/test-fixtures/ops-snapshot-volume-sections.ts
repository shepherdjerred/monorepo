import type { Temporal } from "@js-temporal/polyfill";
import type {
  ChangeEventInput,
  SignalInput,
} from "@shepherdjerred/ops-model/snapshot.ts";

import { ago } from "#test-fixtures/ops-snapshot";
import {
  ARGOCD_URL,
  BUGSINK_URL,
  MONOREPO_URL,
  TEMPORAL_UI_URL,
  TRACKER_URL,
  exploreLink,
  logsLink,
  metricsLink,
  serviceForNamespace,
  services,
} from "#test-fixtures/ops-snapshot-volume-links";

/**
 * The variant-independent sections of the production-volume fixture. Ids,
 * kinds, severities and attributes mirror the collectors in
 * `packages/temporal/src/activities/ops/`; the values are invented.
 */

export function platformSignals(now: Temporal.Instant): SignalInput[] {
  const argo = (app: string, namespace: string): SignalInput["links"] => [
    {
      kind: "argocd",
      label: `Argo CD: ${app}`,
      url: `${ARGOCD_URL}/applications/argocd/${app}`,
    },
    logsLink(namespace),
  ];
  const pod = (
    name: string,
    problem: string,
    severity: "warning" | "info",
    hours: number,
  ): SignalInput => ({
    id: `kubernetes:pod:media/${name}`,
    source: "kubernetes",
    section: "platform",
    ...serviceForNamespace("media"),
    kind: "pod",
    severity,
    needsMe: false,
    title: `media/${name}: ${problem}`,
    since: ago(now, hours),
    attributes: {
      namespace: "media",
      phase: severity === "info" ? "Failed" : "Running",
      restarts: severity === "info" ? 0 : 41,
      owner: "ReplicaSet",
    },
    links: [logsLink("media")],
  });
  return [
    {
      id: "argocd:app:media",
      source: "argocd",
      section: "platform",
      ...serviceForNamespace("media"),
      kind: "argo-app",
      severity: "warning",
      needsMe: false,
      title: "media: Degraded, OutOfSync",
      since: ago(now, 3),
      attributes: { sync: "OutOfSync", health: "Degraded" },
      links: argo("media", "media"),
    },
    {
      id: "argocd:app:scout-beta",
      source: "argocd",
      section: "platform",
      ...serviceForNamespace("scout-beta"),
      kind: "argo-app",
      severity: "info",
      needsMe: false,
      title: "scout-beta: OutOfSync",
      since: ago(now, 0.1),
      attributes: {
        sync: "OutOfSync",
        health: "Healthy",
        operation: "Running",
      },
      links: argo("scout-beta", "scout-beta"),
    },
    pod("kometa-7c9f8d6b54-x7k2p", "CrashLoopBackOff", "warning", 3),
    pod("recyclarr-5d8b7f9c66-qm4vz", "Evicted", "info", 20),
  ];
}

export function workSignals(now: Temporal.Instant): SignalInput[] {
  const issues = [
    ["SJ-142", "Office AP drops 5 GHz clients", 30],
    ["SJ-139", "Decide on the backup retention for media", 96],
    ["AI-611", "toolkit ci wait stalls when the queue is paused", 5],
    ["AI-607", "Flaky Playwright port probe on liskov", 28],
    ["AI-598", "Automate the Renovate approval batches", 170],
  ] as const;
  return issues.map(([identifier, title, hours]) => {
    const team = identifier.slice(0, 2);
    return {
      id: `tracker:issue:${identifier}`,
      source: "tracker",
      section: "work",
      kind: "triage-issue",
      severity: "info",
      // Only Jerred's own team (`SJ`) is his to triage.
      needsMe: team === "SJ",
      title: `${identifier} ${title}`,
      since: ago(now, hours),
      attributes: { team },
      links: [
        {
          kind: "tracker",
          label: identifier,
          url: `${TRACKER_URL}/issues/${identifier}`,
        },
      ],
    };
  });
}

export function errorSignals(now: Temporal.Instant): SignalInput[] {
  const issues = [
    ["birmel", 4, "TypeError", "Cannot read properties of undefined", 6, 14],
    ["scout-for-lol", 2, "RiotApiError", "429 Too Many Requests", 18, 212],
    ["scout-for-lol", 2, "ZodError", "Invalid match timeline frame", 80, 9],
    ["tasknotes-api", 7, "SyncConflictError", "Stale vault revision", 130, 31],
    ["streambot", 9, "FfmpegExitError", "ffmpeg exited with code 1", 300, 6],
  ] as const;
  return issues.map(
    ([project, projectId, type, value, hours, events], index) => {
      const id = `0196f3a2-7b1c-7d4e-9a10-${String(index).padStart(12, "0")}`;
      const service = services.byBugsinkProject(project);
      return {
        id: `bugsink:issue:${id}`,
        source: "bugsink",
        section: "errors",
        ...(service === undefined ? {} : { service: service.id }),
        kind: "error-issue",
        // An issue first seen within 24 hours is new.
        severity: hours <= 24 ? "warning" : "info",
        needsMe: false,
        title: `${project}: ${type}: ${value}`,
        since: ago(now, hours),
        attributes: {
          project,
          events,
          lastSeen: ago(now, 0.5 + index),
          new: hours <= 24,
        },
        links: [
          {
            kind: "bugsink",
            label: "Bugsink issue",
            url: `${BUGSINK_URL}/issues/issue/${id}/event/last/`,
          },
          {
            kind: "bugsink",
            label: `${project} issues`,
            url: `${BUGSINK_URL}/issues/${String(projectId)}/`,
          },
        ],
      };
    },
  );
}

/** One `site-traffic` signal per catalogued analytics site, as PostHog emits. */
export function productSignals(): SignalInput[] {
  const sites = services.services.flatMap((service) =>
    service.analyticsSites.map((site) => ({ site, service: service.id })),
  );
  return sites.map(({ site, service }, index) => {
    const pageviews = Math.max(0, 1840 - index * 173);
    return {
      id: `posthog:site:${site}`,
      source: "posthog",
      section: "product",
      service,
      kind: "site-traffic",
      severity: "ok",
      needsMe: false,
      title: `${site}: ${String(pageviews)} pageviews (24h)`,
      attributes: { pageviews24h: pageviews },
      links: [
        {
          kind: "posthog",
          label: "Web analytics",
          url: "https://us.posthog.com/project/549883/web",
        },
      ],
    };
  });
}

export function observabilitySignals(): SignalInput[] {
  const logs = [
    ["scout-prod", 412],
    ["media", 233],
    ["temporal", 118],
    ["birmel", 64],
    ["woodpecker", 37],
    ["mail", 9],
  ] as const;
  const traces = [
    ["error-traces", "scout-for-lol", 23, "error trace", 2140],
    ["error-traces", "birmel", 4, "error trace", 880],
    ["slow-traces", "scout-for-lol", 17, "slow trace", 9120],
    ["slow-traces", "tracker", 3, "slow trace", 6480],
  ] as const;
  return [
    ...logs.map(([namespace, lines]): SignalInput => ({
      id: `logs:errors:${namespace}`,
      source: "logs",
      section: "observability",
      ...serviceForNamespace(namespace),
      kind: "error-log-volume",
      severity: "info",
      needsMe: false,
      title: `${namespace}: ${String(lines)} error lines in 1h`,
      attributes: { namespace, lines },
      links: [logsLink(namespace)],
    })),
    ...traces.map(
      ([kind, serviceName, count, noun, slowestMs]): SignalInput => ({
        id: `traces:${kind}:${serviceName}`,
        source: "traces",
        section: "observability",
        service: serviceName,
        kind,
        severity: "info",
        needsMe: false,
        title: `${serviceName}: ${String(count)} ${noun}s in 1h`,
        detail: `Root span service ${serviceName}`,
        attributes: { rootServiceName: serviceName, count, slowestMs },
        links: [
          exploreLink(
            "traces",
            kind === "error-traces" ? "Error traces" : "Slow traces",
            `{ resource.service.name = "${serviceName}" }`,
          ),
        ],
      }),
    ),
  ];
}

/** Paused Temporal Schedules, by their real ids in the `prod` namespace. */
const PAUSED_SCHEDULES =
  `streambot-lol-playback vacuum-9am vacuum-12pm vacuum-5pm
  good-morning-weekday-preheat good-morning-weekday-wake good-morning-weekday-up
  good-morning-weekend-preheat good-morning-weekend-wake good-morning-weekend-up
  kometa-daily glitter-corpus-daily glitter-context-refresh-weekly
  dpp-pokeemerald-data-daily deps-summary-weekly fetcher-skill-capped`.split(
    /\s+/u,
  );

export function scheduleSignals(now: Temporal.Instant): SignalInput[] {
  return PAUSED_SCHEDULES.map((scheduleId) => ({
    id: `temporal:schedule:prod:${scheduleId}:paused`,
    source: "temporal",
    section: "maintenance",
    kind: "schedule-paused",
    severity: "info",
    needsMe: false,
    title: `prod/${scheduleId} is paused`,
    detail: "Paused by the operator",
    attributes: {
      scheduleId,
      temporalNamespace: "prod",
      workflowType: "scheduledWorkflow",
      taskQueue: "monorepo-workflows",
      paused: true,
      observedAt: now.toString(),
    },
    links: [
      {
        kind: "native",
        label: "Temporal Schedule",
        url: `${TEMPORAL_UI_URL}/namespaces/prod/schedules/${scheduleId}`,
      },
    ],
  }));
}

export function capacitySignals(): SignalInput[] {
  return [
    {
      id: "maintenance:certificate:tailscale/grafana-tls",
      source: "maintenance",
      section: "maintenance",
      kind: "certificate",
      severity: "warning",
      needsMe: false,
      title: "Certificate tailscale/grafana-tls expires in 9d",
      attributes: { daysLeft: 9 },
      links: [
        metricsLink(
          "Certificate expiry",
          'certmanager_certificate_expiration_timestamp_seconds{namespace="tailscale",name="grafana-tls"}',
        ),
      ],
    },
    {
      id: "maintenance:zpool:zpool zfspv-pool-hdd",
      source: "maintenance",
      section: "maintenance",
      kind: "zpool",
      severity: "warning",
      needsMe: false,
      title: "zpool zfspv-pool-hdd is 84% full",
      attributes: { zpool: "zfspv-pool-hdd", usedRatio: 0.84 },
      links: [
        metricsLink(
          "Usage",
          '1 - zfs_zpool_free_bytes{zpool_name="zfspv-pool-hdd"} / zfs_zpool_size_bytes',
        ),
      ],
    },
  ];
}

/** Scopes the week's older merges rotate through, with the service each touches. */
const MERGE_SCOPES = [
  ["temporal", "temporal"],
  ["homelab", undefined],
  ["scout-for-lol", "scout-for-lol"],
  ["toolkit", undefined],
  ["tracker", "tracker"],
  ["media", "streambot"],
  ["birmel", "birmel"],
  ["deps", undefined],
] as const;
const MERGE_SUBJECTS = [
  "tighten retry policy",
  "split the collector module",
  "raise the memory limit",
  "add a regression test",
  "refresh pinned versions",
] as const;

/**
 * The rest of a week at production pace: a merge every couple of hours and a
 * Temporal worker rollout every eight, so the review and a busy service both
 * hold more changes than a timeline shows at once.
 */
function earlierChanges(now: Temporal.Instant): ChangeEventInput[] {
  const merges = Array.from({ length: 60 }, (_, index): ChangeEventInput => {
    const number = 4579 - index * 3;
    const [scope, service] = MERGE_SCOPES[index % MERGE_SCOPES.length] ?? [
      "deps",
      undefined,
    ];
    const subject = MERGE_SUBJECTS[index % MERGE_SUBJECTS.length] ?? "";
    return {
      source: "github",
      externalId: `pr:${String(number)}`,
      kind: "merge",
      ...(service === undefined ? {} : { service }),
      title: `#${String(number)} ${index % 3 === 0 ? "fix" : "chore"}(${scope}): ${subject}`,
      occurredAt: ago(now, 22 + index * 2.4),
      url: `${MONOREPO_URL}/pull/${String(number)}`,
    };
  });
  const rollouts = Array.from({ length: 20 }, (_, index): ChangeEventInput => {
    const id = 3120 - index;
    return {
      source: "argocd",
      externalId: `temporal:deploy:${String(id)}`,
      kind: "deploy",
      service: "temporal",
      title: `temporal deployed ${(0xa1_b2_c3 + index * 0x1_f3_d7).toString(16)}`,
      occurredAt: ago(now, 6 + index * 8),
      severity: "info",
      url: `${ARGOCD_URL}/applications/argocd/temporal`,
    };
  });
  return [...merges, ...rollouts];
}

export function volumeChanges(now: Temporal.Instant): ChangeEventInput[] {
  const merges = [
    [4713, "feat(tracker): surface sorting across views", "tracker", 1.5],
    [4709, "chore: update Scout Data Dragon to 16.23.1", "scout-for-lol", 4],
    [4643, "feat(scout-for-lol): add Scout coach skills", "scout-for-lol", 9],
    [
      4585,
      "feat(media): replace household library automation",
      "streambot",
      20,
    ],
  ] as const;
  const deploys = [
    ["tracker", "tracker", 212, "208b135", 1.2],
    ["scout-beta", "scout-for-lol", 1904, "fe0dff7", 3.6],
    ["scout-prod", "scout-for-lol", 877, "b50ae4d", 8.4],
    ["birmel", "birmel", 431, "f9cbbc2", 15],
    ["media", "streambot", 655, "f9cbbc2", 19],
  ] as const;
  return [
    ...merges.map(([number, title, service, hours]): ChangeEventInput => ({
      source: "github",
      externalId: `pr:${String(number)}`,
      kind: "merge",
      service,
      title: `#${String(number)} ${title}`,
      occurredAt: ago(now, hours),
      url: `${MONOREPO_URL}/pull/${String(number)}`,
    })),
    ...deploys.map(([app, service, id, revision, hours]): ChangeEventInput => ({
      source: "argocd",
      externalId: `${app}:deploy:${String(id)}`,
      kind: "deploy",
      service,
      title: `${app} deployed ${revision}`,
      occurredAt: ago(now, hours),
      severity: "info",
      url: `${ARGOCD_URL}/applications/argocd/${app}`,
    })),
    ...earlierChanges(now),
  ];
}
