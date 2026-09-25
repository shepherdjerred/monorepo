import { describe, expect, test } from "vitest";
import { summarizeLinear } from "@shepherdjerred/ops-clients/linear.ts";
import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import {
  OpsIngestSchema,
  SnapshotSchema,
  SOURCE_IDS,
  type SourceId,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { mapAi } from "./ai.ts";
import { mapAlerts } from "./alerts.ts";
import { mapArgoApplications } from "./argocd.ts";
import { mapBugsink } from "./bugsink.ts";
import { mapCi } from "./ci.ts";
import { mapGitHub } from "./github.ts";
import { mapKubernetes } from "./kubernetes.ts";
import { mapLinear } from "./linear.ts";
import { mapLogs } from "./logs.ts";
import { mapMaintenance } from "./maintenance.ts";
import { buildOpsIngest, type OpsCollectorOutcome } from "./ops-publish.ts";
import type { OpsCollection } from "./ops-types.ts";
import { mapPostHog, mapProbes } from "./product.ts";
import { mapRenovate } from "./renovate.ts";
import { mapTalos } from "./talos.ts";

const now = new Date("2026-09-24T12:00:00.000Z");
const context = { now, services: new ServiceIndex() };
const ago = (hours: number) =>
  new Date(now.getTime() - hours * 3_600_000).toISOString();
const sample = (
  value: number,
  metric: Record<string, string> = {},
): PrometheusSample => ({ metric, value });
const PR_URL = "https://github.com/shepherdjerred/monorepo/pull/7";
const SHA = "0123456789abcdef0123456789abcdef01234567";

const openPr = {
  number: 7,
  title: "feat(birmel): thing",
  url: PR_URL,
  author: { login: "derrej", kind: "user" as const },
  draft: false,
  createdAt: ago(200),
  updatedAt: ago(190),
  reviewDecision: null,
  mergeable: "CONFLICTING" as const,
  branch: "feature",
  labels: [],
  checks: "FAILURE" as const,
};

/** One problem-bearing fixture per source, run through its real mapper. */
const COLLECTIONS: Record<SourceId, OpsCollection> = {
  alerts: mapAlerts(
    [
      {
        fingerprint: "f1",
        labels: {
          alertname: "BirmelDown",
          severity: "critical",
          namespace: "birmel",
        },
        annotations: {
          summary: "Birmel is down",
          runbook_url: "https://example.com/runbook",
        },
        startsAt: ago(2),
        status: { state: "active", silencedBy: [], inhibitedBy: [] },
      },
    ],
    [
      {
        id: "s1",
        status: { state: "active" },
        matchers: [],
        startsAt: ago(1),
        endsAt: ago(-1),
        createdBy: "jerred",
        comment: "maintenance",
      },
    ],
    context,
  ),
  kubernetes: mapKubernetes(
    [
      {
        name: "liskov",
        ready: false,
        readySince: ago(1),
        osImage: "Talos",
        kubeletVersion: "v1",
      },
    ],
    [
      {
        namespace: "birmel",
        name: "birmel-1",
        phase: "Running",
        createdAt: ago(3),
        ownerKind: "ReplicaSet",
        restarts: 9,
        problem: "app: CrashLoopBackOff",
        stuck: true,
      },
    ],
    context,
  ),
  argocd: mapArgoApplications(
    [
      {
        name: "birmel",
        project: "default",
        destinationNamespace: "birmel",
        sync: "OutOfSync",
        health: "Degraded",
        revision: SHA,
        history: [
          {
            id: 3,
            revision: SHA,
            deployedAt: ago(1),
            deployStartedAt: undefined,
          },
        ],
        operation: {
          phase: "Failed",
          message: "hook failed",
          startedAt: ago(1),
          finishedAt: ago(0.9),
        },
      },
    ],
    new Map([["birmel", new Date(ago(1))]]),
    context,
  ),
  talos: mapTalos(
    [{ node: "10.0.0.1", stage: "booting", ready: false, unmetConditions: [] }],
    [{ node: "10.0.0.1", service: "etcd", running: false, healthy: false }],
  ),
  ci: mapCi(
    {
      latest: undefined,
      verdict: {
        number: 5,
        state: "failed",
        url: "https://buildkite.com/sjerred/monorepo/builds/5",
        commit: SHA,
        message: "broken",
        createdAt: ago(1),
        finishedAt: ago(0.5),
      },
    },
    context,
  ),
  github: mapGitHub(
    {
      open: [openPr],
      merged30d: [
        {
          number: 6,
          title: "fix(scout): merged",
          url: PR_URL,
          author: undefined,
          createdAt: ago(30),
          mergedAt: ago(20),
        },
      ],
      imagePins: [
        {
          oid: SHA,
          headline: "chore: bump pending image versions",
          committedAt: ago(5),
          url: `https://github.com/shepherdjerred/monorepo/commit/${SHA}`,
        },
      ],
    },
    context,
  ),
  renovate: (() => {
    const { counts: _counts, ...collection } = mapRenovate(
      {
        number: 481,
        url: "https://github.com/shepherdjerred/monorepo/issues/481",
        body: " - [ ] <!-- approve-branch=renovate/a -->update a\n - [ ] <!-- unpend-branch=renovate/b -->update b",
      },
      [{ ...openPr, number: 8, branch: "renovate/c" }],
    );
    return collection;
  })(),
  linear: mapLinear(
    summarizeLinear(
      [
        {
          id: "1",
          identifier: "SJ-1",
          title: "Triage me",
          url: "https://linear.app/sjerred/issue/SJ-1",
          createdAt: ago(10),
          team: "SJ",
          stateType: "triage",
        },
      ],
      [
        {
          team: "AI",
          teamName: "AI",
          number: 2,
          startsAt: ago(48),
          endsAt: ago(-200),
          progress: 0.5,
        },
      ],
    ),
  ),
  bugsink: mapBugsink(
    [
      {
        project: { id: 1, name: "Scout", slug: "scout-for-lol" },
        issues: [
          {
            id: "i1",
            projectId: 1,
            firstSeen: ago(2),
            lastSeen: ago(1),
            events: 4,
            type: "TypeError",
            value: "boom",
            transaction: "",
            muted: false,
          },
        ],
      },
    ],
    context,
  ),
  posthog: mapPostHog(
    [{ siteKey: "scout-prod", host: "scout-for-lol.com", pageviews: 10 }],
    [{ host: "scout-for-lol.com", path: "/", pageviews: 10 }],
    context,
  ),
  probes: mapProbes(
    [
      sample(0, {
        job: "probe-x",
        namespace: "s3-static-sites",
        path: "/app/",
      }),
    ],
    context,
  ),
  logs: mapLogs([{ namespace: "temporal", lines: 40 }], context),
  maintenance: mapMaintenance({
    certificates: [sample(86_400, { namespace: "postal", name: "smtp" })],
    probeCertificates: [sample(5 * 86_400, { instance: "https://sjer.red" })],
    filesystems: [sample(0.95, { instance: "torvalds", mountpoint: "/var" })],
    zpools: [sample(0.85, { zpool_name: "tank" })],
    seaweedfsBackups: [sample(48 * 3600, { cadence: "daily" })],
    veleroBackups: [sample(40 * 3600, { schedule: "nightly" })],
    cpu: [sample(0.4)],
    memory: [sample(0.6)],
  }),
  ai: mapAi(
    {
      billedMtd: [sample(200)],
      openAiToday: [sample(1.5)],
      macCostMtd: [sample(12, { source: "codex" })],
      macTokens24h: [sample(1000)],
      clusterTokens24h: [sample(500)],
      quotas: [
        sample(0.97, {
          provider: "anthropic",
          window_id: "weekly",
          window_kind: "weekly",
        }),
      ],
      quotaResets: [
        sample(Date.parse(ago(-24)) / 1000, {
          provider: "anthropic",
          window_id: "weekly",
        }),
      ],
    },
    now,
  ),
};

describe("ops snapshot contract", () => {
  test("every mapper's output assembles into a schema-valid ingest", () => {
    const outcomes: OpsCollectorOutcome[] = SOURCE_IDS.map((source) => ({
      source,
      ok: true,
      result: {
        status: {
          source,
          ok: true,
          observedAt: now.toISOString(),
          durationMs: 1,
        },
        ...COLLECTIONS[source],
      },
    }));
    const ingest = buildOpsIngest({
      outcomes,
      now,
      lastSuccess: new Map(),
      secrets: [],
    });
    expect(() => OpsIngestSchema.parse(ingest)).not.toThrow();
    // Validate the wire form the dashboard receives, not the in-memory object.
    const wire = JSON.stringify(ingest.snapshot);
    expect(() => SnapshotSchema.parse(JSON.parse(wire))).not.toThrow();
    // Every source contributed at least one signal, so the check is not vacuous.
    const sourcesWithSignals = new Set(
      ingest.snapshot.sections.flatMap((section) =>
        section.signals.map((signal) => signal.source),
      ),
    );
    expect([...sourcesWithSignals].toSorted()).toEqual(
      [...SOURCE_IDS].toSorted(),
    );
    expect(ingest.snapshot.severity).toBe("error");
    expect(ingest.changes.length).toBeGreaterThan(0);
  });

  test("a failed source is redacted and duplicate changes collapse before validation", () => {
    const secret = "fixture-linear-secret";
    const outcomes: OpsCollectorOutcome[] = SOURCE_IDS.map((source) => {
      if (source === "linear") {
        return {
          source,
          ok: false,
          error: `linear: HTTP 401\n  key ${secret}`,
        };
      }
      const collection = COLLECTIONS[source];
      return {
        source,
        ok: true,
        result: {
          status: {
            source,
            ok: true,
            observedAt: now.toISOString(),
            durationMs: 1,
          },
          ...collection,
          // A retried collector can resend the same change.
          changes: [...collection.changes, ...collection.changes],
        },
      };
    });
    const ingest = OpsIngestSchema.parse(
      buildOpsIngest({
        outcomes,
        now,
        lastSuccess: new Map([["linear", ago(0.1)]]),
        secrets: [secret],
      }),
    );
    const linear = ingest.snapshot.sources.find(
      (status) => status.source === "linear",
    );
    expect(linear).toMatchObject({
      ok: false,
      error: "linear: HTTP 401 key ***",
      lastSuccessAt: ago(0.1),
    });
    expect(JSON.stringify(ingest)).not.toContain(secret);
    const keys = ingest.changes.map(
      (change) => `${change.source}:${change.externalId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(
      SOURCE_IDS.reduce(
        (total, source) => total + COLLECTIONS[source].changes.length,
        0,
      ) - COLLECTIONS.linear.changes.length,
    );
    expect(
      ingest.snapshot.sections.find((section) => section.id === "work")
        ?.severity,
    ).toBe("unknown");
    expect(ingest.changes.some((change) => change.kind === "alert-open")).toBe(
      false,
    );
  });
});
