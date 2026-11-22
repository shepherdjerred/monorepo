import { expect, test, vi } from "vitest";
import { z } from "zod";
import { flagDeployments, type FlagDeployment } from "./deployments.ts";
import type { FlagValue } from "./evaluate.ts";
import {
  compareDeploymentFlags,
  createFlagsMachineFetcher,
  fetchFlagsDeploymentSnapshot,
  FlagsValueSchema,
  formatDeploymentFlagDrift,
  selectFlagDeployments,
  type FlagsHttpFetcher,
} from "./flags-drift.ts";
import {
  applyDeclaredDeploymentFlags,
  applyMissingDeploymentFlags,
  applyRetiredDeploymentFlags,
} from "./flags-reconcile.ts";
import {
  managedFlagInventory,
  ManagedFlagInventorySchema,
} from "./managed-flag-inventory.ts";
import { projectDeploymentFlags } from "./project-deployment.ts";

const RetireBodySchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  keys: z.array(z.string().min(1)).min(1),
});

const CreateMissingBodySchema = z.strictObject({
  flags: z.array(FlagsValueSchema).min(1),
});

const ApplyBodySchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  flags: z.array(FlagsValueSchema).min(1),
});

type StoredDoc = { revision: number; flags: FlagValue[] };
type FakeServerOptions = {
  readonly deployments?: readonly FlagDeployment[];
  readonly retireConflicts?: number;
  readonly keepRetired?: boolean;
  readonly applyConflict?: boolean;
  readonly corruptReadback?: boolean;
};

function requestUrl(input: string | Request | URL): URL {
  if (typeof input === "string") return new URL(input);
  return input instanceof URL ? input : new URL(input.url);
}

function handleRetire(
  doc: StoredDoc,
  rawBody: unknown,
  state: { retireConflicts: number; keepRetired: boolean },
): Response {
  const body = RetireBodySchema.parse(rawBody);
  if (state.retireConflicts > 0) {
    state.retireConflicts -= 1;
    doc.revision += 1;
    return Response.json(
      { error: "revision conflict", revision: doc.revision, flags: doc.flags },
      { status: 409 },
    );
  }
  if (body.expectedRevision !== doc.revision) {
    return Response.json(
      { error: "revision conflict", revision: doc.revision, flags: doc.flags },
      { status: 409 },
    );
  }
  const present = new Set(doc.flags.map((f) => f.key));
  const missing = body.keys.filter((k) => !present.has(k));
  if (missing.length > 0) {
    return Response.json({ error: "retire refused", missing }, { status: 409 });
  }
  if (!state.keepRetired) {
    doc.flags = doc.flags.filter((f) => !body.keys.includes(f.key));
  }
  doc.revision += 1;
  return Response.json({ revision: doc.revision });
}

function handleCreateMissing(doc: StoredDoc, rawBody: unknown): Response {
  const body = CreateMissingBodySchema.parse(rawBody);
  const present = new Set(doc.flags.map((f) => f.key));
  const created: string[] = [];
  for (const flag of body.flags) {
    if (present.has(flag.key)) continue;
    doc.flags.push(flag);
    created.push(flag.key);
  }
  if (created.length > 0) doc.revision += 1;
  return Response.json({ revision: doc.revision, created });
}

function handleApply(
  doc: StoredDoc,
  rawBody: unknown,
  options?: FakeServerOptions,
): Response {
  const body = ApplyBodySchema.parse(rawBody);
  if (
    options?.applyConflict === true ||
    body.expectedRevision !== doc.revision
  ) {
    return Response.json(
      { error: "revision conflict", revision: doc.revision, flags: doc.flags },
      { status: 409 },
    );
  }
  for (const updated of body.flags) {
    const nextValue: FlagValue =
      options?.corruptReadback === true && updated.type === "boolean"
        ? { ...updated, default: !updated.default }
        : updated;
    const existingIndex = doc.flags.findIndex((f) => f.key === updated.key);
    if (existingIndex === -1) {
      doc.flags.push(nextValue);
    } else {
      doc.flags[existingIndex] = nextValue;
    }
  }
  doc.revision += 1;
  return Response.json({ revision: doc.revision });
}

function handleSnapshot(
  store: ReadonlyMap<string, StoredDoc>,
  id: string,
  auth: string | null,
): Response {
  if (auth !== null) {
    return Response.json(
      { error: "evaluation does not accept credentials" },
      { status: 401 },
    );
  }
  const doc = store.get(id);
  return doc === undefined
    ? Response.json({ error: "unknown deployment" }, { status: 404 })
    : Response.json({
        deployment: id,
        revision: doc.revision,
        flags: doc.flags,
      });
}

function dispatchManagementRoute(input: {
  readonly store: ReadonlyMap<string, StoredDoc>;
  readonly pathname: string;
  readonly method: string;
  readonly rawBody: unknown;
  readonly state: { retireConflicts: number; keepRetired: boolean };
  readonly options?: FakeServerOptions | undefined;
}): Response {
  const docMatch =
    /^\/v1\/deployments\/([^/]+)\/([^/]+)(?:\/(retire|create-missing|apply))?$/u.exec(
      input.pathname,
    );
  if (docMatch === null) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const id = `${decodeURIComponent(docMatch[1] ?? "")}/${decodeURIComponent(docMatch[2] ?? "")}`;
  const doc = input.store.get(id);
  if (doc === undefined) {
    return Response.json({ error: "unknown deployment" }, { status: 404 });
  }
  const action = docMatch[3];
  if (action === undefined && input.method === "GET") {
    return Response.json({ id, revision: doc.revision, flags: doc.flags });
  }
  if (input.method !== "POST") {
    return Response.json({ error: "unsupported" }, { status: 405 });
  }
  if (action === "retire") return handleRetire(doc, input.rawBody, input.state);
  if (action === "create-missing") {
    return handleCreateMissing(doc, input.rawBody);
  }
  return action === "apply"
    ? handleApply(doc, input.rawBody, input.options)
    : Response.json({ error: "unsupported" }, { status: 405 });
}

function createFakeFlagsServer(options?: FakeServerOptions) {
  const deployments = options?.deployments ?? flagDeployments;
  const state = {
    retireConflicts: options?.retireConflicts ?? 0,
    keepRetired: options?.keepRetired ?? false,
  };
  const store = new Map<string, StoredDoc>(
    deployments.map((deployment) => [
      deployment.id,
      { revision: 1, flags: projectDeploymentFlags(deployment) },
    ]),
  );
  const calls: { method: string; path: string; auth: string | null }[] = [];

  const handler: FlagsHttpFetcher = (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = requestUrl(input);
    const method = init?.method ?? request?.method ?? "GET";
    const headers = new Headers(request?.headers);
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
    const auth = headers.get("authorization");
    calls.push({ method, path: url.pathname, auth });

    const snapshotMatch =
      /^\/v1\/deployments\/([^/]+)\/([^/]+)\/snapshot$/u.exec(url.pathname);
    if (method === "GET" && snapshotMatch !== null) {
      const id = `${decodeURIComponent(snapshotMatch[1] ?? "")}/${decodeURIComponent(snapshotMatch[2] ?? "")}`;
      return Promise.resolve(handleSnapshot(store, id, auth));
    }
    if (auth !== "Bearer test-machine-token") {
      return Promise.resolve(
        Response.json({ error: "invalid machine credential" }, { status: 401 }),
      );
    }
    const rawBody: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    return Promise.resolve(
      dispatchManagementRoute({
        store,
        pathname: url.pathname,
        method,
        rawBody,
        state,
        options,
      }),
    );
  };

  return { store, calls, handler };
}

test("machine fetcher requires a token and enforces same-origin", () => {
  expect(() =>
    createFlagsMachineFetcher("https://flags.example.test", ""),
  ).toThrow(/FLAGS_MACHINE_TOKEN is required/);
  const fetcher = createFlagsMachineFetcher(
    "https://flags.example.test",
    "test-machine-token",
    () => Promise.resolve(Response.json({ ok: true })),
  );
  expect(() => fetcher("https://evil.example.test/v1/diff")).toThrow(
    /changed origin/,
  );
});

test("snapshot reads stay credentialless, resolve minecraft/tsmc route, and detect drift", async () => {
  const scoutProd = selectFlagDeployments({
    deploymentFilter: "scout/prod",
  })[0];
  const tsmc = selectFlagDeployments({ deploymentFilter: "minecraft/tsmc" })[0];
  if (scoutProd === undefined || tsmc === undefined) {
    throw new Error("expected deployments missing");
  }
  const server = createFakeFlagsServer({ deployments: [scoutProd, tsmc] });
  const tsmcSnapshot = await fetchFlagsDeploymentSnapshot({
    url: "https://flags.example.test",
    deployment: tsmc,
    fetcher: server.handler,
  });
  expect(tsmcSnapshot.deployment).toBe("minecraft/tsmc");
  expect(server.calls[0]).toEqual({
    method: "GET",
    path: "/v1/deployments/minecraft/tsmc/snapshot",
    auth: null,
  });

  const snapshot = await fetchFlagsDeploymentSnapshot({
    url: "https://flags.example.test",
    deployment: scoutProd,
    fetcher: server.handler,
  });
  expect(snapshot.deployment).toBe("scout/prod");
  expect(
    formatDeploymentFlagDrift(
      compareDeploymentFlags(snapshot.flags, projectDeploymentFlags(scoutProd)),
    ),
  ).toEqual([]);

  const drifted = compareDeploymentFlags(
    [
      ...snapshot.flags.filter((f) => f.key !== "dares_enabled"),
      { type: "boolean", key: "extra-manual", default: true, rollouts: [] },
    ],
    projectDeploymentFlags(scoutProd),
  );
  expect(formatDeploymentFlagDrift(drifted)).toEqual([
    "declared keys missing from Flags: dares_enabled",
    "Flags keys absent from the inventory: extra-manual",
  ]);
});

test("retires only present retired keys with readback and skips absent keys", async () => {
  const scoutBeta = selectFlagDeployments({
    deploymentFilter: "scout/beta",
  })[0];
  if (scoutBeta === undefined) throw new Error("scout/beta missing");
  const server = createFakeFlagsServer({
    deployments: [scoutBeta],
    retireConflicts: 1,
  });
  server.store.get("scout/beta")?.flags.push({
    type: "boolean",
    key: "ai_reviews_enabled",
    default: false,
    rollouts: [],
  });
  const fetcher = createFlagsMachineFetcher(
    "https://flags.example.test",
    "test-machine-token",
    server.handler,
  );

  const first = await applyRetiredDeploymentFlags({
    url: "https://flags.example.test",
    fetcher,
    deployments: [scoutBeta],
  });
  expect(first).toEqual([
    { deployment: "scout/beta", retiredFlags: ["ai_reviews_enabled"] },
  ]);

  const callsBeforeSecond = server.calls.length;
  const second = await applyRetiredDeploymentFlags({
    url: "https://flags.example.test",
    fetcher,
    deployments: [scoutBeta],
  });
  expect(second).toEqual([{ deployment: "scout/beta", retiredFlags: [] }]);
  expect(
    server.calls
      .slice(callsBeforeSecond)
      .some((call) => call.path.endsWith("/retire")),
  ).toBe(false);
});

test("refuses retirement before I/O when a retired key re-enters managed inventory", async () => {
  const template = managedFlagInventory.flags[0];
  if (template === undefined) throw new Error("empty inventory");
  const corrupted = ManagedFlagInventorySchema.parse({
    ...managedFlagInventory,
    flags: [
      ...managedFlagInventory.flags,
      { ...template, namespace: "scout", key: "ai_reviews_enabled" },
    ],
  });
  const fetcher = vi.fn();
  await expect(
    applyRetiredDeploymentFlags({
      url: "https://flags.example.test",
      fetcher,
      inventory: corrupted,
    }),
  ).rejects.toThrow(/Refusing to retire managed flag/);
  expect(fetcher).not.toHaveBeenCalled();
});

test("fails retirement if readback still shows the retired key", async () => {
  const scoutBeta = selectFlagDeployments({
    deploymentFilter: "scout/beta",
  })[0];
  if (scoutBeta === undefined) throw new Error("scout/beta missing");
  const server = createFakeFlagsServer({
    deployments: [scoutBeta],
    keepRetired: true,
  });
  server.store.get("scout/beta")?.flags.push({
    type: "boolean",
    key: "ai_reviews_enabled",
    default: false,
    rollouts: [],
  });
  const fetcher = createFlagsMachineFetcher(
    "https://flags.example.test",
    "test-machine-token",
    server.handler,
  );
  await expect(
    applyRetiredDeploymentFlags({
      url: "https://flags.example.test",
      fetcher,
      deployments: [scoutBeta],
    }),
  ).rejects.toThrow(/still present/);
});

test("create-missing inserts absent keys without overwriting existing targeting", async () => {
  const birmel = selectFlagDeployments({ deploymentFilter: "birmel/prod" })[0];
  if (birmel === undefined) throw new Error("birmel/prod missing");
  const server = createFakeFlagsServer({ deployments: [birmel] });
  const doc = server.store.get("birmel/prod");
  const firstFlag = doc?.flags[0];
  if (doc === undefined || firstFlag?.type !== "boolean") {
    throw new Error("expected birmel boolean flag");
  }
  doc.flags = [{ ...firstFlag, default: !firstFlag.default }];
  const fetcher = createFlagsMachineFetcher(
    "https://flags.example.test",
    "test-machine-token",
    server.handler,
  );

  const created = await applyMissingDeploymentFlags({
    url: "https://flags.example.test",
    fetcher,
    deployments: [birmel],
  });
  expect(created[0]?.createdFlags.length).toBeGreaterThan(0);
  expect(doc.flags.find((f) => f.key === firstFlag.key)).toMatchObject({
    default: !firstFlag.default,
  });
});

test("plan and apply declared flags verify revisions and post-write readback", async () => {
  const scoutProd = selectFlagDeployments({
    deploymentFilter: "scout/prod",
  })[0];
  if (scoutProd === undefined) throw new Error("scout/prod missing");
  const server = createFakeFlagsServer({ deployments: [scoutProd] });
  const doc = server.store.get("scout/prod");
  if (doc === undefined) throw new Error("missing scout/prod");
  doc.flags = doc.flags.map((flag) =>
    flag.key === "dares_enabled" && flag.type === "boolean"
      ? { ...flag, default: true }
      : flag,
  );

  const planned = await applyDeclaredDeploymentFlags({
    url: "https://flags.example.test",
    deployment: scoutProd,
    flagKeys: ["dares_enabled"],
    mode: "plan",
    snapshotFetcher: server.handler,
  });
  expect(planned.changes[0]?.status).toBe("planned");

  const fetcher = createFlagsMachineFetcher(
    "https://flags.example.test",
    "test-machine-token",
    server.handler,
  );
  const applied = await applyDeclaredDeploymentFlags({
    url: "https://flags.example.test",
    deployment: scoutProd,
    flagKeys: ["dares_enabled"],
    mode: "apply",
    fetcher,
  });
  expect(applied.changes[0]?.status).toBe("applied");
  expect(applied.changes[0]?.revisionAfter).toBe(2);

  const targetKey =
    projectDeploymentFlags(scoutProd)[0]?.key ?? "dares_enabled";
  const conflictedServer = createFakeFlagsServer({
    deployments: [scoutProd],
    applyConflict: true,
  });
  conflictedServer.store.get("scout/prod")?.flags.splice(0, 1);
  const conflicted = await applyDeclaredDeploymentFlags({
    url: "https://flags.example.test",
    deployment: scoutProd,
    flagKeys: [targetKey],
    mode: "apply",
    fetcher: createFlagsMachineFetcher(
      "https://flags.example.test",
      "test-machine-token",
      conflictedServer.handler,
    ),
  });
  expect(conflicted.changes[0]?.status).toBe("conflict");

  const corruptServer = createFakeFlagsServer({
    deployments: [scoutProd],
    corruptReadback: true,
  });
  corruptServer.store.get("scout/prod")?.flags.splice(0, 1);
  const corrupted = await applyDeclaredDeploymentFlags({
    url: "https://flags.example.test",
    deployment: scoutProd,
    flagKeys: [targetKey],
    mode: "apply",
    fetcher: createFlagsMachineFetcher(
      "https://flags.example.test",
      "test-machine-token",
      corruptServer.handler,
    ),
  });
  expect(corrupted.changes[0]?.status).toBe("failed");
  expect(corrupted.changes[0]?.error).toContain("readback differs");
});
