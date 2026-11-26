import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { CLUSTER_SCOPED_ROOT_RESOURCE_KINDS } from "@shepherdjerred/homelab/scripts/argocd/argocd.ts";
import { setupCharts } from "./setup-charts.ts";
import {
  apiGroupName,
  CLUSTER_SCOPED_KINDS,
  renderedClusterResources,
} from "./resources/argo-applications/platform/projects.ts";
import {
  runArgocdCommand,
  operationForRootSyncRequest,
  operationForSyncRequest,
  operationResponseForRootSync,
  RootSyncRequestSchema,
  SyncRequestSchema,
  type SyncRequest,
} from "./argocd-script-support.ts";

type RequestObservation = {
  authorization: string | null;
  contentType: string | null;
  method: string;
  path: string;
  query: string;
};

const RELEASE_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const HOMELAB_ROOT = path.resolve(import.meta.dir, "../../..");

function runScript(
  args: readonly string[],
  origin?: string,
  extraEnv?: Record<string, string>,
) {
  return runArgocdCommand(
    ["bun", "--no-install", "scripts/argocd/argocd.ts", ...args],
    {
      cwd: HOMELAB_ROOT,
      ...(origin === undefined && extraEnv === undefined
        ? {}
        : {
            env: {
              ...Bun.env,
              ...(origin === undefined
                ? {}
                : { ARGOCD_SERVER_URL: origin, ARGOCD_TOKEN: "test-token" }),
              ...extraEnv,
            },
          }),
    },
  );
}

const WorkerApplicationResource = {
  group: "argoproj.io",
  kind: "Application",
  name: "worker",
};

const StagedRepositoryApplication = JSON.stringify({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: { name: "worker" },
  spec: {
    source: {
      repoURL: "https://charts.tailnet-1a49.ts.net",
      chart: "worker",
      targetRevision: "2.0.0-43",
    },
    syncPolicy: {
      automated: { enabled: false, prune: true, selfHeal: true },
    },
  },
});

const StagedAdmissionPolicy = JSON.stringify({
  apiVersion: "admissionregistration.k8s.io/v1",
  kind: "ValidatingAdmissionPolicy",
  metadata: {
    name: "pvc-backup-policy.sjer.red",
    namespace: "argocd",
    annotations: { "argocd.argoproj.io/sync-wave": "1" },
  },
  spec: { failurePolicy: "Fail" },
});

const StagedPriorityClasses = ["draft", "main", "ready"].map((priority) =>
  JSON.stringify({
    apiVersion: "kueue.x-k8s.io/v1beta2",
    kind: "WorkloadPriorityClass",
    metadata: {
      name: `ci-${priority}`,
      namespace: "argocd",
      annotations: { "argocd.argoproj.io/sync-wave": "1" },
    },
    value: 100,
  }),
);

const StagedExternalApplication = JSON.stringify({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: { name: "external" },
  spec: {
    source: {
      repoURL: "https://charts.example.com",
      chart: "external",
      targetRevision: "1.0.0",
      helm: { valuesObject: { storage: { size: "10Gi" } } },
    },
    syncPolicy: { automated: { enabled: true } },
  },
});

function expectSuspendedWorkerRequest(request: unknown): void {
  const syncRequest = SyncRequestSchema.parse(request);
  const manifests = syncRequest.manifests;
  if (manifests === undefined) {
    throw new Error("Suspended Application sync is missing manifest overrides");
  }
  expect(syncRequest.infos.map(({ name }) => name)).toEqual([
    "ci.sjer.red/request-id",
    "ci.sjer.red/operation-id",
  ]);
  expect(manifests).toHaveLength(1);
  expect(JSON.parse(manifests[0] ?? "")).toMatchObject({
    spec: {
      source: {
        repoURL: "https://charts.tailnet-1a49.ts.net",
        chart: "worker",
        targetRevision: "~2.0.0-0",
      },
      syncPolicy: {
        automated: {
          enabled: false,
          prune: true,
          selfHeal: true,
        },
      },
    },
  });
  expect(syncRequest.resources).toEqual([WorkerApplicationResource]);
}

describe("Argo CD prune safety", () => {
  test("supports asynchronous syncs without waiting for root health", async () => {
    let syncPosts = 0;
    let statusGets = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (
          request.method === "POST" &&
          url.pathname === "/api/v1/applications/apps/sync"
        ) {
          syncPosts++;
          return Response.json(
            operationResponseForRootSync(await request.json()),
          );
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps"
        ) {
          statusGets++;
          return Response.json({});
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const { exitCode, stdout, stderr } = await runScript(
        ["sync", "apps", "--async", "--timeout", "1"],
        server.url.origin,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("sync operation started: apps");
      expect(syncPosts).toBe(1);
      expect(statusGets).toBe(0);
    } finally {
      await server.stop(true);
    }
  });

  test("rejects contradictory revision identity in an asynchronous sync response", async () => {
    let syncPosts = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (
          request.method === "POST" &&
          url.pathname === "/api/v1/applications/apps/sync"
        ) {
          syncPosts++;
          const syncRequest = RootSyncRequestSchema.parse(await request.json());
          return Response.json({
            operation: {
              info: syncRequest.infos,
              initiatedBy: { username: "woodpecker" },
              sync: {
                prune: syncRequest.prune,
                revision: "2.0.0-44",
              },
            },
          });
        }
        return request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps"
          ? Response.json({})
          : new Response("not found", { status: 404 });
      },
    });

    try {
      const { exitCode, stderr } = await runScript(
        [
          "sync",
          "apps",
          "--revision",
          "2.0.0-42",
          "--request-id",
          "11111111-1111-4111-8111-111111111111",
          "--async",
          "--timeout",
          "1",
        ],
        server.url.origin,
      );

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Argo operation revision mismatch");
      expect(syncPosts).toBe(1);
    } finally {
      await server.stop(true);
    }
  });
});

test("Argo CD root pruning requires an exact revision", async () => {
  const { exitCode, stderr } = await runScript(
    ["sync", "apps", "--prune", "--timeout", "1"],
    "http://127.0.0.1:1",
  );

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain(
    "Root Application pruning requires an exact --revision",
  );
});

test("Argo CD CLI usage exposes one root release command", async () => {
  const { exitCode, stderr } = await runScript([]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain(
    "sync-managed <app> [--revision <v>] [--prune] [--terminate-after-applied]",
  );
  expect(stderr).toContain("[--request-id <uuid>]");
  expect(stderr).toContain(
    "release-root apps <expected.json> --revision <v> --request-id <uuid>",
  );
  expect(stderr).toContain(
    "suspend-auto-sync <root-app> [--revision <v>] [--timeout <s>]",
  );
  expect(stderr).toContain("verify-auto-sync <root-app> --revision <v>");
  expect(stderr).not.toContain("stage-root-release <root-app>");
  expect(stderr).not.toContain("finalize-root-release apps");
  expect(stderr).not.toContain("finalize-async-sync <app>");
});

test("release-root owns the complete dry-run lifecycle", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "argocd-release-root-"));
  const expectedPath = path.join(directory, "expected.json");
  await Bun.write(
    expectedPath,
    JSON.stringify([{ name: "apps", revision: "2.0.0-42" }]),
  );

  try {
    const { exitCode, stdout, stderr } = await runScript([
      "release-root",
      "apps",
      expectedPath,
      "--revision",
      "2.0.0-42",
      "--request-id",
      "11111111-1111-4111-8111-111111111111",
      "--dry-run",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("argocd release-root: apps at 2.0.0-42");
    expect(stdout).toContain("argocd stage-root-release: apps at 2.0.0-42");
    expect(stdout).toContain("would reconcile 1 expected Application(s)");
    expect(stdout).toContain("argocd finalize-root-release: apps at 2.0.0-42");
    expect(stdout).toContain(
      "argocd verify-auto-sync: apps at 2.0.0-42 (dry run)",
    );
    // The wait blocks only on charts this build published (#3126); a chart
    // retained at an earlier revision is reported, not waited on.
    expect(stdout).toContain(
      "argocd release-health-wait: 1 Application(s) published at 2.0.0-42; 0 retained at earlier revisions",
    );
    // Ordering, not just presence: the auto-sync invariant has to run after the
    // finalizer restores the declared policy and before the health wait, so a
    // divergence is reported instead of the release spending its timeout on a
    // tree already known to be broken.
    expect(stdout.indexOf("argocd verify-auto-sync")).toBeGreaterThan(
      stdout.indexOf("argocd finalize-root-release"),
    );
    expect(stdout.indexOf("argocd verify-auto-sync")).toBeLessThan(
      stdout.indexOf("argocd release-health-wait"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release-root rejects an inventory that names another apps revision", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "argocd-release-root-"));
  const expectedPath = path.join(directory, "expected.json");
  await Bun.write(
    expectedPath,
    JSON.stringify([{ name: "apps", revision: "2.0.0-42" }]),
  );

  try {
    const { exitCode, stdout, stderr } = await runScript([
      "release-root",
      "apps",
      expectedPath,
      "--revision",
      "2.0.0-43",
      "--request-id",
      RELEASE_REQUEST_ID,
      "--dry-run",
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(
      "Release inventory declares apps 2.0.0-42; expected 2.0.0-43",
    );
    expect(stdout).not.toContain("stage-root-release");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function serveRootPruneCandidate(options: {
  readonly manifest: Record<string, unknown>;
  readonly candidateName: string;
  readonly childResponse?: Record<string, unknown>;
}) {
  let syncPosts = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        syncPosts++;
        return Response.json(
          operationResponseForRootSync(await request.json()),
        );
      }
      if (
        url.pathname === "/api/v1/applications/apps/manifests" &&
        url.searchParams.get("revision") === "2.0.0-42"
      ) {
        return Response.json({
          manifests: [JSON.stringify(options.manifest)],
        });
      }
      if (url.pathname === "/api/v1/applications/apps") {
        return Response.json({
          status: {
            resources: [
              {
                kind: "Application",
                name: options.candidateName,
                status: "OutOfSync",
                requiresPruning: true,
              },
            ],
          },
        });
      }
      return options.childResponse !== undefined &&
        url.pathname === `/api/v1/applications/${options.candidateName}`
        ? Response.json(options.childResponse)
        : new Response("not found", { status: 404 });
    },
  });
  return { server, syncPosts: () => syncPosts };
}

describe("Argo CD root prune safety", () => {
  test("blocks root pruning when a pruning child lacks the cascade finalizer", async () => {
    const { server, syncPosts } = serveRootPruneCandidate({
      manifest: {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: "argocd" },
      },
      candidateName: "unsafe-child",
      childResponse: {
        metadata: {
          annotations: { "ci.sjer.red/application-lifecycle": "cascade" },
          finalizers: [],
        },
      },
    });
    try {
      const { exitCode, stderr } = await runScript(
        ["sync", "apps", "--revision", "2.0.0-42", "--prune", "--timeout", "1"],
        server.url.origin,
      );
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("cascading resources finalizer is missing");
      expect(syncPosts()).toBe(0);
    } finally {
      await server.stop(true);
    }
  });

  test("ignores stale prune signals for children present in the exact root revision", async () => {
    const { server, syncPosts } = serveRootPruneCandidate({
      manifest: {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "Application",
        metadata: { name: "argocd" },
        spec: {
          source: {
            repoURL: "https://argoproj.github.io/argo-helm/",
            chart: "argo-cd",
            targetRevision: "9.0.0",
          },
        },
      },
      candidateName: "argocd",
    });
    try {
      const { exitCode, stdout, stderr } = await runScript(
        [
          "sync",
          "apps",
          "--revision",
          "2.0.0-42",
          "--prune",
          "--async",
          "--timeout",
          "1",
        ],
        server.url.origin,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("sync operation started: apps");
      expect(syncPosts()).toBe(1);
    } finally {
      await server.stop(true);
    }
  });
});

describe("Argo CD release gating", () => {
  test("suspends the exact published root revision before child reconciliation", async () => {
    const syncBodies: unknown[] = [];
    let requestedOperation: unknown;
    const renderedRevisions: (string | null)[] = [];
    let chartMuseumRequests = 0;
    const repositoryApplication = JSON.stringify({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name: "worker" },
      spec: {
        project: "default",
        source: {
          repoURL: "https://charts.tailnet-1a49.ts.net",
          chart: "worker",
          targetRevision: "~2.0.0-0",
        },
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: "worker",
        },
        syncPolicy: {
          automated: { prune: true, selfHeal: true },
        },
      },
    });
    const externalApplication = JSON.stringify({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name: "external" },
      spec: {
        project: "default",
        source: {
          repoURL: "https://charts.example.com",
          chart: "external",
          targetRevision: "1.0.0",
        },
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: "external",
        },
        syncPolicy: { automated: {} },
      },
    });
    const configMap = JSON.stringify({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "config" },
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/charts/apps") {
          chartMuseumRequests += 1;
          if (chartMuseumRequests < 3) {
            return new Response("temporary upstream failure", { status: 503 });
          }
          return Response.json([
            {
              version: "2.0.0-43",
              urls: ["charts/apps-2.0.0-43.tgz"],
              digest: "a".repeat(64),
            },
          ]);
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps/manifests"
        ) {
          renderedRevisions.push(url.searchParams.get("revision"));
          return Response.json({
            manifests: [repositoryApplication, externalApplication, configMap],
          });
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/worker/managed-resources"
        ) {
          return Response.json({ items: [] });
        }
        if (
          request.method === "POST" &&
          url.pathname === "/api/v1/applications/apps/sync"
        ) {
          const body = await request.json();
          syncBodies.push(body);
          requestedOperation = operationForSyncRequest(body);
          return Response.json({ operation: requestedOperation });
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps"
        ) {
          return Response.json({
            status: {
              sync: {
                revision: "~2.0.0-0",
              },
              history: [
                { id: 40, revision: "2.0.0-40" },
                { id: 42, revision: "2.0.0-42" },
                { id: 41, revision: "2.0.0-41" },
              ],
              operationState: {
                phase: "Succeeded",
                startedAt: new Date().toISOString(),
                operation: requestedOperation,
              },
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const { exitCode, stdout, stderr } = await runScript(
        [
          "suspend-auto-sync",
          "apps",
          "--revision",
          "2.0.0-43",
          "--timeout",
          "1",
        ],
        server.url.origin,
        { CHARTMUSEUM_ORIGIN: server.url.origin },
      );

      expect(exitCode).toBe(0);
      expect(stderr).toContain(
        "ChartMuseum inventory attempt 1 failed; retrying in 100ms",
      );
      expect(stderr).toContain(
        "ChartMuseum inventory attempt 2 failed; retrying in 200ms",
      );
      expect(stdout).toContain("suspending auto-sync: worker");
      expect(chartMuseumRequests).toBe(3);
      expect(renderedRevisions).toEqual(["2.0.0-43"]);
      expect(syncBodies).toHaveLength(1);
      expectSuspendedWorkerRequest(syncBodies[0]);
    } finally {
      await server.stop(true);
    }
  });
});

function expectStagedRootRequests(syncBodies: readonly unknown[]): void {
  const applicationRequest = SyncRequestSchema.parse(syncBodies[0]);
  expect(applicationRequest.revision).toBe("2.0.0-43");
  expect(applicationRequest.infos).toContainEqual({
    name: "ci.sjer.red/revision",
    value: "2.0.0-43",
  });
  expect(applicationRequest.infos).toContainEqual({
    name: "ci.sjer.red/request-id",
    value: RELEASE_REQUEST_ID,
  });
  expect(applicationRequest.infos).toContainEqual({
    name: "ci.sjer.red/release-phase",
    value: "stage",
  });
  expect(applicationRequest.resources).toEqual([
    WorkerApplicationResource,
    {
      group: "argoproj.io",
      kind: "Application",
      name: "external",
    },
  ]);
  const applicationManifests = applicationRequest.manifests;
  if (applicationManifests === undefined) {
    throw new Error("Staged Applications are missing manifest overrides");
  }
  const policyRequest = SyncRequestSchema.parse(syncBodies[1]);
  expect(policyRequest.revision).toBe("2.0.0-43");
  expect(policyRequest.resources).toEqual([
    {
      group: "admissionregistration.k8s.io",
      kind: "ValidatingAdmissionPolicy",
      name: "pvc-backup-policy.sjer.red",
    },
    ...["draft", "main", "ready"].map((priority) => ({
      group: "kueue.x-k8s.io",
      kind: "WorkloadPriorityClass",
      name: `ci-${priority}`,
    })),
  ]);
  expect(JSON.parse(applicationManifests[0] ?? "")).toMatchObject({
    spec: { syncPolicy: { automated: { enabled: false } } },
  });
  expect(JSON.parse(applicationManifests[1] ?? "")).toMatchObject({
    spec: {
      source: {
        helm: { valuesObject: { storage: { size: "10Gi" } } },
      },
      syncPolicy: { automated: { enabled: false } },
    },
  });
  expect(policyRequest.manifests).toBeUndefined();
}

function serveStageRootRelease(options?: {
  readonly secondBatchResources?: (
    selected: SyncRequest["resources"],
  ) => unknown[];
}) {
  const syncBodies: unknown[] = [];
  let requestedOperation: unknown;
  let activeSyncRequest: SyncRequest | undefined;
  let deleteRequests = 0;
  let batchIndex = 0;
  const manifests =
    options?.secondBatchResources === undefined
      ? [
          StagedRepositoryApplication,
          StagedExternalApplication,
          StagedAdmissionPolicy,
          ...StagedPriorityClasses,
        ]
      : [
          StagedRepositoryApplication,
          StagedAdmissionPolicy,
          ...StagedPriorityClasses,
        ];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/charts/apps") {
        return Response.json([
          {
            version: "2.0.0-43",
            urls: ["charts/apps-2.0.0-43.tgz"],
            digest: "a".repeat(64),
          },
        ]);
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps/manifests"
      ) {
        expect(url.searchParams.get("revision")).toBe("2.0.0-43");
        return Response.json({ manifests });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        batchIndex += 1;
        const body: unknown = await request.json();
        syncBodies.push(body);
        activeSyncRequest = SyncRequestSchema.parse(body);
        requestedOperation = operationForSyncRequest(body);
        return Response.json({ operation: requestedOperation });
      }
      if (
        request.method === "DELETE" &&
        url.pathname === "/api/v1/applications/apps/operation"
      ) {
        deleteRequests++;
        requestedOperation = undefined;
        activeSyncRequest = undefined;
        return Response.json({});
      }
      if (url.pathname !== "/api/v1/applications/apps") {
        return new Response("not found", { status: 404 });
      }
      if (requestedOperation === undefined || activeSyncRequest === undefined) {
        return Response.json({ status: {} });
      }
      const secondBatchOverride =
        batchIndex === 2 ? options?.secondBatchResources : undefined;
      return Response.json({
        ...(secondBatchOverride === undefined
          ? { operation: requestedOperation }
          : {}),
        status: {
          operationState: {
            phase: secondBatchOverride === undefined ? "Running" : "Succeeded",
            startedAt: new Date().toISOString(),
            operation: requestedOperation,
            syncResult: {
              revision: activeSyncRequest.revision,
              resources:
                secondBatchOverride === undefined
                  ? activeSyncRequest.resources.map((resource) => ({
                      ...resource,
                      status: "Synced",
                      ...(resource.name === "worker"
                        ? { hookPhase: "Failed" }
                        : {}),
                    }))
                  : secondBatchOverride(activeSyncRequest.resources),
            },
          },
        },
      });
    },
  });
  return { server, syncBodies, deleteRequests: () => deleteRequests };
}

describe("Argo CD root release staging", () => {
  test("requires an exact root revision", async () => {
    const { exitCode, stderr } = await runScript([
      "stage-root-release",
      "apps",
      "--dry-run",
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(
      "--revision and --request-id are required for stage-root-release",
    );
  });

  test("stages root prerequisites while child auto-sync remains suspended", async () => {
    const { server, syncBodies, deleteRequests } = serveStageRootRelease();
    try {
      const { exitCode, stdout, stderr } = await runScript(
        [
          "stage-root-release",
          "apps",
          "--revision",
          "2.0.0-43",
          "--request-id",
          RELEASE_REQUEST_ID,
          "--timeout",
          "1",
        ],
        server.url.origin,
        { CHARTMUSEUM_ORIGIN: server.url.origin },
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("stage-root-release: apps at 2.0.0-43");
      expect(stdout).toContain("suspending auto-sync: worker");
      expect(stdout).toContain("terminated applied sync operation: apps");
      expect(syncBodies).toHaveLength(2);
      expect(deleteRequests()).toBe(2);
      expectStagedRootRequests(syncBodies);
    } finally {
      await server.stop(true);
    }
  });
});

async function runReconcileRelease(
  origin: string,
  expected: readonly Record<string, unknown>[],
  // Only the cases asserting request-bound adoption pass one; the rest exercise
  // the unbound path, so an always-on identity would hide that difference.
  requestId?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "argocd-release-"));
  const expectedPath = path.join(directory, "expected.json");
  await Bun.write(expectedPath, JSON.stringify(expected));
  try {
    return await runScript(
      [
        "reconcile-release",
        expectedPath,
        "--skip-health-wait",
        ...(requestId === undefined ? [] : ["--request-id", requestId]),
        "--timeout",
        "1",
      ],
      origin,
      { CHARTMUSEUM_ORIGIN: origin },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Every child sync is preceded by the apply-safety preflight, which reads the
 * child's live inventory and renders the revision it is about to request.
 * Cases that are not about apply safety answer both with nothing.
 */
function emptyPreflight(
  request: Request,
  url: URL,
  app: string,
  revision: string,
): Response | null {
  if (request.method !== "GET") {
    return null;
  }
  if (url.pathname === `/api/v1/applications/${app}/managed-resources`) {
    return Response.json({ items: [] });
  }
  if (url.pathname === `/api/v1/applications/${app}/manifests`) {
    expect(url.searchParams.get("revision")).toBe(revision);
    return Response.json({ manifests: [] });
  }
  return null;
}

function serveFailedOperationRetry(options: {
  readonly app: string;
  readonly revision: string;
  readonly source: Record<string, unknown>;
  readonly history?: readonly Record<string, unknown>[];
}) {
  let requestedOperation: Record<string, unknown> | undefined;
  let childSyncBody: unknown;
  let syncPosts = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/charts/apps") {
        return Response.json([
          {
            version: "2.0.0-42",
            urls: ["charts/apps-2.0.0-42.tgz"],
            digest: "a".repeat(64),
          },
        ]);
      }
      if (
        request.method === "POST" &&
        url.pathname === `/api/v1/applications/${options.app}/sync`
      ) {
        syncPosts += 1;
        const body: unknown = await request.json();
        childSyncBody = body;
        requestedOperation = operationForRootSyncRequest(body);
        return Response.json({ operation: requestedOperation });
      }
      const pre = emptyPreflight(request, url, options.app, options.revision);
      if (pre !== null) return pre;
      if (url.pathname === "/api/v1/applications/apps/manifests") {
        expect(url.searchParams.get("revision")).toBe("2.0.0-42");
        return Response.json({
          manifests: [
            JSON.stringify({
              apiVersion: "argoproj.io/v1alpha1",
              kind: "Application",
              metadata: { name: options.app },
              spec: { source: options.source },
            }),
          ],
        });
      }
      if (url.pathname === `/api/v1/applications/${options.app}`) {
        return Response.json({
          status: {
            sync: { status: "Synced", revision: options.revision },
            health: { status: "Healthy" },
            ...(options.history === undefined
              ? {}
              : { history: options.history }),
            operationState:
              requestedOperation === undefined
                ? {
                    phase: "Failed",
                    syncResult: { revision: options.revision },
                  }
                : {
                    phase: "Succeeded",
                    operation: requestedOperation,
                    syncResult: { revision: options.revision },
                  },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    server,
    syncPosts: () => syncPosts,
    childSyncBody: () => childSyncBody,
  };
}

describe("Argo CD stale release protection", () => {
  test("retries a failed operation recorded for an otherwise current app", async () => {
    const { server, syncPosts, childSyncBody } = serveFailedOperationRetry({
      app: "worker",
      revision: "2.0.0-42",
      source: {
        repoURL: "https://charts.tailnet-1a49.ts.net",
        chart: "worker",
        targetRevision: "~2.0.0-0",
      },
    });
    try {
      const { exitCode, stdout, stderr } = await runReconcileRelease(
        server.url.origin,
        [
          { name: "apps", revision: "2.0.0-42" },
          { name: "worker", revision: "2.0.0-42" },
        ],
        RELEASE_REQUEST_ID,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("sync operation started: worker");
      expect(stdout).toContain("synced: worker");
      expect(syncPosts()).toBe(1);
      const childRequest = RootSyncRequestSchema.parse(childSyncBody());
      expect(childRequest.infos).toContainEqual({
        name: "ci.sjer.red/request-id",
        value: RELEASE_REQUEST_ID,
      });
      expect(childRequest.infos).toContainEqual({
        name: "ci.sjer.red/release-phase",
        value: "child",
      });
      expect(
        Object.keys(z.record(z.string(), z.unknown()).parse(childSyncBody())),
      ).not.toContain("resources");
    } finally {
      await server.stop(true);
    }
  });

  test("retries a failed operation recorded for an externally sourced app", async () => {
    const externalSource = {
      repoURL: "https://grafana.github.io/helm-charts",
      chart: "loki",
      targetRevision: "6.1.0",
    };
    const { server, syncPosts } = serveFailedOperationRetry({
      app: "loki",
      revision: "6.1.0",
      source: externalSource,
      history: [{ id: 1, revision: "6.1.0", source: externalSource }],
    });
    try {
      const { exitCode, stdout, stderr } = await runReconcileRelease(
        server.url.origin,
        [{ name: "apps", revision: "2.0.0-42" }],
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("sync operation started: loki");
      expect(stdout).toContain("synced: loki");
      expect(syncPosts()).toBe(1);
    } finally {
      await server.stop(true);
    }
  });
});

describe("Argo CD release freshness", () => {
  test.each([
    {
      published: "2.0.0-43",
      succeeds: true,
      message:
        "Apps release 2.0.0-42 is superseded by 2.0.0-43; the newer build owns this release",
    },
    {
      published: "2.0.0-41",
      succeeds: false,
      message:
        "Apps release 2.0.0-42 is not published; newest published apps revision is 2.0.0-41",
    },
  ])(
    "reconciles against a published $published",
    async ({ published, succeeds, message }) => {
      let argoRequests = 0;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === "/api/charts/apps") {
            return Response.json([
              {
                version: published,
                urls: [`charts/apps-${published}.tgz`],
                digest: "a".repeat(64),
              },
            ]);
          }
          argoRequests++;
          return new Response("unexpected Argo request", { status: 500 });
        },
      });
      const directory = await mkdtemp(path.join(tmpdir(), "argocd-release-"));
      const expectedPath = path.join(directory, "expected.json");
      await Bun.write(
        expectedPath,
        JSON.stringify([
          { name: "apps", revision: "2.0.0-42" },
          { name: "worker", revision: "2.0.0-42" },
        ]),
      );

      try {
        const { exitCode, stdout, stderr } = await runScript(
          ["reconcile-release", expectedPath, "--timeout", "1"],
          server.url.origin,
          { CHARTMUSEUM_ORIGIN: server.url.origin },
        );

        expect(exitCode === 0).toBe(succeeds);
        expect(`${stdout}\n${stderr}`).toContain(message);
        expect(argoRequests).toBe(0);
      } finally {
        await server.stop(true);
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

describe("Argo CD operator script", () => {
  test("deletes an application within its project and waits for its disappearance", async () => {
    const requests: RequestObservation[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          authorization: request.headers.get("authorization"),
          contentType: request.headers.get("content-type"),
          method: request.method,
          path: url.pathname,
          query: url.searchParams.toString(),
        });

        if (request.method === "DELETE") {
          if (request.headers.get("content-type") !== "application/json") {
            return new Response("Invalid content type", { status: 415 });
          }
          return url.searchParams.get("project") === "default"
            ? new Response(null, { status: 204 })
            : new Response("permission denied", { status: 403 });
        }
        if (request.method === "GET") {
          return url.searchParams.get("project") === "default"
            ? new Response("not found", { status: 404 })
            : new Response("permission denied", { status: 403 });
        }
        return new Response("method not allowed", { status: 405 });
      },
    });

    try {
      const { exitCode, stdout, stderr } = await runScript(
        [
          "delete-application",
          "kueue",
          "--project",
          "default",
          "--timeout",
          "1",
        ],
        server.url.origin,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("deleted: kueue");
      expect(requests).toEqual([
        {
          authorization: "Bearer test-token",
          contentType: "application/json",
          method: "DELETE",
          path: "/api/v1/applications/kueue",
          query: "cascade=true&propagationPolicy=foreground&project=default",
        },
        {
          authorization: "Bearer test-token",
          contentType: null,
          method: "GET",
          path: "/api/v1/applications/kueue",
          query: "project=default",
        },
      ]);
    } finally {
      await server.stop(true);
    }
  });

  test("treats a project-scoped missing application as already deleted", async () => {
    const requests: RequestObservation[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          authorization: request.headers.get("authorization"),
          contentType: request.headers.get("content-type"),
          method: request.method,
          path: url.pathname,
          query: url.searchParams.toString(),
        });
        return Response.json(
          { error: 'applications.argoproj.io "kueue" not found', code: 5 },
          { status: 404 },
        );
      },
    });

    try {
      const { exitCode, stdout, stderr } = await runScript(
        ["delete-application", "kueue", "--project", "default"],
        server.url.origin,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("already deleted: kueue");
      expect(requests).toEqual([
        {
          authorization: "Bearer test-token",
          contentType: "application/json",
          method: "DELETE",
          path: "/api/v1/applications/kueue",
          query: "cascade=true&propagationPolicy=foreground&project=default",
        },
      ]);
    } finally {
      await server.stop(true);
    }
  });
});

const STAGE_RELEASE_ARGS = [
  "stage-root-release",
  "apps",
  "--revision",
  "2.0.0-43",
  "--request-id",
  RELEASE_REQUEST_ID,
  "--timeout",
  "1",
] as const;

const SCOUT_SYNC_ARGS = [
  "sync-managed",
  "scout-prod",
  "--revision",
  "2.0.0-43",
  "--request-id",
  RELEASE_REQUEST_ID,
  "--timeout",
  "1",
] as const;

test("lists every cluster-scoped kind synthesized in apps in CLUSTER_SCOPED_ROOT_RESOURCE_KINDS (AI-233)", async () => {
  const app = new App({ outdir: ".test-synth-root-cluster-scope" });
  await setupCharts(app);
  const rootChart = app.charts.find((chart) => chart.node.id === "apps");
  if (rootChart === undefined)
    throw new Error("apps chart was not synthesized");
  const synthesizedClusterKinds = renderedClusterResources(rootChart).map(
    ({ group, kind }) => `${group}/${kind}`,
  );
  const ManifestMetaSchema = z.looseObject({
    apiVersion: z.string(),
    kind: z.string(),
    metadata: z.looseObject({ namespace: z.string().optional() }).optional(),
  });
  const unnamespacedManifestKinds = z
    .array(ManifestMetaSchema)
    .parse(rootChart.toJson())
    .filter(
      (m) => m.metadata?.namespace === undefined || m.metadata.namespace === "",
    )
    .map((m) => {
      const sep = m.apiVersion.indexOf("/");
      const group = apiGroupName(
        sep === -1 ? "core" : m.apiVersion.slice(0, sep),
      );
      return `${group}/${m.kind}`;
    });
  const requiredKinds = new Set([
    ...synthesizedClusterKinds,
    ...unnamespacedManifestKinds,
  ]);
  expect(requiredKinds).toContain("cert-manager.io/ClusterIssuer");
  expect(requiredKinds).toContain("kueue.x-k8s.io/WorkloadPriorityClass");
  expect(
    [...requiredKinds].filter(
      (k) => !CLUSTER_SCOPED_ROOT_RESOURCE_KINDS.has(k),
    ),
  ).toEqual([]);
  expect(
    [...CLUSTER_SCOPED_ROOT_RESOURCE_KINDS].filter(
      (k) => !CLUSTER_SCOPED_KINDS.has(k),
    ),
  ).toEqual([]);
});

test.each([
  {
    label: "an empty syncResult resource list",
    resources: () => [],
    expectedDetail:
      'unapplied desired resources: ["admissionregistration.k8s.io","ValidatingAdmissionPolicy","pvc-backup-policy.sjer.red"]',
  },
  {
    label: "a Skipped desired resource in a selective batch",
    resources: (selected: SyncRequest["resources"]) =>
      selected.map((r) => ({
        ...r,
        status: r.kind === "WorkloadPriorityClass" ? "Skipped" : "Synced",
      })),
    expectedDetail:
      '["kueue.x-k8s.io","WorkloadPriorityClass","ci-draft"] (Skipped)',
  },
])(
  "rejects Succeeded selective stage-root-release batch with $label (AI-233)",
  async ({ resources, expectedDetail }) => {
    const { server } = serveStageRootRelease({
      secondBatchResources: resources,
    });
    try {
      const { exitCode, stderr } = await runScript(
        STAGE_RELEASE_ARGS,
        server.url.origin,
        { ARGOCD_POLL_INTERVAL_MS: "5", CHARTMUSEUM_ORIGIN: server.url.origin },
      );
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain(
        "Sync operation Succeeded for apps at 2.0.0-43 without applying expected resources",
      );
      expect(stderr).toContain(expectedDetail);
    } finally {
      await server.stop(true);
    }
  },
);

test("rejects finalize-async-sync when a Succeeded root prune omitted a persisted prune candidate (AI-233)", async () => {
  const goneIdentity = JSON.stringify([
    "argoproj.io",
    "Application",
    "retired",
  ]);
  const completedOperation = {
    info: [
      { name: "ci.sjer.red/request-id", value: RELEASE_REQUEST_ID },
      {
        name: "ci.sjer.red/operation-id",
        value: "33333333-3333-4333-8333-333333333333",
      },
      { name: "ci.sjer.red/revision", value: "2.0.0-43" },
      { name: "ci.sjer.red/release-phase", value: "prune" },
      {
        name: "ci.sjer.red/prune-candidates",
        value: JSON.stringify([goneIdentity]),
      },
    ],
    sync: { prune: true, revision: "2.0.0-43" },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== "/api/v1/applications/apps") {
        return new Response("not found", { status: 404 });
      }
      return Response.json({
        status: {
          operationState: {
            phase: "Succeeded",
            operation: completedOperation,
            syncResult: {
              revision: "2.0.0-43",
              resources: [
                {
                  group: "argoproj.io",
                  kind: "Application",
                  name: "apps",
                  status: "Skipped",
                },
              ],
            },
          },
        },
      });
    },
  });
  try {
    const { exitCode, stderr } = await runScript(
      [
        "finalize-async-sync",
        "apps",
        "--revision",
        "2.0.0-43",
        "--request-id",
        RELEASE_REQUEST_ID,
        "--timeout",
        "1",
      ],
      server.url.origin,
      { ARGOCD_POLL_INTERVAL_MS: "5" },
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(`unapplied pruned resources: ${goneIdentity}`);
  } finally {
    await server.stop(true);
  }
});

function serveTimedOutChildSync(options: { readonly rejectDelete: boolean }) {
  let requestedOperation: Record<string, unknown> | undefined;
  let live = false;
  let deleteRequests = 0;
  let postDeleteGets = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const pre = emptyPreflight(request, url, "scout-prod", "2.0.0-43");
      if (pre !== null) return pre;
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/scout-prod/sync"
      ) {
        requestedOperation = operationForRootSyncRequest(await request.json());
        live = true;
        return Response.json({ operation: requestedOperation });
      }
      if (
        request.method === "DELETE" &&
        url.pathname === "/api/v1/applications/scout-prod/operation"
      ) {
        deleteRequests += 1;
        if (options.rejectDelete)
          return new Response("termination forbidden", { status: 403 });
        live = false;
        return new Response(null, { status: 204 });
      }
      if (url.pathname !== "/api/v1/applications/scout-prod") {
        return new Response("not found", { status: 404 });
      }
      if (requestedOperation === undefined)
        return Response.json({ status: {} });
      if (!live) postDeleteGets += 1;
      return Response.json({
        ...(live ? { operation: requestedOperation } : {}),
        status: {
          operationState: {
            phase: live ? "Running" : "Failed",
            message: live ? "" : "Operation terminated",
            startedAt: "2026-11-16T06:30:14Z",
            operation: requestedOperation,
          },
        },
      });
    },
  });
  return {
    server,
    deleteRequests: () => deleteRequests,
    postDeleteGets: () => postDeleteGets,
  };
}

describe("Argo CD child sync timeout orphan termination (AI-658)", () => {
  test("terminates and clears a still-Running owned child operation before throwing Timeout", async () => {
    const { server, deleteRequests, postDeleteGets } = serveTimedOutChildSync({
      rejectDelete: false,
    });
    try {
      const { exitCode, stdout, stderr } = await runScript(
        SCOUT_SYNC_ARGS,
        server.url.origin,
        { ARGOCD_POLL_INTERVAL_MS: "10" },
      );
      expect(exitCode).not.toBe(0);
      expect(stdout).toContain(
        "terminated timed-out sync operation: scout-prod",
      );
      expect(stderr).toContain(
        "Timeout: sync operation for scout-prod did not complete within 1s",
      );
      expect(deleteRequests()).toBe(1);
      expect(postDeleteGets()).toBeGreaterThanOrEqual(1);
    } finally {
      await server.stop(true);
    }
  });

  test("appends a best-effort suffix when orphan child operation termination is rejected", async () => {
    const { server, deleteRequests } = serveTimedOutChildSync({
      rejectDelete: true,
    });
    try {
      const { exitCode, stderr } = await runScript(
        SCOUT_SYNC_ARGS,
        server.url.origin,
        { ARGOCD_POLL_INTERVAL_MS: "10" },
      );
      expect(exitCode).not.toBe(0);
      expect(deleteRequests()).toBe(1);
      expect(stderr).toContain(
        "Timeout: sync operation for scout-prod did not complete within 1s; orphan operation termination failed: HTTP 403",
      );
    } finally {
      await server.stop(true);
    }
  });
});
