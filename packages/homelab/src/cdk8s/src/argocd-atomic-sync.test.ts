import { expect, test } from "vitest";
import path from "node:path";
import { z } from "zod";

const CURRENT_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const CURRENT_OPERATION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_OPERATION_ID = "44444444-4444-4444-8444-444444444444";
const REVISION = "2.0.0-42";

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

const RootSyncRequestSchema = z.object({
  infos: z.array(SyncInfoEntrySchema),
  prune: z.boolean(),
  revision: z.string(),
});

type OperationResource = {
  readonly group?: string;
  readonly hookPhase?: string;
  readonly hookType?: string;
  readonly kind?: string;
  readonly name?: string;
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

function identifiedOperation(
  requestId: string,
  revision = REVISION,
  operationId: string | null = CURRENT_OPERATION_ID,
  options: {
    readonly persistedRevision?: string;
    readonly extraInfo?: readonly {
      readonly name: string;
      readonly value: string;
    }[];
  } = {},
): unknown {
  const { persistedRevision, extraInfo = [] } = options;
  return {
    info: [
      ...extraInfo,
      {
        name: "ci.sjer.red/request-id",
        value: requestId,
      },
      ...(operationId === null
        ? []
        : [
            {
              name: "ci.sjer.red/operation-id",
              value: operationId,
            },
          ]),
      ...(persistedRevision === undefined
        ? []
        : [
            {
              name: "ci.sjer.red/revision",
              value: persistedRevision,
            },
          ]),
    ],
    // Every sync in this file posts `--prune`, and Argo records
    // `operation.sync.prune` only when it is true (`prune,omitempty`), so a
    // live operation for these requests carries it. Omitting it made the
    // fixture describe an operation that did not match the request the test
    // itself posted.
    sync: { prune: true, revision },
  };
}

function applicationOperation(options: {
  readonly live?: boolean;
  readonly liveOperationId?: string | null;
  readonly message?: string;
  readonly operationId?: string | null;
  readonly persistedRevision?: string;
  readonly phase: string;
  readonly requestId: string;
  readonly resources?: readonly OperationResource[];
  readonly revision?: string;
  readonly startedAt?: string;
  readonly trackedResources?: readonly {
    readonly group?: string;
    readonly kind: string;
    readonly name: string;
  }[];
  readonly extraInfo?: readonly {
    readonly name: string;
    readonly value: string;
  }[];
}): unknown {
  const revision = options.revision ?? REVISION;
  const operationId =
    options.operationId === undefined
      ? CURRENT_OPERATION_ID
      : options.operationId;
  const liveOperationId =
    options.liveOperationId === undefined
      ? operationId
      : options.liveOperationId;
  const identity = {
    persistedRevision: options.persistedRevision,
    extraInfo: options.extraInfo,
  };
  const completedOperation = identifiedOperation(
    options.requestId,
    revision,
    operationId,
    identity,
  );
  const liveOperation = identifiedOperation(
    options.requestId,
    revision,
    liveOperationId,
    identity,
  );
  const live =
    options.live ??
    (options.phase === "Running" || options.phase === "Terminating");
  return {
    ...(live ? { operation: liveOperation } : {}),
    status: {
      ...(options.trackedResources === undefined
        ? {}
        : { resources: options.trackedResources }),
      operationState: {
        phase: options.phase,
        operation: completedOperation,
        syncResult: {
          revision,
          resources: (options.resources ?? []).map((resource, index) => ({
            group: resource.group ?? "argoproj.io",
            kind: resource.kind ?? "Application",
            name:
              resource.name ??
              (index === 0 ? "worker" : `resource-${index.toString()}`),
            ...resource,
          })),
        },
        ...(options.startedAt === undefined
          ? {}
          : { startedAt: options.startedAt }),
        ...(options.message === undefined ? {} : { message: options.message }),
      },
    },
  };
}

function renderedApplication(name: string): string {
  return JSON.stringify({
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: { name, namespace: "argocd" },
    spec: {
      source: {
        repoURL: "https://charts.example.test",
        targetRevision: REVISION,
      },
    },
  });
}

const DEFAULT_RENDERED_MANIFESTS = [renderedApplication("worker")];

function fixtureAt(fixtures: readonly unknown[], index: number): unknown {
  const fixture = fixtures[Math.min(index, fixtures.length - 1)];
  if (fixture === undefined) {
    throw new Error("Lifecycle fixture list must not be empty");
  }
  return fixture;
}

function withPostedOperationId(
  fixture: unknown,
  postedOperationId: string | undefined,
): unknown {
  if (postedOperationId === undefined) {
    return fixture;
  }
  const serialized = JSON.stringify(fixture);
  if (serialized === undefined) {
    throw new Error("Lifecycle fixture must be JSON serializable");
  }
  return JSON.parse(
    serialized.replaceAll(CURRENT_OPERATION_ID, postedOperationId),
  );
}

function requestOperationId(request: unknown): string {
  const syncRequest = RootSyncRequestSchema.parse(request);
  const matches = syncRequest.infos.filter(
    ({ name }) => name === "ci.sjer.red/operation-id",
  );
  if (matches.length !== 1) {
    throw new Error("Sync request must contain one operation ID");
  }
  const operationId = matches[0]?.value;
  if (operationId === undefined) {
    throw new Error("Sync request operation ID is missing");
  }
  return operationId;
}

function serveLifecycle(
  beforeDelete: readonly unknown[],
  afterDelete: readonly unknown[] = [{ status: {} }],
  renderedManifests: readonly string[] = DEFAULT_RENDERED_MANIFESTS,
  prunableChildren: readonly string[] = [],
) {
  const observations: LifecycleObservations = {
    deleteRequests: 0,
    postDeleteGets: 0,
    statusGets: 0,
    syncPosts: 0,
  };
  let postedOperationId: string | undefined;
  let terminated = false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (
        request.method === "GET" &&
        url.pathname === "/api/v1/applications/apps/manifests"
      ) {
        return Response.json({ manifests: renderedManifests });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/applications/apps/sync"
      ) {
        observations.syncPosts += 1;
        const body: unknown = await request.json();
        postedOperationId = requestOperationId(body);
        return Response.json(operationResponse(body));
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
          return Response.json(
            withPostedOperationId(fixture, postedOperationId),
          );
        }
        const fixture = fixtureAt(beforeDelete, observations.statusGets);
        observations.statusGets += 1;
        return Response.json(withPostedOperationId(fixture, postedOperationId));
      }
      const childName = decodeURIComponent(
        url.pathname.slice("/api/v1/applications/".length),
      );
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/v1/applications/") &&
        prunableChildren.includes(childName)
      ) {
        return Response.json({
          metadata: {
            annotations: {
              "ci.sjer.red/application-lifecycle": "cascade",
            },
            finalizers: ["resources-finalizer.argocd.argoproj.io"],
            name: childName,
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { observations, server };
}

async function runArgocd(
  args: readonly string[],
  serverOrigin = "http://127.0.0.1:1",
  options: { readonly pollIntervalMs?: string | null } = {},
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const env = {
    ...Object.fromEntries(
      Object.entries(Bun.env).filter(
        ([name]) => name !== "ARGOCD_POLL_INTERVAL_MS",
      ),
    ),
    ...(options.pollIntervalMs === null
      ? {}
      : { ARGOCD_POLL_INTERVAL_MS: options.pollIntervalMs ?? "5" }),
    ARGOCD_SERVER_URL: serverOrigin,
    ARGOCD_TOKEN: "test-token",
  };
  const process = Bun.spawn(
    ["bun", "--no-install", "scripts/argocd.ts", ...args],
    {
      cwd: path.resolve(import.meta.dir, "../../.."),
      env,
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
    "--prune",
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
  const desiredNames = Array.from(
    { length: 255 },
    (_, index) => `application-${index.toString()}`,
  );
  const resources: OperationResource[] = [
    ...desiredNames.map((name, index) => ({
      name,
      status: "Synced",
      ...(index < 5 ? { hookPhase: "Running" } : {}),
    })),
    { name: "removed-one", status: "Pruned" },
    { name: "removed-two", status: "Pruned" },
  ];
  const stale = applicationOperation({
    operationId: OTHER_OPERATION_ID,
    phase: "Succeeded",
    requestId: CURRENT_REQUEST_ID,
    resources: [{ status: "Synced" }],
    startedAt: "2026-08-10T01:00:00Z",
    trackedResources: [
      { group: "argoproj.io", kind: "Application", name: "removed-one" },
      { group: "argoproj.io", kind: "Application", name: "removed-two" },
    ],
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
    desiredNames.map((name) => renderedApplication(name)),
    ["removed-one", "removed-two"],
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

test("atomic Argo sync waits for every rendered resource across sync waves", async () => {
  const firstWave = applicationOperation({
    phase: "Running",
    requestId: CURRENT_REQUEST_ID,
    resources: [{ name: "wave-zero", status: "Synced" }],
    startedAt: "2026-08-10T01:00:01Z",
  });
  const allWaves = applicationOperation({
    phase: "Running",
    requestId: CURRENT_REQUEST_ID,
    resources: [
      { name: "wave-zero", status: "Synced" },
      { name: "wave-three", status: "Synced" },
    ],
    startedAt: "2026-08-10T01:00:01Z",
  });
  const lifecycle = serveLifecycle(
    [{ status: {} }, firstWave, allWaves],
    [{ status: {} }],
    [renderedApplication("wave-zero"), renderedApplication("wave-three")],
  );

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(lifecycle.observations.deleteRequests).toBe(1);
    expect(lifecycle.observations.statusGets).toBeGreaterThanOrEqual(3);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync waits for every validated prune candidate", async () => {
  const inventory = {
    status: {
      resources: [
        {
          group: "argoproj.io",
          kind: "Application",
          name: "removed-worker",
        },
      ],
    },
  };
  const desiredApplied = applicationOperation({
    phase: "Running",
    requestId: CURRENT_REQUEST_ID,
    resources: [{ name: "worker", status: "Synced" }],
    startedAt: "2026-08-10T01:00:01Z",
  });
  const pruneApplied = applicationOperation({
    phase: "Running",
    requestId: CURRENT_REQUEST_ID,
    resources: [
      { name: "worker", status: "Synced" },
      { name: "removed-worker", status: "Pruned" },
    ],
    startedAt: "2026-08-10T01:00:01Z",
  });
  const lifecycle = serveLifecycle(
    [inventory, { status: {} }, desiredApplied, pruneApplied],
    [{ status: {} }],
    DEFAULT_RENDERED_MANIFESTS,
    ["removed-worker"],
  );

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(lifecycle.observations.deleteRequests).toBe(1);
    expect(lifecycle.observations.statusGets).toBeGreaterThanOrEqual(4);
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

test("atomic Argo sync can finalize an applied degraded non-hook resource", async () => {
  const lifecycle = serveLifecycle([
    { status: {} },
    applicationOperation({
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced", hookPhase: "Failed" }],
    }),
  ]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("terminated applied sync operation: apps");
    expect(lifecycle.observations.deleteRequests).toBe(1);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync never finalizes a failed Argo hook", async () => {
  const lifecycle = serveLifecycle([
    { status: {} },
    applicationOperation({
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced", hookPhase: "Failed", hookType: "Sync" }],
    }),
  ]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("did not complete within 1s");
    expect(lifecycle.observations.deleteRequests).toBe(0);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync waits past matching stale status when adopting a retry", async () => {
  const stale = applicationOperation({
    live: true,
    liveOperationId: CURRENT_OPERATION_ID,
    operationId: OTHER_OPERATION_ID,
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

test("atomic Argo sync finalizes a stable applied operation when adopting a retry", async () => {
  const lifecycle = serveLifecycle([
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
    expect(result.stdout).toContain("terminated applied sync operation: apps");
    expect(lifecycle.observations.syncPosts).toBe(0);
    expect(lifecycle.observations.deleteRequests).toBe(1);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync refuses to adopt a pre-operation-ID sync", async () => {
  const lifecycle = serveLifecycle([
    applicationOperation({
      liveOperationId: null,
      operationId: null,
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced" }],
    }),
  ]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "Refusing active apps operation without a CI operation ID",
    );
    expect(lifecycle.observations.deleteRequests).toBe(0);
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
  const terminating = applicationOperation({
    phase: "Terminating",
    requestId: CURRENT_REQUEST_ID,
    resources: [{ status: "Synced", hookPhase: "Running" }],
  });
  const lifecycle = serveLifecycle([terminating, terminating, { status: {} }]);

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

test("atomic Argo sync waits for naturally succeeded live state to clear", async () => {
  const succeededLive = applicationOperation({
    live: true,
    phase: "Succeeded",
    requestId: CURRENT_REQUEST_ID,
    resources: [{ status: "Synced" }],
    startedAt: "2026-08-10T01:00:01Z",
  });
  const succeededCleared = applicationOperation({
    live: false,
    phase: "Succeeded",
    requestId: CURRENT_REQUEST_ID,
    resources: [{ status: "Synced" }],
    startedAt: "2026-08-10T01:00:01Z",
  });
  const lifecycle = serveLifecycle([
    succeededLive,
    succeededLive,
    succeededLive,
    succeededCleared,
  ]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("synced: apps");
    expect(lifecycle.observations.deleteRequests).toBe(0);
    expect(lifecycle.observations.statusGets).toBeGreaterThanOrEqual(4);
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
    // An operation started before `ci.sjer.red/root-finalizer-phase` was
    // renamed. It carries an info key this code no longer writes, which the
    // loose info schema filters out rather than rejecting, so it is refused on
    // request identity like any other foreign operation — never on a parse
    // error, and never adopted. This is why `operationReleasePhase` needs no
    // fallback to the old name.
    name: "an operation carrying the superseded release-phase info key",
    requestId: OTHER_REQUEST_ID,
    revision: REVISION,
    extraInfo: [
      { name: "ci.sjer.red/root-finalizer-phase", value: "batch" },
    ] as const,
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
        ...("extraInfo" in scenario ? { extraInfo: scenario.extraInfo } : {}),
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

test("atomic Argo sync rejects disagreement between direct and persisted revisions", async () => {
  const lifecycle = serveLifecycle([
    applicationOperation({
      persistedRevision: "2.0.0-43",
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced" }],
    }),
  ]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Argo operation revision mismatch");
    expect(lifecycle.observations.deleteRequests).toBe(0);
  } finally {
    await lifecycle.server.stop(true);
  }
});

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

test("atomic Argo sync uses the default poll interval when its operation never becomes visible", async () => {
  const lifecycle = serveLifecycle([{ status: {} }]);

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin, {
      pollIntervalMs: null,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("did not complete within 1s");
    expect(result.stderr).not.toContain("ZodError");
    expect(lifecycle.observations.syncPosts).toBe(1);
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync accepts termination when live state clears before status", async () => {
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
        live: false,
        phase: "Running",
        requestId: CURRENT_REQUEST_ID,
        resources: [{ status: "Synced" }],
      }),
    ],
  );

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(lifecycle.observations.deleteRequests).toBe(1);
    expect(lifecycle.observations.postDeleteGets).toBe(1);
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
    expect(result.stderr).toContain("while waiting for request");
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
    expect(result.stderr).toContain("while waiting for request");
  } finally {
    await lifecycle.server.stop(true);
  }
});

test("atomic Argo sync fails if another attempt with the same request replaces it after DELETE", async () => {
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
        live: false,
        operationId: OTHER_OPERATION_ID,
        phase: "Succeeded",
        requestId: CURRENT_REQUEST_ID,
        resources: [{ status: "Synced" }],
        startedAt: "2026-08-10T01:00:02Z",
      }),
    ],
  );

  try {
    const result = await runArgocd(atomicArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("while waiting for request");
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

test("Argo recovery finalizes an exact pre-operation-ID sync", async () => {
  const lifecycle = serveLifecycle([
    applicationOperation({
      liveOperationId: null,
      operationId: null,
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced", hookPhase: "Running" }],
    }),
  ]);

  try {
    const result = await runArgocd(recoveryArgs(), lifecycle.server.url.origin);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("terminated applied sync operation: apps");
    expect(lifecycle.observations.deleteRequests).toBe(1);
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

test("Argo recovery waits past a stale attempt with the same request", async () => {
  const lifecycle = serveLifecycle([
    applicationOperation({
      live: true,
      liveOperationId: CURRENT_OPERATION_ID,
      operationId: OTHER_OPERATION_ID,
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced" }],
    }),
    applicationOperation({
      phase: "Running",
      requestId: CURRENT_REQUEST_ID,
      resources: [{ status: "Synced" }],
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
