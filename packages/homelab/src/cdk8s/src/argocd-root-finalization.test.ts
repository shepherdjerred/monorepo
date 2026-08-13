import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const RELEASE_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_OPERATION_ID = "33333333-3333-4333-8333-333333333333";
const BATCH_PHASE_INFO = {
  name: "ci.sjer.red/release-phase",
  value: "batch",
} as const;
const PRUNE_PHASE_INFO = {
  name: "ci.sjer.red/release-phase",
  value: "prune",
} as const;

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
  z.object({
    name: z.literal("ci.sjer.red/release-phase"),
    value: z.enum(["stage", "batch", "prune", "child"]),
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

const WorkerApplicationResource = {
  group: "argoproj.io",
  kind: "Application",
  name: "worker",
};

const RootApplicationResource = {
  group: "argoproj.io",
  kind: "Application",
  name: "apps",
};

const StagedRootApplication = JSON.stringify({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: { name: "apps" },
  spec: {
    source: {
      repoURL: "https://chartmuseum.sjer.red",
      chart: "apps",
      targetRevision: "2.0.0-43",
    },
    syncPolicy: {
      automated: { enabled: true, prune: true, selfHeal: true },
    },
  },
});

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
    },
    syncPolicy: { automated: { enabled: true } },
  },
});

function finalPruneResources(
  removedApplication: string,
  includeRoot: boolean,
): Record<string, unknown>[] {
  return [
    ...(includeRoot ? [{ ...RootApplicationResource, status: "Synced" }] : []),
    { ...WorkerApplicationResource, status: "Synced" },
    {
      group: "argoproj.io",
      kind: "Application",
      name: removedApplication,
      status: "Pruned",
    },
  ];
}

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

function releaseOperationInfo(phase: "batch" | "prune") {
  return [
    { name: "ci.sjer.red/request-id", value: RELEASE_REQUEST_ID },
    { name: "ci.sjer.red/operation-id", value: RELEASE_OPERATION_ID },
    { name: "ci.sjer.red/revision", value: "2.0.0-43" },
    { name: "ci.sjer.red/release-phase", value: phase },
  ];
}

test("root release finalization requires exact revision and request identity", async () => {
  const process = Bun.spawn(
    [
      "bun",
      "--no-install",
      "scripts/argocd.ts",
      "finalize-root-release",
      "apps",
      "--revision",
      "2.0.0-43",
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
  expect(stderr).toContain(
    "--revision and --request-id are required for finalize-root-release",
  );
});

test("root release finalization applies every exact wave before accepting a partial-wave prune result", async () => {
  const syncBodies: unknown[] = [];
  let activeRequest: unknown;
  let requestedOperation: Record<string, unknown> | undefined;
  let deleteRequests = 0;
  let finalPruneReads = 0;
  const removedApplication = "removed-worker";
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
            StagedRootApplication,
            StagedRepositoryApplication,
            StagedExternalApplication,
            StagedAdmissionPolicy,
          ],
        });
      }
      if (
        request.method === "GET" &&
        url.pathname === `/api/v1/applications/${removedApplication}`
      ) {
        return Response.json({
          metadata: {
            annotations: {
              "ci.sjer.red/application-lifecycle": "cascade",
            },
            finalizers: ["resources-finalizer.argocd.argoproj.io"],
          },
        });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        activeRequest = await request.json();
        syncBodies.push(activeRequest);
        const manifestRequest = SyncRequestSchema.safeParse(activeRequest);
        requestedOperation = manifestRequest.success
          ? operationForSyncRequest(activeRequest)
          : operationForRootSyncRequest(activeRequest);
        return Response.json({ operation: requestedOperation });
      }
      if (
        request.method === "DELETE" &&
        url.pathname === "/api/v1/applications/apps/operation"
      ) {
        deleteRequests += 1;
        activeRequest = undefined;
        requestedOperation = undefined;
        return Response.json({});
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps"
      ) {
        if (activeRequest === undefined || requestedOperation === undefined) {
          return Response.json({
            status: {
              resources: [
                {
                  group: "argoproj.io",
                  kind: "Application",
                  name: removedApplication,
                },
              ],
            },
          });
        }
        const manifestRequest = SyncRequestSchema.safeParse(activeRequest);
        if (!manifestRequest.success) {
          finalPruneReads += 1;
        }
        const resources = manifestRequest.success
          ? manifestRequest.data.resources.map((resource) => ({
              ...resource,
              status: "Synced",
            }))
          : finalPruneResources(removedApplication, finalPruneReads > 1);
        return Response.json({
          operation: requestedOperation,
          status: {
            operationState: {
              phase: "Running",
              startedAt: new Date().toISOString(),
              operation: requestedOperation,
              syncResult: {
                revision: "2.0.0-43",
                resources,
              },
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
        "finalize-root-release",
        "apps",
        "--revision",
        "2.0.0-43",
        "--request-id",
        RELEASE_REQUEST_ID,
        "--timeout",
        "1",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../../.."),
        env: {
          ...Bun.env,
          ARGOCD_POLL_INTERVAL_MS: "5",
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
    expect(stdout).toContain("finalize-root-release: apps at 2.0.0-43");
    expect(stdout).toContain("syncing exact root batch 1/3 (2 resources)");
    expect(stdout).toContain("syncing exact root batch 2/3 (1 resources)");
    expect(stdout).toContain("syncing exact root batch 3/3 (1 resources)");
    expect(syncBodies).toHaveLength(4);
    expect(deleteRequests).toBe(4);
    expect(finalPruneReads).toBeGreaterThanOrEqual(2);

    const applicationRequest = SyncRequestSchema.parse(syncBodies[0]);
    expect(applicationRequest.revision).toBe("2.0.0-43");
    expect(applicationRequest.infos).toContainEqual(BATCH_PHASE_INFO);
    expect(applicationRequest.resources).toEqual([
      WorkerApplicationResource,
      {
        group: "argoproj.io",
        kind: "Application",
        name: "external",
      },
    ]);
    expect(applicationRequest.manifests).toBeUndefined();

    const rootApplicationRequest = SyncRequestSchema.parse(syncBodies[1]);
    expect(rootApplicationRequest.resources).toEqual([RootApplicationResource]);
    const rootApplicationManifests = rootApplicationRequest.manifests;
    if (rootApplicationManifests === undefined) {
      throw new Error("Root Application is missing its suspended manifest");
    }
    expect(JSON.parse(rootApplicationManifests[0] ?? "")).toMatchObject({
      spec: { syncPolicy: { automated: { enabled: false } } },
    });

    const policyRequest = SyncRequestSchema.parse(syncBodies[2]);
    expect(policyRequest.resources).toEqual([
      {
        group: "admissionregistration.k8s.io",
        kind: "ValidatingAdmissionPolicy",
        name: "pvc-backup-policy.sjer.red",
      },
    ]);
    expect(policyRequest.manifests).toBeUndefined();
    const pruneRequest = RootSyncRequestSchema.parse(syncBodies[3]);
    expect(pruneRequest.prune).toBe(true);
    expect(pruneRequest.infos).toContainEqual(PRUNE_PHASE_INFO);
    const rawPruneRequest = z
      .record(z.string(), z.unknown())
      .parse(syncBodies[3]);
    expect(rawPruneRequest["resources"]).toBeUndefined();
    expect(rawPruneRequest["manifests"]).toBeUndefined();
  } finally {
    await server.stop(true);
  }
});

test("root release finalization adopts the exact active batch without replaying prior waves", async () => {
  const policyResource = {
    group: "admissionregistration.k8s.io",
    kind: "ValidatingAdmissionPolicy",
    name: "pvc-backup-policy.sjer.red",
  };
  const activeBatchRequest = {
    infos: releaseOperationInfo("batch"),
    prune: false,
    resources: [policyResource],
    revision: "2.0.0-43",
  };
  let activeRequest: unknown = activeBatchRequest;
  let requestedOperation: Record<string, unknown> | undefined =
    operationForSyncRequest(activeBatchRequest);
  let deleteRequests = 0;
  let syncPosts = 0;
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
        return Response.json({
          manifests: [
            StagedRootApplication,
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
        syncPosts += 1;
        activeRequest = await request.json();
        requestedOperation = operationForRootSyncRequest(activeRequest);
        return Response.json({ operation: requestedOperation });
      }
      if (
        request.method === "DELETE" &&
        url.pathname === "/api/v1/applications/apps/operation"
      ) {
        deleteRequests += 1;
        activeRequest = undefined;
        requestedOperation = undefined;
        return Response.json({});
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps"
      ) {
        if (activeRequest === undefined || requestedOperation === undefined) {
          return Response.json({ status: { resources: [] } });
        }
        const manifestRequest = SyncRequestSchema.safeParse(activeRequest);
        return Response.json({
          operation: requestedOperation,
          status: {
            resources: [],
            operationState: {
              phase: "Running",
              startedAt: new Date().toISOString(),
              operation: requestedOperation,
              syncResult: {
                revision: "2.0.0-43",
                resources: manifestRequest.success
                  ? manifestRequest.data.resources.map((resource) => ({
                      ...resource,
                      status: "Synced",
                    }))
                  : [
                      { ...RootApplicationResource, status: "Synced" },
                      { ...WorkerApplicationResource, status: "Synced" },
                    ],
              },
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
        "finalize-root-release",
        "apps",
        "--revision",
        "2.0.0-43",
        "--request-id",
        RELEASE_REQUEST_ID,
        "--timeout",
        "1",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../../.."),
        env: {
          ...Bun.env,
          ARGOCD_POLL_INTERVAL_MS: "5",
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
    expect(stdout).toContain("adopting exact root batch 3/3 (1 resources)");
    expect(stdout).not.toContain("syncing exact root batch 1/2");
    expect(syncPosts).toBe(1);
    expect(deleteRequests).toBe(2);
  } finally {
    await server.stop(true);
  }
});

test("root release finalization adopts the exact active prune without another POST", async () => {
  const activeOperation = operationForRootSyncRequest({
    infos: releaseOperationInfo("prune"),
    prune: true,
    revision: "2.0.0-43",
  });
  const unmarkedOperation = operationForRootSyncRequest({
    infos: releaseOperationInfo("prune").filter(
      ({ name }) => name !== "ci.sjer.red/release-phase",
    ),
    prune: true,
    revision: "2.0.0-43",
  });
  let marked = false;
  let live = true;
  let deleteRequests = 0;
  let syncPosts = 0;
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
        return Response.json({ manifests: [StagedRootApplication] });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        syncPosts += 1;
        return Response.json({});
      }
      if (
        request.method === "DELETE" &&
        url.pathname === "/api/v1/applications/apps/operation"
      ) {
        deleteRequests += 1;
        live = false;
        return Response.json({});
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps"
      ) {
        if (!live) {
          return Response.json({ status: { resources: [] } });
        }
        const currentOperation = marked ? activeOperation : unmarkedOperation;
        return Response.json({
          operation: currentOperation,
          status: {
            resources: [],
            operationState: {
              phase: "Running",
              startedAt: new Date().toISOString(),
              operation: currentOperation,
              syncResult: {
                revision: "2.0.0-43",
                resources: [{ ...RootApplicationResource, status: "Synced" }],
              },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  try {
    const unmarkedProcess = Bun.spawn(
      [
        "bun",
        "--no-install",
        "scripts/argocd.ts",
        "finalize-root-release",
        "apps",
        "--revision",
        "2.0.0-43",
        "--request-id",
        RELEASE_REQUEST_ID,
        "--timeout",
        "1",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../../.."),
        env: {
          ...Bun.env,
          ARGOCD_POLL_INTERVAL_MS: "5",
          ARGOCD_SERVER_URL: server.url.origin,
          ARGOCD_TOKEN: "test-token",
          CHARTMUSEUM_ORIGIN: server.url.origin,
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const [unmarkedExitCode, unmarkedStderr] = await Promise.all([
      unmarkedProcess.exited,
      new Response(unmarkedProcess.stderr).text(),
    ]);
    expect(unmarkedExitCode).not.toBe(0);
    expect(unmarkedStderr).toContain(
      "full-source operation is not the marked final root prune",
    );
    expect(syncPosts).toBe(0);
    expect(deleteRequests).toBe(0);

    marked = true;
    const process = Bun.spawn(
      [
        "bun",
        "--no-install",
        "scripts/argocd.ts",
        "finalize-root-release",
        "apps",
        "--revision",
        "2.0.0-43",
        "--request-id",
        RELEASE_REQUEST_ID,
        "--timeout",
        "1",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../../.."),
        env: {
          ...Bun.env,
          ARGOCD_POLL_INTERVAL_MS: "5",
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
    expect(stdout).toContain("adopting active final root prune: apps");
    expect(syncPosts).toBe(0);
    expect(deleteRequests).toBe(1);
  } finally {
    await server.stop(true);
  }
});

test("release-root resumes at a live later phase instead of restaging", async () => {
  const activeOperation = operationForRootSyncRequest({
    infos: releaseOperationInfo("prune"),
    prune: true,
    revision: "2.0.0-43",
  });
  let live = true;
  let deleteRequests = 0;
  let syncPosts = 0;
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
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps/manifests"
      ) {
        return Response.json({ manifests: [StagedRootApplication] });
      }
      if (request.method === "GET" && url.pathname === "/api/v1/applications") {
        return Response.json({ items: [] });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        syncPosts += 1;
        return Response.json({});
      }
      if (
        request.method === "DELETE" &&
        url.pathname === "/api/v1/applications/apps/operation"
      ) {
        deleteRequests += 1;
        live = false;
        return Response.json({});
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps"
      ) {
        if (!live) {
          return Response.json({ status: { resources: [] } });
        }
        return Response.json({
          operation: activeOperation,
          status: {
            resources: [],
            operationState: {
              phase: "Running",
              startedAt: new Date().toISOString(),
              operation: activeOperation,
              syncResult: {
                revision: "2.0.0-43",
                resources: [{ ...RootApplicationResource, status: "Synced" }],
              },
            },
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const directory = await mkdtemp(path.join(tmpdir(), "argocd-resume-"));
  const expectedPath = path.join(directory, "expected.json");
  await Bun.write(
    expectedPath,
    JSON.stringify([{ name: "apps", revision: "2.0.0-43" }]),
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
        "2.0.0-43",
        "--request-id",
        RELEASE_REQUEST_ID,
        "--timeout",
        "1",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../../.."),
        env: {
          ...Bun.env,
          ARGOCD_POLL_INTERVAL_MS: "5",
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
    expect(stdout).toContain(
      `resuming apps release at the prune phase for request ${RELEASE_REQUEST_ID}`,
    );
    expect(stdout).toContain("adopting active final root prune: apps");
    expect(stdout).not.toContain("stage-root-release");
    expect(syncPosts).toBe(0);
    expect(deleteRequests).toBe(1);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("root release finalization refuses a batch selecting another namespace", async () => {
  // Same group, kind, and name as the rendered policy, but a namespace the
  // rendered revision never declares, so it is a different target.
  const activeOperation = {
    info: releaseOperationInfo("batch"),
    initiatedBy: { username: "buildkite" },
    sync: {
      prune: false,
      resources: [
        {
          group: "admissionregistration.k8s.io",
          kind: "ValidatingAdmissionPolicy",
          name: "pvc-backup-policy.sjer.red",
          namespace: "other",
        },
      ],
      revision: "2.0.0-43",
    },
  };
  let syncPosts = 0;
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
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps/manifests"
      ) {
        return Response.json({
          manifests: [
            StagedRootApplication,
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
        syncPosts += 1;
        return Response.json({});
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps"
      ) {
        return Response.json({
          operation: activeOperation,
          status: {
            resources: [],
            operationState: {
              phase: "Running",
              startedAt: new Date().toISOString(),
              operation: activeOperation,
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
        "finalize-root-release",
        "apps",
        "--revision",
        "2.0.0-43",
        "--request-id",
        RELEASE_REQUEST_ID,
        "--timeout",
        "1",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../../.."),
        env: {
          ...Bun.env,
          ARGOCD_POLL_INTERVAL_MS: "5",
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
    expect(stderr).toContain("does not match an exact root batch");
    expect(syncPosts).toBe(0);
  } finally {
    await server.stop(true);
  }
});
