import { expect, test } from "bun:test";
import path from "node:path";

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

test("sync-managed preflights the requested revision", async () => {
  let syncPosts = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
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
                spec: { selector: { matchLabels: { app: "worker" } } },
              }),
            },
          ],
        });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker/manifests"
      ) {
        expect(url.searchParams.get("revision")).toBe("2.0.0-43");
        return Response.json({
          manifests: [
            JSON.stringify({
              apiVersion: "apps/v1",
              kind: "Deployment",
              metadata: { name: "worker" },
              spec: { selector: { matchLabels: { app: "api" } } },
            }),
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

test("sync-managed preflights a resource the requested revision introduces", async () => {
  let syncPosts = 0;
  const resourceQueries: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
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
        // The configured revision does not know about the StatefulSet at all.
        return Response.json({ items: [] });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker/manifests"
      ) {
        expect(url.searchParams.get("revision")).toBe("2.0.0-43");
        return Response.json({
          manifests: [
            JSON.stringify({
              apiVersion: "apps/v1",
              kind: "StatefulSet",
              metadata: { name: "index", namespace: "worker" },
              spec: { selector: { matchLabels: { app: "index-v2" } } },
            }),
          ],
        });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/worker/resource"
      ) {
        resourceQueries.push(url.search);
        return Response.json({
          manifest: JSON.stringify({
            apiVersion: "apps/v1",
            kind: "StatefulSet",
            metadata: { name: "index", namespace: "worker" },
            spec: { selector: { matchLabels: { app: "index" } } },
          }),
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
      "apps/StatefulSet worker/index changes immutable /spec/selector",
    );
    expect(resourceQueries).toHaveLength(1);
    expect(resourceQueries[0]).toContain("resourceName=index");
    expect(resourceQueries[0]).toContain("namespace=worker");
    expect(syncPosts).toBe(0);
  } finally {
    await server.stop(true);
  }
});
