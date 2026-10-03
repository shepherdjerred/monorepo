import { expect, test, vi } from "vitest";
import {
  managedFlagInventory,
  ManagedFlagInventorySchema,
} from "./managed-flag-inventory.ts";
import { applyRetiredManagedFlags } from "./flipt-retired-flag-apply.ts";
import { retiredFlagDeclarations } from "./retired-flag-declarations.ts";
import type { FliptFetcher } from "./managed-flag-drift.ts";

const retiredKeys = retiredFlagDeclarations.map(
  (declaration) => declaration.key,
);
const retiredKeysIn = (environment: string) =>
  retiredFlagDeclarations
    .filter((declaration) => declaration.environment === environment)
    .map((declaration) => declaration.key);
const betaRetiredKeys = retiredKeysIn("beta");
const prodRetiredKeys = retiredKeysIn("prod");
const firstRetired = betaRetiredKeys[0];
if (firstRetired === undefined) throw new Error("No retired flag declared");

const wrongNamespace: FliptFetcher = async () =>
  Response.json({
    resources: [{ namespaceKey: "home", key: firstRetired }],
    revision: "rev-0",
  });

function fakeServer(
  options: {
    absent?: boolean;
    conflicts?: number;
    error?: { status: number; code: number };
    concurrentRemoval?: boolean;
    keepDeleted?: boolean;
  } = {},
) {
  // One flag set per Flipt environment, as the real server keeps them.
  const environments = new Map<string, Map<string, unknown>>([
    [
      "beta",
      new Map<string, unknown>([
        [
          "dare_notifications_enabled",
          { enabled: false, rollouts: [{ guild: "test", result: true }] },
        ],
        ["unrelated-unknown", { enabled: true }],
      ]),
    ],
    ["prod", new Map<string, unknown>()],
  ]);
  if (!options.absent) {
    for (const declaration of retiredFlagDeclarations) {
      environments
        .get(declaration.environment)
        ?.set(declaration.key, { enabled: true });
    }
  }
  const flagsIn = (url: URL): Map<string, unknown> => {
    const match =
      /^\/api\/v2\/environments\/(beta|prod)\/namespaces\/scout\/resources\/flipt\.core\.Flag/u.exec(
        url.pathname,
      );
    const environment = match?.[1];
    const flags =
      environment === undefined ? undefined : environments.get(environment);
    if (flags === undefined) throw new Error(`Unexpected path ${url.pathname}`);
    return flags;
  };
  const flags = environments.get("beta") ?? new Map<string, unknown>();
  let revision = 0;
  let conflicts = options.conflicts ?? 0;
  const requests: { method: string; url: URL }[] = [];
  const fetcher: FliptFetcher = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const method = init?.method ?? "GET";
    requests.push({ method, url });
    const environmentFlags = flagsIn(url);
    if (method === "GET") {
      return Response.json({
        resources: [...environmentFlags].map(([key, payload]) => ({
          namespaceKey: "scout",
          key,
          payload,
        })),
        revision: `rev-${String(revision)}`,
      });
    }
    if (method !== "DELETE") throw new Error(`Unexpected ${method} mutation`);
    expect(url.searchParams.get("revision")).toBe(`rev-${String(revision)}`);
    if (conflicts > 0) {
      conflicts -= 1;
      revision += 1;
      return Response.json(
        { code: 10, message: "revision changed" },
        { status: 409 },
      );
    }
    if (options.error !== undefined) {
      return Response.json(
        { code: options.error.code, message: "request refused" },
        { status: options.error.status },
      );
    }
    const key = url.pathname.split("/").at(-1);
    if (key === undefined) throw new Error("DELETE key is missing");
    if (!options.keepDeleted) environmentFlags.delete(key);
    revision += 1;
    return key === firstRetired && options.concurrentRemoval
      ? Response.json(
          { code: 5, message: "removed concurrently" },
          { status: 404 },
        )
      : Response.json({ revision: `rev-${String(revision)}` });
  };
  return { flags, environments, requests, fetcher };
}

test("only the declared keys are retired, per environment, preserving managed targeting and other unknowns", async () => {
  // The declarations are the source of truth; this pins only their shape:
  // Scout keys, each retired at most once per environment, and the two V2
  // ownership switches retired everywhere the inventory declared them.
  expect(
    retiredFlagDeclarations.every(
      (declaration) => declaration.namespace === "scout",
    ),
  ).toBe(true);
  expect(
    new Set(
      retiredFlagDeclarations.map(
        (declaration) => `${declaration.environment}/${declaration.key}`,
      ),
    ).size,
  ).toBe(retiredFlagDeclarations.length);
  expect(prodRetiredKeys.toSorted()).toEqual([
    "scout_v2_postmatch_ownership_enabled",
    "scout_v2_prematch_ownership_enabled",
  ]);
  expect(betaRetiredKeys).toEqual(expect.arrayContaining(prodRetiredKeys));
  const server = fakeServer();
  const managedBefore = structuredClone(
    server.flags.get("dare_notifications_enabled"),
  );
  expect(
    await applyRetiredManagedFlags({
      url: "https://flipt.example/",
      fetcher: server.fetcher,
    }),
  ).toEqual([
    { environment: "beta", namespace: "scout", retiredFlags: betaRetiredKeys },
    { environment: "prod", namespace: "scout", retiredFlags: prodRetiredKeys },
  ]);
  expect([...server.flags.keys()]).toEqual([
    "dare_notifications_enabled",
    "unrelated-unknown",
  ]);
  expect(server.flags.get("dare_notifications_enabled")).toEqual(managedBefore);
  expect([...(server.environments.get("prod")?.keys() ?? [])]).toEqual([]);
  expect(
    server.requests
      .filter((request) => request.method === "DELETE")
      .map((request) => request.url.pathname.split("/").at(-1)),
  ).toEqual(retiredKeys);
  expect(
    await applyRetiredManagedFlags({
      url: "https://flipt.example",
      fetcher: server.fetcher,
    }),
  ).toEqual([
    { environment: "beta", namespace: "scout", retiredFlags: [] },
    { environment: "prod", namespace: "scout", retiredFlags: [] },
  ]);
  expect(
    server.requests.filter((request) => request.method === "DELETE"),
  ).toHaveLength(retiredFlagDeclarations.length);
});

test("absence is already settled and never creates an environment, namespace, or flag", async () => {
  const server = fakeServer({ absent: true });
  expect(
    await applyRetiredManagedFlags({
      url: "https://flipt.example",
      fetcher: server.fetcher,
    }),
  ).toEqual([
    { environment: "beta", namespace: "scout", retiredFlags: [] },
    { environment: "prod", namespace: "scout", retiredFlags: [] },
  ]);
  expect(server.requests.every((request) => request.method === "GET")).toBe(
    true,
  );
});

test("reintroducing a retired key as managed refuses all I/O before deletion", async () => {
  const template = managedFlagInventory.flags[0];
  if (template === undefined) throw new Error("Managed inventory is empty");
  const inventory = ManagedFlagInventorySchema.parse({
    ...managedFlagInventory,
    flags: [
      ...managedFlagInventory.flags,
      { ...template, namespace: "scout", key: firstRetired },
    ],
  });
  const fetcher = vi.fn();
  await expect(
    applyRetiredManagedFlags({
      url: "https://flipt.example",
      inventory,
      fetcher,
    }),
  ).rejects.toThrow("Refusing to retire managed flag beta/scout/");
  expect(fetcher).not.toHaveBeenCalled();
});

test("a revision conflict refreshes the list before one bounded retry", async () => {
  const server = fakeServer({ conflicts: 1 });
  await applyRetiredManagedFlags({
    url: "https://flipt.example",
    fetcher: server.fetcher,
  });
  const deletes = server.requests.filter(
    (request) => request.method === "DELETE",
  );
  expect(deletes).toHaveLength(retiredFlagDeclarations.length + 1);
  expect(deletes[0]?.url.searchParams.get("revision")).toBe("rev-0");
  expect(deletes[1]?.url.searchParams.get("revision")).toBe("rev-1");
});

test("repeated revision conflicts stop after three attempts", async () => {
  const server = fakeServer({ conflicts: 10 });
  await expect(
    applyRetiredManagedFlags({
      url: "https://flipt.example",
      fetcher: server.fetcher,
    }),
  ).rejects.toThrow("revision conflict after 3 attempts");
  expect(
    server.requests.filter((request) => request.method === "DELETE"),
  ).toHaveLength(3);
  expect(server.flags.has(firstRetired)).toBe(true);
});

test.each([
  { status: 403, code: 7 },
  { status: 409, code: 6 },
])("unrelated errors are propagated without retry (%j)", async (error) => {
  const server = fakeServer({ error });
  await expect(
    applyRetiredManagedFlags({
      url: "https://flipt.example",
      fetcher: server.fetcher,
    }),
  ).rejects.toThrow(`HTTP ${String(error.status)} code ${String(error.code)}`);
  expect(
    server.requests.filter((request) => request.method === "DELETE"),
  ).toHaveLength(1);
});

test("a concurrent removal is verified before reporting settlement", async () => {
  const server = fakeServer({ concurrentRemoval: true });
  const result = await applyRetiredManagedFlags({
    url: "https://flipt.example",
    fetcher: server.fetcher,
  });
  expect(result[0]?.retiredFlags).toEqual(betaRetiredKeys.slice(1));
  expect(server.flags.has(firstRetired)).toBe(false);
});

test("a successful DELETE that leaves the target present fails verification", async () => {
  const server = fakeServer({ keepDeleted: true });
  await expect(
    applyRetiredManagedFlags({
      url: "https://flipt.example",
      fetcher: server.fetcher,
    }),
  ).rejects.toThrow("retired flag is still present");
  expect(
    server.requests.filter((request) => request.method === "DELETE"),
  ).toHaveLength(1);
});

test("malformed namespace data and transport failures cannot be treated as absent targets", async () => {
  await expect(
    applyRetiredManagedFlags({
      url: "https://flipt.example",
      fetcher: wrongNamespace,
    }),
  ).rejects.toThrow("outside the retirement namespace");
  const failure = new Error("connection lost");
  const fetcher: FliptFetcher = async () => {
    throw failure;
  };
  await expect(
    applyRetiredManagedFlags({ url: "https://flipt.example", fetcher }),
  ).rejects.toBe(failure);
});
