import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

type RequestObservation = {
  authorization: string | null;
  contentType: string | null;
  method: string;
  path: string;
  query: string;
};

const SyncRequestSchema = z.object({
  infos: z.array(
    z.object({
      name: z.string(),
      value: z.uuid(),
    }),
  ),
  manifests: z.array(z.string()),
  revision: z.string().optional(),
  resources: z.array(
    z.object({
      group: z.string(),
      kind: z.string(),
      name: z.string(),
    }),
  ),
});

const RootSyncRequestSchema = z.object({
  infos: z.array(
    z.object({
      name: z.string(),
      value: z.uuid(),
    }),
  ),
  prune: z.boolean(),
  revision: z.string().optional(),
});

function operationForRootSyncRequest(
  request: unknown,
): Record<string, unknown> {
  const syncRequest = RootSyncRequestSchema.parse(request);
  return {
    info: syncRequest.infos,
    initiatedBy: { username: "buildkite" },
    sync: {
      prune: syncRequest.prune,
      ...(syncRequest.revision === undefined
        ? {}
        : { revision: syncRequest.revision }),
    },
  };
}

function operationResponseForRootSync(request: unknown): unknown {
  return { operation: operationForRootSyncRequest(request) };
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
      repoURL: "https://chartmuseum.sjer.red",
      chart: "worker",
      targetRevision: "2.0.0-43",
    },
    syncPolicy: { automated: { prune: true, selfHeal: true } },
  },
});

const StagedAdmissionPolicy = JSON.stringify({
  apiVersion: "admissionregistration.k8s.io/v1",
  kind: "ValidatingAdmissionPolicy",
  metadata: {
    name: "pvc-backup-policy.sjer.red",
    annotations: { "argocd.argoproj.io/sync-wave": "1" },
  },
  spec: { failurePolicy: "Fail" },
});

const StagedExternalApplication = JSON.stringify({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: { name: "external" },
  spec: {
    source: {
      repoURL: "https://charts.example.com",
      chart: "external",
      targetRevision: "1.0.0",
    },
    syncPolicy: { automated: {} },
  },
});

function operationForSyncRequest(request: unknown): Record<string, unknown> {
  const syncRequest = SyncRequestSchema.parse(request);
  return {
    info: syncRequest.infos,
    initiatedBy: { username: "buildkite" },
    sync: {
      manifests: syncRequest.manifests,
      resources: syncRequest.resources,
      ...(syncRequest.revision === undefined
        ? {}
        : { revision: syncRequest.revision }),
    },
  };
}

function expectSuspendedWorkerRequest(request: unknown): void {
  const syncRequest = SyncRequestSchema.parse(request);
  expect(syncRequest.infos.map(({ name }) => name)).toEqual([
    "ci.sjer.red/request-id",
    "ci.sjer.red/operation-id",
  ]);
  expect(syncRequest.manifests).toHaveLength(1);
  expect(JSON.parse(syncRequest.manifests[0] ?? "")).toMatchObject({
    spec: {
      source: {
        repoURL: "https://chartmuseum.sjer.red",
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
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "sync",
          "apps",
          "--async",
          "--timeout",
          "1",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("sync operation started: apps");
      expect(syncPosts).toBe(1);
      expect(statusGets).toBe(0);
    } finally {
      await server.stop(true);
    }
  });
});

test("Argo CD root pruning requires an exact revision", async () => {
  const process = Bun.spawn(
    [
      "bun",
      "--no-install",
      "scripts/argocd.ts",
      "sync",
      "apps",
      "--prune",
      "--timeout",
      "1",
    ],
    {
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: {
        ...Bun.env,
        ARGOCD_SERVER_URL: "http://127.0.0.1:1",
        ARGOCD_TOKEN: "test-token",
      },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain(
    "Root Application pruning requires an exact --revision",
  );
});

test("Argo CD CLI usage documents atomic sync and recovery identity", async () => {
  const process = Bun.spawn(["bun", "--no-install", "scripts/argocd.ts"], {
    cwd: path.resolve(import.meta.dir, "../../.."),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain(
    "sync <app> [--revision <v>] [--prune] [--async | --terminate-after-applied]",
  );
  expect(stderr).toContain("[--request-id <uuid>]");
  expect(stderr).toContain(
    "suspend-auto-sync <root-app> [--revision <v>] [--timeout <s>]",
  );
  expect(stderr).toContain(
    "stage-root-release <root-app> --revision <v> [--timeout <s>]",
  );
  expect(stderr).toContain(
    "finalize-async-sync <app> --revision <v> --request-id <uuid>",
  );
});

describe("Argo CD root prune safety", () => {
  test("blocks root pruning when a pruning child lacks the cascade finalizer", async () => {
    let syncPosts = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method === "POST") {
          syncPosts++;
          return Response.json({});
        }
        if (
          url.pathname === "/api/v1/applications/apps/manifests" &&
          url.searchParams.get("revision") === "2.0.0-42"
        ) {
          return Response.json({
            manifests: [
              JSON.stringify({
                apiVersion: "v1",
                kind: "Namespace",
                metadata: { name: "argocd" },
              }),
            ],
          });
        }
        if (url.pathname === "/api/v1/applications/apps") {
          return Response.json({
            status: {
              resources: [
                {
                  kind: "Application",
                  name: "unsafe-child",
                  status: "OutOfSync",
                  requiresPruning: true,
                },
              ],
            },
          });
        }
        if (url.pathname === "/api/v1/applications/unsafe-child") {
          return Response.json({
            metadata: {
              annotations: {
                "ci.sjer.red/application-lifecycle": "cascade",
              },
              finalizers: [],
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "sync",
          "apps",
          "--revision",
          "2.0.0-42",
          "--prune",
          "--timeout",
          "1",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("cascading resources finalizer is missing");
      expect(syncPosts).toBe(0);
    } finally {
      await server.stop(true);
    }
  });

  test("ignores stale prune signals for children present in the exact root revision", async () => {
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
            manifests: [
              JSON.stringify({
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
              }),
            ],
          });
        }
        if (url.pathname === "/api/v1/applications/apps") {
          return Response.json({
            status: {
              resources: [
                {
                  kind: "Application",
                  name: "argocd",
                  status: "OutOfSync",
                  requiresPruning: true,
                },
              ],
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "sync",
          "apps",
          "--revision",
          "2.0.0-42",
          "--prune",
          "--async",
          "--timeout",
          "1",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("sync operation started: apps");
      expect(syncPosts).toBe(1);
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
          repoURL: "https://chartmuseum.sjer.red",
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
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "suspend-auto-sync",
          "apps",
          "--revision",
          "2.0.0-43",
          "--timeout",
          "1",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
            CHARTMUSEUM_ORIGIN: server.url.origin,
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);

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

describe("Argo CD root release staging", () => {
  test("requires an exact root revision", async () => {
    const process = Bun.spawn(
      [
        "bun",
        "--no-install",
        "scripts/argocd.ts",
        "stage-root-release",
        "apps",
        "--dry-run",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../../.."),
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--revision is required for stage-root-release");
  });

  test("stages root prerequisites while child auto-sync remains suspended", async () => {
    const syncBodies: unknown[] = [];
    let requestedOperation: unknown;
    let activeSyncRequest: z.infer<typeof SyncRequestSchema> | undefined;
    let deleteRequests = 0;
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
          return Response.json({
            manifests: [
              StagedRepositoryApplication,
              StagedExternalApplication,
              StagedAdmissionPolicy,
            ],
          });
        }
        if (
          request.method === "POST" &&
          url.pathname === "/api/v1/applications/apps/sync"
        ) {
          const body = await request.json();
          syncBodies.push(body);
          activeSyncRequest = SyncRequestSchema.parse(body);
          requestedOperation = operationForSyncRequest(body);
          return Response.json({ operation: requestedOperation });
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps"
        ) {
          if (
            requestedOperation === undefined ||
            activeSyncRequest === undefined
          ) {
            return Response.json({ status: {} });
          }
          return Response.json({
            operation: requestedOperation,
            status: {
              operationState: {
                phase: "Running",
                startedAt: new Date().toISOString(),
                operation: requestedOperation,
                syncResult: {
                  revision: activeSyncRequest.revision,
                  resources: activeSyncRequest.resources.map((resource) => ({
                    ...resource,
                    status: "Synced",
                    ...(resource.name === "worker"
                      ? { hookPhase: "Failed" }
                      : {}),
                  })),
                },
              },
            },
          });
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
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "stage-root-release",
          "apps",
          "--revision",
          "2.0.0-43",
          "--timeout",
          "1",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
            CHARTMUSEUM_ORIGIN: server.url.origin,
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("stage-root-release: apps at 2.0.0-43");
      expect(stdout).toContain("suspending auto-sync: worker");
      expect(stdout).toContain("terminated applied sync operation: apps");
      expect(syncBodies).toHaveLength(2);
      expect(deleteRequests).toBe(2);
      const applicationRequest = SyncRequestSchema.parse(syncBodies[0]);
      expect(applicationRequest.revision).toBe("2.0.0-43");
      expect(applicationRequest.resources).toEqual([
        WorkerApplicationResource,
        {
          group: "argoproj.io",
          kind: "Application",
          name: "external",
        },
      ]);
      const policyRequest = SyncRequestSchema.parse(syncBodies[1]);
      expect(policyRequest.revision).toBe("2.0.0-43");
      expect(policyRequest.resources).toEqual([
        {
          group: "admissionregistration.k8s.io",
          kind: "ValidatingAdmissionPolicy",
          name: "pvc-backup-policy.sjer.red",
        },
      ]);
      expect(JSON.parse(applicationRequest.manifests[0] ?? "")).toMatchObject({
        spec: { syncPolicy: { automated: { enabled: false } } },
      });
      expect(JSON.parse(applicationRequest.manifests[1] ?? "")).toMatchObject({
        spec: { syncPolicy: { automated: { enabled: false } } },
      });
      expect(policyRequest.manifests[0]).toBe(StagedAdmissionPolicy);
    } finally {
      await server.stop(true);
    }
  });
});

describe("Argo CD stale release protection", () => {
  test("retries a failed operation recorded for an otherwise current app", async () => {
    let requestedOperation: Record<string, unknown> | undefined;
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
          url.pathname === "/api/v1/applications/worker/sync"
        ) {
          syncPosts += 1;
          requestedOperation = operationForRootSyncRequest(
            await request.json(),
          );
          return Response.json({ operation: requestedOperation });
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/worker"
        ) {
          return Response.json({
            status: {
              sync: { status: "Synced", revision: "2.0.0-42" },
              health: { status: "Healthy" },
              operationState:
                requestedOperation === undefined
                  ? {
                      phase: "Failed",
                      syncResult: { revision: "2.0.0-42" },
                    }
                  : {
                      phase: "Succeeded",
                      operation: requestedOperation,
                      syncResult: { revision: "2.0.0-42" },
                    },
            },
          });
        }
        return new Response("not found", { status: 404 });
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
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "reconcile-release",
          expectedPath,
          "--skip-health-wait",
          "--timeout",
          "1",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
            CHARTMUSEUM_ORIGIN: server.url.origin,
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("sync operation started: worker");
      expect(stdout).toContain("synced: worker");
      expect(syncPosts).toBe(1);
    } finally {
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects an Argo reconcile after a newer apps chart is published", async () => {
    let argoRequests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
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
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "reconcile-release",
          expectedPath,
          "--timeout",
          "1",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
            CHARTMUSEUM_ORIGIN: server.url.origin,
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Refusing stale Argo release 2.0.0-42");
      expect(argoRequests).toBe(0);
    } finally {
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
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
          if (url.searchParams.get("project") !== "default") {
            return new Response("permission denied", { status: 403 });
          }
          return new Response(null, { status: 204 });
        }
        if (request.method === "GET") {
          if (url.searchParams.get("project") !== "default") {
            return new Response("permission denied", { status: 403 });
          }
          return new Response("not found", { status: 404 });
        }
        return new Response("method not allowed", { status: 405 });
      },
    });

    try {
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "delete-application",
          "kueue",
          "--project",
          "default",
          "--timeout",
          "1",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);

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
          {
            error: 'applications.argoproj.io "kueue" not found',
            code: 5,
          },
          { status: 404 },
        );
      },
    });

    try {
      const process = Bun.spawn(
        [
          "bun",
          "--no-install",
          "scripts/argocd.ts",
          "delete-application",
          "kueue",
          "--project",
          "default",
        ],
        {
          cwd: path.resolve(import.meta.dir, "../../.."),
          env: {
            ...Bun.env,
            ARGOCD_SERVER_URL: server.url.origin,
            ARGOCD_TOKEN: "test-token",
          },
          stderr: "pipe",
          stdout: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);

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
