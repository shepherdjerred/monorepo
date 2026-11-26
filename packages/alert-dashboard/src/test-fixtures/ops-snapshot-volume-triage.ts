import type { Temporal } from "@js-temporal/polyfill";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";

import { ago } from "#test-fixtures/ops-snapshot";
import {
  ALERTMANAGER_URL,
  logsLink,
  pullRequestLink,
  serviceForNamespace,
  services,
} from "#test-fixtures/ops-snapshot-volume-links";

/**
 * Alert and pull-request rows of the production-volume fixture. Ids, kinds,
 * severities, `needsMe` rules and attributes mirror `alerts.ts`, `github.ts`
 * and `ci.ts` in `packages/temporal/src/activities/ops/`; the values are
 * invented.
 */

type AlertRow = {
  alertname: string;
  namespace?: string;
  summary: string;
  hours: number;
  severity?: "error";
  count?: number;
  state?: "suppressed";
};

/** One error 15 minutes old, then warnings between one and seven days old. */
const ALERTS: readonly AlertRow[] = [
  {
    alertname: "ProductionNodeMemoryAvailableCritical",
    summary: "torvalds has under 5% memory available",
    hours: 0.25,
    severity: "error",
  },
  {
    alertname: "ScoutRiotApiErrorRateHigh",
    namespace: "scout-prod",
    summary: "Scout Riot API error rate is above 5%",
    hours: 26,
    count: 3,
  },
  {
    alertname: "PVCStorageHigh",
    namespace: "media",
    summary: "PVC media/plex-config is 87% full",
    hours: 31,
  },
  {
    alertname: "SeaweedFSBackupLagging",
    namespace: "seaweedfs",
    summary: "SeaweedFS backup is 19 hours behind",
    hours: 44,
  },
  {
    alertname: "GolinkSyncFailing",
    namespace: "golink",
    summary: "golink sync has failed for 2 days",
    hours: 52,
  },
  {
    alertname: "FeatureFlagSnapshotStale",
    namespace: "flags",
    summary: "Flags snapshot is stale for alert-dashboard",
    hours: 63,
    state: "suppressed",
  },
  {
    alertname: "NvmeTemperatureHigh",
    summary: "nvme1n1 on torvalds is at 71°C",
    hours: 70,
  },
  {
    alertname: "MailOutboxQueueLatencyHigh",
    namespace: "mail",
    summary: "Mail outbox queue latency is above 5 minutes",
    hours: 88,
  },
  {
    alertname: "BuildkitdCacheVolumeFilling",
    namespace: "buildkitd",
    summary: "buildkitd cache volume is 82% full",
    hours: 97,
    state: "suppressed",
  },
  {
    alertname: "MediaWatchEvidenceStale",
    namespace: "media",
    summary: "Media watch evidence has not refreshed in 4 days",
    hours: 110,
  },
  {
    alertname: "GitBackupRepoFailed",
    namespace: "temporal",
    summary: "Git backup failed for 2 repositories",
    hours: 126,
  },
  {
    alertname: "SmartReallocatedSectorsHigh",
    summary: "sdc on torvalds has 12 reallocated sectors",
    hours: 141,
    state: "suppressed",
  },
  {
    alertname: "HomelabAuditFailedTwoDays",
    namespace: "temporal",
    summary: "The homelab audit has failed two days in a row",
    hours: 166,
  },
];

function alertSignal(now: Temporal.Instant, row: AlertRow): SignalInput {
  const state = row.state ?? "active";
  const count = row.count ?? 1;
  const filter = encodeURIComponent(`{alertname="${row.alertname}"}`);
  return {
    id: `alerts:${row.alertname}:${row.namespace ?? "-"}${state === "active" ? "" : `:${state}`}`,
    source: "alerts",
    section: "alerts",
    ...serviceForNamespace(row.namespace),
    kind: "alert",
    severity: row.severity ?? "warning",
    // OPS_POLICY.alertNeedsMeAfterMinutes is 30.
    needsMe: state === "active" && row.hours * 60 >= 30,
    title: count === 1 ? row.summary : `${row.summary} (×${String(count)})`,
    since: ago(now, row.hours),
    attributes: {
      alertname: row.alertname,
      count,
      firingMinutes: Math.round(row.hours * 60),
      ...(row.namespace === undefined ? {} : { namespace: row.namespace }),
      state,
      distinctCauses: 0,
    },
    links: [
      {
        kind: "native",
        label: "Alertmanager",
        url: `${ALERTMANAGER_URL}/#/alerts?filter=${filter}`,
      },
      ...(row.namespace === undefined ? [] : [logsLink(row.namespace)]),
    ],
  };
}

export function alertSignals(now: Temporal.Instant): SignalInput[] {
  return ALERTS.map((row) => alertSignal(now, row));
}

type PullRequestRow = {
  number: number;
  title: string;
  author: "shepherdjerred" | "derrej";
  days: number;
  idleDays?: number;
  checks?: "FAILURE" | "PENDING";
  mergeable?: "CONFLICTING";
  review?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
  draft?: true;
};

const PULL_REQUESTS: readonly PullRequestRow[] = [
  {
    number: 4721,
    title: "feat(alert-dashboard): group the overview by section",
    author: "derrej",
    days: 1,
  },
  {
    number: 4718,
    title: "fix(scout-for-lol): retry match fetches on 429",
    author: "derrej",
    days: 2,
    review: "REVIEW_REQUIRED",
  },
  {
    number: 4716,
    title: "feat(tracker): bulk triage actions",
    author: "shepherdjerred",
    days: 0.2,
    checks: "PENDING",
  },
  {
    number: 4702,
    title: "chore(homelab): bump Talos to 1.14.6",
    author: "shepherdjerred",
    days: 3,
    review: "APPROVED",
  },
  {
    number: 4688,
    title: "feat(birmel): persist the music queue",
    author: "derrej",
    days: 4,
    checks: "FAILURE",
  },
  {
    number: 4671,
    title: "refactor(temporal): split the ops collectors",
    author: "derrej",
    days: 6,
    mergeable: "CONFLICTING",
  },
  {
    number: 4640,
    title: "feat(toolkit): brim takeover for kimi",
    author: "derrej",
    days: 8,
    draft: true,
  },
  {
    number: 4590,
    title: "docs(wiki): refresh the storage runbook",
    author: "shepherdjerred",
    days: 15,
    idleDays: 12,
  },
  {
    number: 4533,
    title: "feat(tasknotes-server): attachment sync",
    author: "derrej",
    days: 21,
    review: "CHANGES_REQUESTED",
  },
];

/** Mirrors `pullRequestSeverity`: the reasons a PR is not simply open. */
function pullRequestReasons(row: PullRequestRow): string[] {
  if (row.draft === true) return ["draft"];
  const idleDays = row.idleDays ?? 0;
  return [
    ...(row.checks === "FAILURE" ? ["checks failing"] : []),
    ...(row.mergeable === "CONFLICTING" ? ["merge conflict"] : []),
    // OPS_POLICY.pullRequestStaleDays is 7.
    ...(idleDays >= 7 ? [`stale ${String(idleDays)}d`] : []),
    ...(row.review === "CHANGES_REQUESTED" ? ["changes requested"] : []),
  ];
}

function pullRequestSignal(
  now: Temporal.Instant,
  row: PullRequestRow,
): SignalInput {
  const reasons = pullRequestReasons(row);
  const blocking = reasons.filter((reason) => reason !== "changes requested");
  const checks = row.checks ?? "SUCCESS";
  const mergeable = row.mergeable ?? "MERGEABLE";
  const scope = /^[a-z]+\(([^)]+)\)!?:/u.exec(row.title)?.[1];
  const service = scope === undefined ? undefined : services.byId(scope);
  const awaitingReview =
    row.review === undefined || row.review === "REVIEW_REQUIRED";
  return {
    id: `github:pr:${String(row.number)}`,
    source: "github",
    section: "delivery",
    ...(service === undefined ? {} : { service: service.id }),
    kind: "pull-request",
    severity: row.draft !== true && blocking.length > 0 ? "warning" : "info",
    // `awaitsReview`: an agent PR that is green, mergeable and unreviewed.
    needsMe:
      row.author === "derrej" &&
      row.draft !== true &&
      checks === "SUCCESS" &&
      mergeable === "MERGEABLE" &&
      awaitingReview,
    title: `#${String(row.number)} ${row.title}`,
    ...(reasons.length === 0 ? {} : { detail: reasons.join(", ") }),
    since: ago(now, row.days * 24),
    attributes: {
      author: row.author,
      authorClass: row.author === "derrej" ? "agent" : "me",
      draft: row.draft === true,
      checks,
      mergeable,
      review: row.review ?? "NONE",
      updatedAt: ago(now, (row.idleDays ?? 0.1) * 24),
    },
    links: [pullRequestLink(row.number)],
  };
}

export function deliverySignals(now: Temporal.Instant): SignalInput[] {
  return [
    {
      id: "ci:main",
      source: "ci",
      section: "delivery",
      service: "ci",
      kind: "ci-branch",
      severity: "ok",
      needsMe: false,
      title: "main is green: pipeline #18342 passed",
      detail: "feat(tracker): surface sorting across views (#4713)",
      since: ago(now, 1.5),
      attributes: { build: 18_342, commit: "208b1359ba1c" },
      links: [
        {
          kind: "woodpecker",
          label: "Pipeline #18342",
          url: "https://woodpecker.sjer.red/repos/1/pipeline/18342",
        },
      ],
    },
    ...PULL_REQUESTS.map((row) => pullRequestSignal(now, row)),
  ];
}
