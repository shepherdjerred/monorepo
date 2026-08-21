import { expect, test } from "vitest";
import path from "node:path";
import { serveIntroducedResourceLookup } from "./argocd-script-support.ts";
import {
  readArgocdApiContract,
  resourceOutsideApplicationMessage,
} from "@shepherdjerred/homelab/cdk8s/scripts/argocd-api-contract.ts";

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

// ArgoCD does not answer a resource outside the Application's live tree with a
// 404. It fails the lookup with `codes.InvalidArgument` — HTTP 400 — so the
// preflight's 404 branch never fires for the very case it exists to allow: a
// resource the requested revision introduces, which by definition has no live
// object yet. Reading that as a hard error failed `argocd-sync` on every main
// build once the revision declared a Job the live tree did not carry.

test("sync-managed treats a resource outside the live tree as a creation", async () => {
  // The absent-resource response comes from the recorded contract rather than a
  // literal typed here, so this test and the offline contract tests cannot drift
  // apart — separate fakes agreeing with each other, and both being wrong, is
  // exactly how the original bug survived.
  const contract = await readArgocdApiContract();
  const absent = contract.cases.find(
    (entry) => entry.name === "resource-absent-from-application",
  );
  if (absent === undefined) {
    throw new Error("contract is missing resource-absent-from-application");
  }
  // The recording is against another application and resource name, so rebuild
  // its message for this fixture's identity using the server's own format.
  const message = resourceOutsideApplicationMessage({
    ...absent,
    request: {
      application: "worker",
      query: { resourceName: "index-init", kind: "Job", group: "batch" },
    },
  });
  const { server, syncPosts, resourceQueries } = serveIntroducedResourceLookup({
    response: {
      status: absent.response.status,
      body: { error: message, code: 3, message },
    },
  });
  try {
    const { exitCode, stderr } = await runSyncManagedAtRevision(
      server.url.origin,
    );

    expect(stderr).not.toContain("Could not read live");
    expect(exitCode).toBe(0);
    expect(resourceQueries).toHaveLength(1);
    expect(resourceQueries[0]).toContain("resourceName=index-init");
    expect(syncPosts()).toBe(1);
  } finally {
    await server.stop(true);
  }
});

test("sync-managed still fails on an unrecognized 400 from the resource endpoint", async () => {
  const { server, syncPosts } = serveIntroducedResourceLookup({
    response: {
      status: 400,
      body: {
        error: "server misconfigured",
        code: 3,
        message: "server misconfigured",
      },
    },
  });
  try {
    const { exitCode, stderr } = await runSyncManagedAtRevision(
      server.url.origin,
    );

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Could not read live Job index-init for worker");
    expect(stderr).toContain("server misconfigured");
    expect(syncPosts()).toBe(0);
  } finally {
    await server.stop(true);
  }
});

// The rendered manifest and the live inventory can each legitimately omit the
// namespace for the same object, so a missing one on either side is a wildcard.
// Two concrete, different namespaces are a real disagreement — and used to be
// the quietest possible outcome, because no match meant no `targetState`, and a
// resource without a target is skipped by the immutable checks entirely.
function serveNamespaceScopedPreflight(options: {
  readonly liveNamespace?: string;
  readonly renderedNamespace?: string;
}) {
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
              name: "worker",
              ...(options.liveNamespace === undefined
                ? {}
                : { namespace: options.liveNamespace }),
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
        return Response.json({
          manifests: [
            JSON.stringify({
              apiVersion: "apps/v1",
              kind: "Deployment",
              metadata: {
                name: "worker",
                ...(options.renderedNamespace === undefined
                  ? {}
                  : { namespace: options.renderedNamespace }),
              },
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
  return { server, syncPosts: () => syncPosts };
}

async function runSyncManagedAtRevision(origin: string) {
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
        ARGOCD_SERVER_URL: origin,
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
  return { exitCode, stderr };
}

for (const scenario of [
  {
    name: "the live inventory omits the namespace the rendering declares",
    liveNamespace: undefined,
    renderedNamespace: "worker",
    error: "apps/Deployment _cluster/worker changes immutable /spec/selector",
  },
  {
    name: "the rendering declares a different namespace",
    liveNamespace: "worker",
    renderedNamespace: "other",
    error: "but rendered it in other",
  },
]) {
  test(`sync-managed preflight refuses to skip when ${scenario.name}`, async () => {
    const { server, syncPosts } = serveNamespaceScopedPreflight(scenario);
    try {
      const { exitCode, stderr } = await runSyncManagedAtRevision(
        server.url.origin,
      );

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain(scenario.error);
      expect(syncPosts()).toBe(0);
    } finally {
      await server.stop(true);
    }
  });
}
