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

const SyncInfoEntrySchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("ci.sjer.red/request-id"),
    value: z.uuid(),
  }),
  z.object({
    name: z.literal("ci.sjer.red/operation-id"),
    value: z.uuid(),
  }),
  z.object({
    name: z.literal("ci.sjer.red/revision"),
    value: z.string(),
  }),
]);

const SyncRequestSchema = z.object({
  infos: z.array(SyncInfoEntrySchema),
  manifests: z.array(z.string()).optional(),
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
  infos: z.array(SyncInfoEntrySchema),
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
      helm: { valuesObject: { storage: { size: "10Gi" } } },
    },
    syncPolicy: { automated: { enabled: true } },
  },
});

function operationForSyncRequest(request: unknown): Record<string, unknown> {
  const syncRequest = SyncRequestSchema.parse(request);
  return {
    info: syncRequest.infos,
    initiatedBy: { username: "buildkite" },
    sync: {
      ...(syncRequest.manifests === undefined
        ? {}
        : { manifests: syncRequest.manifests }),
      resources: syncRequest.resources,
    },
  };
}

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
              initiatedBy: { username: "buildkite" },
              sync: {
                prune: syncRequest.prune,
                revision: "2.0.0-44",
              },
            },
          });
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps"
        ) {
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
          "--revision",
          "2.0.0-42",
          "--request-id",
          "11111111-1111-4111-8111-111111111111",
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
      const [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Argo operation revision mismatch");
      expect(syncPosts).toBe(1);
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

test("Argo CD CLI usage exposes one root release command", async () => {
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
    "sync-managed <app> [--revision <v>] [--prune] [--terminate-after-applied]",
  );
  expect(stderr).toContain("[--request-id <uuid>]");
  expect(stderr).toContain(
    "release-root apps <expected.json> --revision <v> --request-id <uuid>",
  );
  expect(stderr).toContain(
    "suspend-auto-sync <root-app> [--revision <v>] [--timeout <s>]",
  );
  expect(stderr).not.toContain("stage-root-release <root-app>");
  expect(stderr).not.toContain("finalize-root-release apps");
  expect(stderr).not.toContain("finalize-async-sync <app>");
});

test("sync-managed rejects detached operations", async () => {
  const process = Bun.spawn(
    [
      "bun",
      "--no-install",
      "scripts/argocd.ts",
      "sync-managed",
      "worker",
      "--async",
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
  expect(stderr).toContain(
    "sync-managed is bounded and does not support --async",
  );
});

test("sync-managed preflights immutable changes before submitting", async () => {
  let syncPosts = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker" &&
        url.searchParams.get("refresh") === "hard"
      ) {
        return Response.json({ status: {} });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker/managed-resources"
      ) {
        return Response.json({
          items: [
            {
              group: "apps",
              kind: "Deployment",
              namespace: "worker",
              name: "worker",
              liveState: JSON.stringify({
                spec: { selector: { matchLabels: { app: "worker" } } },
              }),
              targetState: JSON.stringify({
                spec: { selector: { matchLabels: { app: "api" } } },
              }),
            },
          ],
        });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/worker/sync"
      ) {
        syncPosts += 1;
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
        "sync-managed",
        "worker",
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
    expect(stderr).toContain(
      "apps/Deployment worker/worker changes immutable /spec/selector",
    );
    expect(syncPosts).toBe(0);
  } finally {
    await server.stop(true);
  }
});

test("release-root owns the complete dry-run lifecycle", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "argocd-release-root-"));
  const expectedPath = path.join(directory, "expected.json");
  await Bun.write(
    expectedPath,
    JSON.stringify([{ name: "apps", revision: "2.0.0-42" }]),
  );

  try {
    const process = Bun.spawn(
      [
        "bun",
        "--no-install",
        "scripts/argocd.ts",
        "release-root",
        "apps",
        expectedPath,
        "--revision",
        "2.0.0-42",
        "--request-id",
        "11111111-1111-4111-8111-111111111111",
        "--dry-run",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../../.."),
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
    expect(stdout).toContain("argocd release-root: apps at 2.0.0-42");
    expect(stdout).toContain("argocd stage-root-release: apps at 2.0.0-42");
    expect(stdout).toContain("would reconcile 1 expected Application(s)");
    expect(stdout).toContain("argocd finalize-root-release: apps at 2.0.0-42");
    expect(stdout).toContain("argocd release-health-wait: 1 expected");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
      expect(applicationRequest.infos).toContainEqual({
        name: "ci.sjer.red/revision",
        value: "2.0.0-43",
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
    } finally {
      await server.stop(true);
    }
  });
});

async function runReconcileRelease(
  origin: string,
  expected: readonly Record<string, unknown>[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "argocd-release-"));
  const expectedPath = path.join(directory, "expected.json");
  await Bun.write(expectedPath, JSON.stringify(expected));
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
          ARGOCD_SERVER_URL: origin,
          ARGOCD_TOKEN: "test-token",
          CHARTMUSEUM_ORIGIN: origin,
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
    return { exitCode, stdout, stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

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
          url.pathname === "/api/v1/applications/worker/managed-resources"
        ) {
          return Response.json({ items: [] });
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps/manifests"
        ) {
          expect(url.searchParams.get("revision")).toBe("2.0.0-42");
          return Response.json({
            manifests: [
              JSON.stringify({
                apiVersion: "argoproj.io/v1alpha1",
                kind: "Application",
                metadata: { name: "worker" },
                spec: {
                  source: {
                    repoURL: "https://chartmuseum.sjer.red",
                    chart: "worker",
                    targetRevision: "~2.0.0-0",
                  },
                },
              }),
            ],
          });
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
    try {
      const { exitCode, stdout, stderr } = await runReconcileRelease(
        server.url.origin,
        [
          { name: "apps", revision: "2.0.0-42" },
          { name: "worker", revision: "2.0.0-42" },
        ],
      );

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("sync operation started: worker");
      expect(stdout).toContain("synced: worker");
      expect(syncPosts).toBe(1);
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
          url.pathname === "/api/v1/applications/loki/sync"
        ) {
          syncPosts += 1;
          requestedOperation = operationForRootSyncRequest(
            await request.json(),
          );
          return Response.json({ operation: requestedOperation });
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps/manifests"
        ) {
          return Response.json({
            manifests: [
              JSON.stringify({
                apiVersion: "argoproj.io/v1alpha1",
                kind: "Application",
                metadata: { name: "loki" },
                spec: { source: externalSource },
              }),
            ],
          });
        }
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/loki"
        ) {
          // The application is Synced and Healthy on the source it is supposed
          // to run, so only the recorded failure can trigger the retry.
          return Response.json({
            status: {
              sync: { status: "Synced", revision: "6.1.0" },
              health: { status: "Healthy" },
              history: [{ id: 1, revision: "6.1.0", source: externalSource }],
              operationState:
                requestedOperation === undefined
                  ? { phase: "Failed", syncResult: { revision: "6.1.0" } }
                  : {
                      phase: "Succeeded",
                      operation: requestedOperation,
                      syncResult: { revision: "6.1.0" },
                    },
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
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
      expect(syncPosts).toBe(1);
    } finally {
      await server.stop(true);
    }
  });
});

describe("Argo CD stale release rejection", () => {
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
