import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const SyncRequestSchema = z.object({
  infos: z.array(z.object({ name: z.string(), value: z.string() })),
  prune: z.boolean(),
  revision: z.string().min(1),
});

function operationForSyncRequest(request: unknown): Record<string, unknown> {
  const syncRequest = SyncRequestSchema.parse(request);
  return {
    info: syncRequest.infos,
    initiatedBy: { username: "buildkite" },
    sync: { prune: syncRequest.prune, revision: syncRequest.revision },
  };
}

const RepositoryApplication = JSON.stringify({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: { name: "worker" },
  spec: {
    source: {
      repoURL: "https://chartmuseum.sjer.red",
      chart: "worker",
      targetRevision: "~2.0.0-0",
    },
    syncPolicy: { automated: { enabled: false, prune: true } },
  },
});

const StableExternalApplication = JSON.stringify({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: { name: "stable-external" },
  spec: {
    source: {
      repoURL: "https://charts.example.com",
      chart: "stable-external",
      targetRevision: "2.0.0",
      helm: { valuesObject: { feature: { enabled: true } } },
    },
    syncPolicy: { automated: { enabled: true } },
  },
});

const ChangedExternalApplication = JSON.stringify({
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Application",
  metadata: {
    name: "external",
    annotations: { "argocd.argoproj.io/sync-wave": "-1" },
  },
  spec: {
    source: {
      repoURL: "https://charts.example.com",
      chart: "external",
      targetRevision: "1.0.0",
      helm: { valuesObject: { storage: { size: "20Gi" } } },
    },
    syncPolicy: { automated: { enabled: true, prune: true } },
  },
});

describe("Argo CD staged external release reconciliation", () => {
  test("uses full deployment history and root waves before release-backed children", async () => {
    const syncOrder: string[] = [];
    const requestedOperations = new Map<string, Record<string, unknown>>();
    const requestedRevisions = new Map<string, string>();
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
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps/manifests"
        ) {
          expect(url.searchParams.get("revision")).toBe("2.0.0-42");
          return Response.json({
            // The external prerequisite follows the repository child in render
            // order but must run first because its root sync wave is lower.
            manifests: [
              RepositoryApplication,
              StableExternalApplication,
              ChangedExternalApplication,
            ],
          });
        }
        if (
          request.method === "GET" &&
          url.pathname.endsWith("/managed-resources")
        ) {
          return Response.json({ items: [] });
        }
        if (request.method === "GET" && url.pathname.endsWith("/manifests")) {
          return Response.json({ manifests: [] });
        }
        const syncMatch = /^\/api\/v1\/applications\/([^/]+)\/sync$/.exec(
          url.pathname,
        );
        if (syncMatch !== null && request.method === "POST") {
          const appName = syncMatch[1];
          if (appName === undefined) {
            return new Response("missing app", { status: 500 });
          }
          const body: unknown = await request.json();
          const syncRequest = SyncRequestSchema.parse(body);
          syncOrder.push(appName);
          requestedRevisions.set(appName, syncRequest.revision);
          const operation = operationForSyncRequest(body);
          requestedOperations.set(appName, operation);
          return Response.json({ operation });
        }
        const getMatch = /^\/api\/v1\/applications\/([^/]+)$/.exec(
          url.pathname,
        );
        if (getMatch === null || request.method !== "GET") {
          return new Response("not found", { status: 404 });
        }
        const appName = getMatch[1];
        if (appName === undefined) {
          return new Response("missing app", { status: 500 });
        }
        const operation = requestedOperations.get(appName);
        const requestedRevision = requestedRevisions.get(appName);
        if (operation !== undefined && requestedRevision !== undefined) {
          return Response.json({
            status: {
              history: [{ id: 4, revision: requestedRevision }],
              sync: { status: "Synced", revision: requestedRevision },
              operationState: {
                phase: "Succeeded",
                operation,
                syncResult: { revision: requestedRevision },
              },
            },
          });
        }
        if (appName === "external") {
          return Response.json({
            status: {
              // Comparison already reflects the staged source, but deployment
              // history still has different Helm values at the same version.
              history: [
                {
                  id: 1,
                  revision: "1.0.0",
                  source: {
                    repoURL: "https://charts.example.com",
                    chart: "external",
                    targetRevision: "1.0.0",
                    helm: { valuesObject: { storage: { size: "10Gi" } } },
                  },
                },
              ],
              sync: { status: "Synced", revision: "1.0.0" },
              operationState: {
                phase: "Succeeded",
                syncResult: { revision: "1.0.0" },
              },
            },
          });
        }
        if (appName === "stable-external") {
          return Response.json({
            status: {
              history: [
                {
                  id: 3,
                  revision: "2.0.0",
                  source: {
                    repoURL: "https://charts.example.com",
                    chart: "stable-external",
                    targetRevision: "2.0.0",
                    helm: { valuesObject: { feature: { enabled: true } } },
                  },
                },
              ],
              sync: { status: "OutOfSync", revision: "2.0.0" },
              operationState: {
                phase: "Succeeded",
                syncResult: { revision: "2.0.0" },
              },
            },
          });
        }
        return Response.json({
          status: {
            history: [{ id: 1, revision: "2.0.0-41" }],
            sync: { status: "OutOfSync", revision: "2.0.0-42" },
          },
        });
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
      expect(stdout).toContain("synced: external");
      expect(stdout).toContain("synced: worker");
      expect(stdout).not.toContain("synced: stable-external");
      expect(syncOrder).toEqual(["external", "worker"]);
      expect(requestedRevisions).toEqual(
        new Map([
          ["external", "1.0.0"],
          ["worker", "2.0.0-42"],
        ]),
      );
    } finally {
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Argo CD release inventory validation", () => {
  test("rejects an incomplete inventory before staging mutates the root", async () => {
    let syncPosts = 0;
    const renderedRevisions: (string | null)[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (
          request.method === "GET" &&
          url.pathname === "/api/v1/applications/apps/manifests"
        ) {
          renderedRevisions.push(url.searchParams.get("revision"));
          return Response.json({ manifests: [RepositoryApplication] });
        }
        if (request.method === "POST" && url.pathname.endsWith("/sync")) {
          syncPosts += 1;
        }
        return new Response("not found", { status: 404 });
      },
    });
    const directory = await mkdtemp(path.join(tmpdir(), "argocd-release-"));
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

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain(
        "Release inventory is missing repository Application worker",
      );
      expect(renderedRevisions).toEqual(["2.0.0-42"]);
      expect(stdout).not.toContain("stage-root-release");
      expect(syncPosts).toBe(0);
    } finally {
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

const CHILD_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function activeChildOperation(sync: Record<string, unknown>) {
  return {
    info: [
      { name: "ci.sjer.red/request-id", value: CHILD_REQUEST_ID },
      {
        name: "ci.sjer.red/operation-id",
        value: "22222222-2222-4222-8222-222222222222",
      },
      { name: "ci.sjer.red/revision", value: "2.0.0-42" },
      { name: "ci.sjer.red/release-phase", value: "child" },
    ],
    sync: { revision: "2.0.0-42", ...sync },
  };
}

async function reconcileAgainstActiveChildOperation(
  activeOperation: unknown,
  workerSpec: Record<string, unknown> = {},
): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
  syncPosts: number;
}> {
  let syncPosts = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
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
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps/manifests"
      ) {
        return Response.json({ manifests: [RepositoryApplication] });
      }
      if (
        request.method === "GET" &&
        url.pathname.endsWith("/managed-resources")
      ) {
        return Response.json({ items: [] });
      }
      if (request.method === "GET" && url.pathname.endsWith("/manifests")) {
        return Response.json({ manifests: [] });
      }
      if (request.method === "POST" && url.pathname.endsWith("/sync")) {
        syncPosts += 1;
        return Response.json({});
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker"
      ) {
        return Response.json({
          operation: activeOperation,
          spec: workerSpec,
          status: { sync: { status: "OutOfSync", revision: "2.0.0-41" } },
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
        "--request-id",
        CHILD_REQUEST_ID,
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
    return { exitCode, stderr, stdout, syncPosts };
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}

describe("Argo CD child reconciliation identity", () => {
  // Every one of these shares the release UUID, revision, and child phase
  // marker, so only the request comparison can reject them.
  const divergentOperations = [
    {
      applies: "a resource selection",
      sync: {
        resources: [{ group: "apps", kind: "Deployment", name: "worker" }],
      },
    },
    {
      applies: "a manifest override",
      sync: { manifests: ['{"kind":"Deployment"}'] },
    },
    { applies: "prune true", sync: { prune: true } },
    {
      applies: 'sync options ["Force=true"]',
      sync: { syncOptions: ["Force=true"] },
    },
    { applies: "an unaccounted dryRun field", sync: { dryRun: true } },
  ];

  for (const { applies, sync } of divergentOperations) {
    test(`refuses an active operation that applies ${applies}`, async () => {
      const { exitCode, stderr, syncPosts } =
        await reconcileAgainstActiveChildOperation(activeChildOperation(sync));

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain(
        `Refusing to adopt the active worker operation for request ${CHILD_REQUEST_ID}; it applies ${applies}`,
      );
      expect(syncPosts).toBe(0);
    });
  }

  test("adopts an operation carrying the Application's declared sync options", async () => {
    // Admission merges these into the operation server-side, so a legitimate
    // live operation carries options the request never sent. Rejecting them
    // would break every managed Application that declares any.
    const { stdout, stderr, syncPosts } =
      await reconcileAgainstActiveChildOperation(
        activeChildOperation({
          syncOptions: ["ServerSideApply=true", "CreateNamespace=true"],
        }),
        {
          syncPolicy: {
            syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
          },
        },
      );

    expect(stderr).not.toContain("Refusing to adopt");
    expect(stdout).toContain("adopted active sync operation: worker");
    // The adopted operation never completes in this fixture, so the run then
    // times out waiting for it; that wait is not what this test covers.
    expect(syncPosts).toBe(0);
  });
});
