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
  resources: z.array(
    z.object({
      group: z.string(),
      kind: z.string(),
      name: z.string(),
    }),
  ),
});

const WorkerApplicationResource = {
  group: "argoproj.io",
  kind: "Application",
  name: "worker",
};

function operationForSyncRequest(request: unknown): unknown {
  const syncRequest = SyncRequestSchema.parse(request);
  return {
    info: syncRequest.infos,
    initiatedBy: { username: "buildkite" },
    sync: {
      manifests: syncRequest.manifests,
      resources: syncRequest.resources,
    },
  };
}

function expectSuspendedWorkerRequest(request: unknown): void {
  const syncRequest = SyncRequestSchema.parse(request);
  expect(syncRequest.infos).toHaveLength(1);
  expect(syncRequest.infos[0]?.name).toBe("ci.sjer.red/request-id");
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
  test("blocks root pruning when a removed child lacks the cascade finalizer", async () => {
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
        if (url.pathname === "/api/v1/applications/apps") {
          return Response.json({
            status: {
              resources: [
                {
                  kind: "Application",
                  name: "unsafe-child",
                  status: "OutOfSync",
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
});

describe("Argo CD release gating", () => {
  test("suspends repository auto-sync through an explicit root manifest sync", async () => {
    const syncBodies: unknown[] = [];
    let requestedOperation: unknown;
    const renderedRevisions: (string | null)[] = [];
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
                revision: "2.0.0-42",
              },
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
      expect(stdout).toContain("suspending auto-sync: worker");
      expect(renderedRevisions).toEqual(["2.0.0-42"]);
      expect(syncBodies).toHaveLength(1);
      expectSuspendedWorkerRequest(syncBodies[0]);
    } finally {
      await server.stop(true);
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
