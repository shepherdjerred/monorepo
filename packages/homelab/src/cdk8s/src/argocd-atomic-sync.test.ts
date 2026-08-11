import { expect, test } from "bun:test";
import path from "node:path";
import { z } from "zod";

const CURRENT_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const REVISION = "2.0.0-42";

const RootSyncRequestSchema = z.object({
  infos: z.array(
    z.object({
      name: z.string(),
      value: z.uuid(),
    }),
  ),
  prune: z.boolean(),
  revision: z.string(),
});

type OperationResource = {
  readonly hookPhase?: string;
  readonly status: string;
};

type LifecycleObservations = {
  deleteRequests: number;
  postDeleteGets: number;
  statusGets: number;
  syncPosts: number;
};

function operationResponse(request: unknown): unknown {
  const syncRequest = RootSyncRequestSchema.parse(request);
  return {
    operation: {
      info: syncRequest.infos,
      initiatedBy: { username: "buildkite" },
      sync: {
        prune: syncRequest.prune,
        revision: syncRequest.revision,
      },
    },
  };
}

function identifiedOperation(requestId: string, revision = REVISION): unknown {
  return {
    info: [
      {
        name: "ci.sjer.red/request-id",
        value: requestId,
      },
    ],
    sync: { revision },
  };
}

function applicationOperation(options: {
  readonly live?: boolean;
  readonly message?: string;
  readonly phase: string;
  readonly requestId: string;
  readonly resources?: readonly OperationResource[];
  readonly revision?: string;
  readonly startedAt?: string;
}): unknown {
  const revision = options.revision ?? REVISION;
  const operation = identifiedOperation(options.requestId, revision);
  const live =
    options.live ??
    (options.phase === "Running" || options.phase === "Terminating");
  return {
    ...(live ? { operation } : {}),
    status: {
      operationState: {
        phase: options.phase,
        operation,
        syncResult: {
          revision,
          resources: options.resources ?? [],
        },
        ...(options.startedAt === undefined
          ? {}
          : { startedAt: options.startedAt }),
        ...(options.message === undefined ? {} : { message: options.message }),
      },
    },
  };
}

function fixtureAt(fixtures: readonly unknown[], index: number): unknown {
  const fixture = fixtures[Math.min(index, fixtures.length - 1)];
  if (fixture === undefined) {
    throw new Error("Lifecycle fixture list must not be empty");
  }
  return fixture;
}

function serveLifecycle(
  beforeDelete: readonly unknown[],
  afterDelete: readonly unknown[] = [{ status: {} }],
) {
  const observations: LifecycleObservations = {
    deleteRequests: 0,
    postDeleteGets: 0,
    statusGets: 0,
    syncPosts: 0,
  };
  let terminated = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        observations.syncPosts += 1;
        return Response.json(operationResponse(await request.json()));
      }
      if (
        request.method === "DELETE" &&
        url.pathname === "/api/v1/applications/apps/operation"
      ) {
        observations.deleteRequests += 1;
        terminated = true;
        return new Response(null, { status: 204 });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps"
      ) {
        if (terminated) {
          const fixture = fixtureAt(afterDelete, observations.postDeleteGets);
          observations.postDeleteGets += 1;
          return Response.json(fixture);
        }
        const fixture = fixtureAt(beforeDelete, observations.statusGets);
        observations.statusGets += 1;
        return Response.json(fixture);
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { observations, server };
}

async function runArgocd(
  args: readonly string[],
  serverOrigin = "http://127.0.0.1:1",
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const process = Bun.spawn(
    ["bun", "--no-install", "scripts/argocd.ts", ...args],
    {
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: {
        ...Bun.env,
        ARGOCD_POLL_INTERVAL_MS: "5",
        ARGOCD_SERVER_URL: serverOrigin,
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
  return { exitCode, stderr, stdout };
}

function atomicArgs(): readonly string[] {
  return [
    "sync",
    "apps",
    "--revision",
    REVISION,
    "--terminate-after-applied",
    "--request-id",
    CURRENT_REQUEST_ID,
    "--timeout",
    "1",
  ];
}

function recoveryArgs(): readonly string[] {
  return [
    "finalize-async-sync",
    "apps",
    "--revision",
    REVISION,
    "--request-id",
    CURRENT_REQUEST_ID,
    "--timeout",
    "1",
  ];
}

test("atomic Argo sync ignores stale status, applies the live result, and waits for termination", async () => {
  const resources: OperationResource[] = [
    ...Array.from({ length: 255 }, (_, index) => ({
      status: "Synced",
      ...(index < 5 ? { hookPhase: "Running" } : {}),
    })),
    { status: "Pruned" },
    { status: "Pruned" },
  ];
  const stale = applicationOperation({
    phase: "Succeeded",
    requestId: CURRENT_REQUEST_ID,
    resources: [{ status: "Synced" }],
    startedAt: "2026-08-10T01:00:00Z",
  });
  const current = applicationOperation({
    phase: "Running",
    requestId: CURRENT_REQUEST_ID,
    resources,
    startedAt: "2026-08-10T01:00:01Z",
  });
  const terminating = applicationOperation({
    phase: "Terminating",
    requestId: CURRENT_REQUEST_ID,
    resources,
    startedAt: "2026-08-10T01:00:01Z",
  });
  const lifecycle = serveLifecycle(
    [stale, { status: {} }, stale, current],
    [terminating, { status: {} }],
  );

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("terminated applied sync operation: apps");
    expect(lifecycle.observations.syncPosts).toBe(1);
    expect(lifecycle.observations.deleteRequests).toBe(1);
    expect(lifecycle.observations.postDeleteGets).toBe(2);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync adopts the exact active operation without another POST", async () => {
  const lifecycle = serveLifecycle([
    applicationOperation({
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "OutOfSync" }],
    }),
    applicationOperation({
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced", hookPhase: "Running" }],
    }),
  ]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("adopted active sync operation: apps");
    expect(lifecycle.observations.syncPosts).toBe(0);
    expect(lifecycle.observations.deleteRequests).toBe(1);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync waits past matching stale status when adopting a retry", async () => {
  const stale = applicationOperation({
    live: true,
    phase: "Succeeded",
    requestId: CURRENT_REQUEST_ID,
    resources: [{ status: "Synced" }],
    startedAt: "2026-08-10T01:00:00Z",
  });
  const current = applicationOperation({
    phase: "Running",
    requestId: CURRENT_REQUEST_ID,
    resources: [{ status: "Synced", hookPhase: "Running" }],
    startedAt: "2026-08-10T01:00:01Z",
  });
  const lifecycle = serveLifecycle([stale, current]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("adopted active sync operation: apps");
    expect(result.stdout).not.toContain("synced: apps");
    expect(lifecycle.observations.syncPosts).toBe(0);
    expect(lifecycle.observations.deleteRequests).toBe(1);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync posts past a stale status-only Running operation", async () => {
  const stale = applicationOperation({
    live: false,
    phase: "Running",
    requestId: OTHER_REQUEST_ID,
    resources: [{ status: "Synced" }],
    startedAt: "2026-08-10T01:00:00Z",
  });
  const current = applicationOperation({
    phase: "Running",
    requestId: CURRENT_REQUEST_ID,
    resources: [{ status: "Synced", hookPhase: "Running" }],
    startedAt: "2026-08-10T01:00:01Z",
  });
  const lifecycle = serveLifecycle([stale, stale, current]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("sync operation started: apps");
    expect(lifecycle.observations.syncPosts).toBe(1);
    expect(lifecycle.observations.deleteRequests).toBe(1);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync finishes an adopted applied termination", async () => {
  const lifecycle = serveLifecycle([
    applicationOperation({
      phase: "Terminating",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced", hookPhase: "Running" }],
    }),
    { status: {} },
  ]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("sync operation already finalized: apps");
    expect(lifecycle.observations.syncPosts).toBe(0);
    expect(lifecycle.observations.deleteRequests).toBe(0);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync accepts natural success without DELETE", async () => {
  const lifecycle = serveLifecycle([
    { status: {} },
    applicationOperation({
      phase: "Succeeded",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced" }],
      startedAt: "2026-08-10T01:00:01Z",
    }),
  ]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("synced: apps");
    expect(lifecycle.observations.deleteRequests).toBe(0);
  } finally {
    await lifecycle.server.stop(true);
  }
});

for (const scenario of [
  {
    name: "another request ID at the same revision",
    requestId: OTHER_REQUEST_ID,
    revision: REVISION,
    error: "Refusing to replace active apps operation",
  },
  {
    name: "the same request ID at another revision",
    requestId: CURRENT_REQUEST_ID,
    revision: "2.0.0-41",
    error: `expected ${REVISION}`,
  },
]) {
  test(`atomic Argo sync refuses ${scenario.name}`, async () => {
    const lifecycle = serveLifecycle([
      applicationOperation({
        phase: "Running",
        requestId: scenario.requestId,
        resources: [{ status: "Synced" }],
        revision: scenario.revision,
      }),
    ]);

    try {
      const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(scenario.error);
      expect(lifecycle.observations.syncPosts).toBe(0);
      expect(lifecycle.observations.deleteRequests).toBe(0);
    } finally {
      await lifecycle.server.stop(true);
    }
  });
}

for (const phase of ["Failed", "Error"]) {
  test(`atomic Argo sync fails when the exact operation reaches ${phase}`, async () => {
    const lifecycle = serveLifecycle([
      { status: {} },
      applicationOperation({
        message: "operation failed",
        phase,
        requestId: CURRENT_REQUEST_ID,
        resources: [{ status: "Synced" }],
        startedAt: "2026-08-10T01:00:01Z",
      }),
    ]);

    try {
      const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(`Sync operation ${phase} for apps`);
      expect(lifecycle.observations.deleteRequests).toBe(0);
    } finally {
      await lifecycle.server.stop(true);
    }
  });
}

test("atomic Argo sync times out when its operation never becomes visible", async () => {
  const lifecycle = serveLifecycle([{ status: {} }]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("did not complete within 1s");
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync fails if another operation starts after DELETE", async () => {
  const lifecycle = serveLifecycle(
    [
      { status: {} },
      applicationOperation({
        phase: "Running",
        requestId: CURRENT_REQUEST_ID,
        resources: [{ status: "Synced" }],
        startedAt: "2026-08-10T01:00:01Z",
      }),
    ],
    [
      applicationOperation({
        phase: "Running",
        requestId: OTHER_REQUEST_ID,
        resources: [{ status: "Synced" }],
        startedAt: "2026-08-10T01:00:02Z",
      }),
    ],
  );

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("after terminating request");
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync fails if a completed unrelated operation replaces it after DELETE", async () => {
  const lifecycle = serveLifecycle(
    [
      { status: {} },
      applicationOperation({
        phase: "Running",
        requestId: CURRENT_REQUEST_ID,
        resources: [{ status: "Synced" }],
        startedAt: "2026-08-10T01:00:01Z",
      }),
    ],
    [
      applicationOperation({
        phase: "Succeeded",
        requestId: OTHER_REQUEST_ID,
        resources: [{ status: "Synced" }],
        startedAt: "2026-08-10T01:00:02Z",
      }),
    ],
  );

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("after terminating request");
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("Argo recovery waits for the exact operation before finalizing it", async () => {
  const lifecycle = serveLifecycle([
    { status: {} },
    applicationOperation({
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced", hookPhase: "Running" }],
    }),
  ]);

  try {
    const result = await runArgocd(recoveryArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(lifecycle.observations.deleteRequests).toBe(1);
    expect(lifecycle.observations.statusGets).toBeGreaterThanOrEqual(2);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("Argo recovery refuses a different active request", async () => {
  const lifecycle = serveLifecycle([
    applicationOperation({
      phase: "Running",
      requestId: OTHER_REQUEST_ID,
      resources: [{ status: "Synced" }],
    }),
  ]);

  try {
    const result = await runArgocd(recoveryArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "Refusing to terminate active apps operation",
    );
    expect(lifecycle.observations.deleteRequests).toBe(0);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("Argo recovery refuses an unrelated live operation behind matching stale status", async () => {
  const lifecycle = serveLifecycle([
    {
      operation: identifiedOperation(OTHER_REQUEST_ID),
      status: {
        operationState: {
          operation: identifiedOperation(CURRENT_REQUEST_ID),
          phase: "Running",
          syncResult: {
            resources: [{ status: "Synced" }],
            revision: REVISION,
          },
        },
      },
    },
  ]);

  try {
    const result = await runArgocd(recoveryArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      `expected request ${CURRENT_REQUEST_ID} at ${REVISION}`,
    );
    expect(lifecycle.observations.deleteRequests).toBe(0);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("Argo recovery never terminates matching status without a live operation", async () => {
  const lifecycle = serveLifecycle([
    applicationOperation({
      live: false,
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced" }],
    }),
  ]);

  try {
    const result = await runArgocd(recoveryArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("was not fully applied within 1s");
    expect(lifecycle.observations.deleteRequests).toBe(0);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("Argo recovery refuses the same request at another revision", async () => {
  const lifecycle = serveLifecycle([
    applicationOperation({
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced" }],
      revision: "2.0.0-41",
    }),
  ]);

  try {
    const result = await runArgocd(recoveryArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`expected ${REVISION}`);
    expect(lifecycle.observations.deleteRequests).toBe(0);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("Argo recovery times out instead of accepting a missing operation", async () => {
  const lifecycle = serveLifecycle([{ status: {} }]);

  try {
    const result = await runArgocd(recoveryArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("was not fully applied within 1s");
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("Argo CLI rejects incompatible sync completion modes", async () => {
  const result = await runArgocd([
    ...atomicArgs().slice(0, -2),
    "--async",
    "--dry-run",
  ]);

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain(
    "--async and --terminate-after-applied cannot be combined",
  );
});

test("Argo CLI requires a revision for deterministic request IDs", async () => {
  const result = await runArgocd([
    "sync",
    "apps",
    "--request-id",
    CURRENT_REQUEST_ID,
    "--dry-run",
  ]);

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("--request-id requires an exact --revision");
});

test("Argo CLI rejects malformed request IDs", async () => {
  const result = await runArgocd([
    "sync",
    "apps",
    "--revision",
    REVISION,
    "--terminate-after-applied",
    "--request-id",
    "not-a-uuid",
    "--dry-run",
  ]);

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("Invalid UUID");
});
