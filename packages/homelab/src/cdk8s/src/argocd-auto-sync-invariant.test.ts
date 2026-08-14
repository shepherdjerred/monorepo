import { expect, test } from "bun:test";
import path from "node:path";

// An aborted release leaves every child carrying the suspension override it
// applied while staging, and nothing reports it: suspension lives in `spec`
// while Synced/Healthy live in `status`, so 63 of 64 Applications sat frozen
// for ~1.5h on 2026-08-14 while the whole tree read healthy. These tests drive
// the real script so both the rendered-vs-live rule and its wiring are covered.

const REVISION = "2.0.0-43";

function application(
  name: string,
  automated: Record<string, unknown> | undefined,
): string {
  return JSON.stringify({
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: { name },
    spec: {
      source: { repoURL: "https://chartmuseum.sjer.red", chart: name },
      syncPolicy: {
        ...(automated === undefined ? {} : { automated }),
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}

function liveItem(
  name: string,
  automated: Record<string, unknown> | undefined,
): unknown {
  return {
    metadata: { name },
    spec: {
      syncPolicy: {
        ...(automated === undefined ? {} : { automated }),
        syncOptions: ["CreateNamespace=true"],
      },
    },
  };
}

/**
 * Serve just the two endpoints the invariant reads. `listResponses` supplies one
 * body per request, the last repeating, so a test can model the informer cache
 * lagging the closing sync.
 */
function serveAutoSyncVerification(options: {
  readonly manifests: readonly string[];
  readonly listResponses: readonly unknown[];
}) {
  let listRequests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps/manifests"
      ) {
        expect(url.searchParams.get("revision")).toBe(REVISION);
        return Response.json({ manifests: options.manifests });
      }
      if (request.method === "GET" && url.pathname === "/api/v1/applications") {
        const index = Math.min(listRequests, options.listResponses.length - 1);
        listRequests += 1;
        return Response.json({ items: options.listResponses[index] });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { server, listRequests: () => listRequests };
}

async function runVerifyAutoSync(origin: string) {
  const process = Bun.spawn(
    [
      "bun",
      "--no-install",
      "scripts/argocd.ts",
      "verify-auto-sync",
      "apps",
      "--revision",
      REVISION,
    ],
    {
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: {
        ...Bun.env,
        ARGOCD_SERVER_URL: origin,
        ARGOCD_TOKEN: "test-token",
        ARGOCD_POLL_INTERVAL_MS: "5",
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
}

test("verify-auto-sync refuses a child left auto-sync suspended", async () => {
  const { server } = serveAutoSyncVerification({
    manifests: [
      application("apps", { enabled: false }),
      application("worker", { enabled: true, prune: true, selfHeal: true }),
    ],
    listResponses: [
      [
        liveItem("apps", { enabled: false }),
        liveItem("worker", { enabled: false, prune: true, selfHeal: true }),
      ],
    ],
  });
  try {
    const { exitCode, stderr } = await runVerifyAutoSync(server.url.origin);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(
      `Refusing to complete the apps release at ${REVISION} because live ` +
        "auto-sync policy diverges from the rendered revision",
    );
    expect(stderr).toContain(
      '- worker: live {"enabled":false,"prune":true,"selfHeal":true} ' +
        'declared {"enabled":true,"prune":true,"selfHeal":true}',
    );
    // The root declares itself suspended, so it is not a finding.
    expect(stderr).not.toContain("- apps:");
  } finally {
    await server.stop(true);
  }
});

test("verify-auto-sync accepts a repository chart declared suspended", async () => {
  const { server } = serveAutoSyncVerification({
    manifests: [
      application("apps", { enabled: false }),
      application("repository", {
        enabled: false,
        prune: true,
        selfHeal: true,
      }),
    ],
    listResponses: [
      [
        liveItem("apps", { enabled: false }),
        liveItem("repository", {
          enabled: false,
          prune: true,
          selfHeal: true,
        }),
      ],
    ],
  });
  try {
    const { exitCode, stdout, stderr } = await runVerifyAutoSync(
      server.url.origin,
    );

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "live auto-sync policy matches the rendered revision",
    );
  } finally {
    await server.stop(true);
  }
});

test("verify-auto-sync ignores an Application the revision does not declare", async () => {
  const { server } = serveAutoSyncVerification({
    manifests: [application("worker", { enabled: true })],
    listResponses: [
      [
        liveItem("worker", { enabled: true }),
        // A retirement's leftover, pending prune — suspended, and not ours.
        liveItem("plausible", { enabled: false }),
      ],
    ],
  });
  try {
    const { exitCode, stderr } = await runVerifyAutoSync(server.url.origin);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  } finally {
    await server.stop(true);
  }
});

test("verify-auto-sync tolerates a live list that has not caught up", async () => {
  const { server, listRequests } = serveAutoSyncVerification({
    manifests: [application("worker", { enabled: true })],
    listResponses: [
      // The closing sync returns as soon as it is applied, so the first read can
      // still show the pre-restore spec.
      [liveItem("worker", { enabled: false })],
      [liveItem("worker", { enabled: true })],
    ],
  });
  try {
    const { exitCode, stderr } = await runVerifyAutoSync(server.url.origin);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(listRequests()).toBeGreaterThanOrEqual(2);
  } finally {
    await server.stop(true);
  }
});

test("verify-auto-sync gives up on a divergence that never settles", async () => {
  const { server, listRequests } = serveAutoSyncVerification({
    manifests: [application("worker", { enabled: true })],
    listResponses: [[liveItem("worker", { enabled: false })]],
  });
  try {
    const { exitCode, stderr } = await runVerifyAutoSync(server.url.origin);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(
      '- worker: live {"enabled":false} declared {"enabled":true}',
    );
    // Bounded: it must not poll for the whole release timeout.
    expect(listRequests()).toBe(3);
  } finally {
    await server.stop(true);
  }
});

test("verify-auto-sync requires an exact revision", async () => {
  const process = Bun.spawn(
    ["bun", "--no-install", "scripts/argocd.ts", "verify-auto-sync", "apps"],
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
  expect(stderr).toContain("verify-auto-sync requires an exact --revision");
});
