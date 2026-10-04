import { expect, test, vi } from "vitest";
import {
  managedFlagInventory,
  ManagedFlagInventorySchema,
} from "./managed-flag-inventory.ts";
import { applyRetiredManagedFlags } from "./flipt-retired-flag-apply.ts";
import { retiredFlagDeclarations } from "./retired-flag-declarations.ts";
import type { FliptFetcher } from "./managed-flag-drift.ts";

const environments = ["beta", "prod"] as const;
type Environment = (typeof environments)[number];

const retiredKeys = retiredFlagDeclarations.map(
  (declaration) => declaration.key,
);
function retiredKeysIn(environment: Environment): string[] {
  return retiredFlagDeclarations
    .filter((declaration) => declaration.environment === environment)
    .map((declaration) => declaration.key);
}
const firstRetired = retiredKeys[0];
if (firstRetired === undefined) throw new Error("No retired flag declared");

const FLAG_RESOURCES_PATH =
  /^\/api\/v2\/environments\/(beta|prod)\/namespaces\/scout\/resources\/flipt\.core\.Flag/u;

function environmentOf(url: URL): Environment {
  const match = FLAG_RESOURCES_PATH.exec(url.pathname);
  const environment = environments.find(
    (candidate) => candidate === match?.[1],
  );
  if (environment === undefined) {
    throw new Error(`Unexpected Flipt path ${url.pathname}`);
  }
  return environment;
}

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
  const byEnvironment = new Map(
    environments.map((environment) => [
      environment,
      new Map<string, unknown>([
        [
          "dare_notifications_enabled",
          { enabled: false, rollouts: [{ guild: "test", result: true }] },
        ],
        ["unrelated-unknown", { enabled: true }],
        ...(options.absent
          ? []
          : retiredKeysIn(environment).map((key): [string, unknown] => [
              key,
              { enabled: true },
            ])),
      ]),
    ]),
  );
  function flagsIn(environment: Environment): Map<string, unknown> {
    const flags = byEnvironment.get(environment);
    if (flags === undefined) throw new Error(`No ${environment} flags`);
    return flags;
  }
  const flags = flagsIn("beta");
  let revision = 0;
  let conflicts = options.conflicts ?? 0;
  const requests: { method: string; url: URL }[] = [];
  const fetcher: FliptFetcher = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const method = init?.method ?? "GET";
    requests.push({ method, url });
    const environmentFlags = flagsIn(environmentOf(url));
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
  return { flags, flagsIn, requests, fetcher };
}

test("only the audited scout keys are retired, preserving managed targeting and other unknowns", async () => {
  expect(
    retiredFlagDeclarations.map(
      (declaration) =>
        `${declaration.environment}/${declaration.namespace}/${declaration.key}`,
    ),
  ).toEqual([
    "beta/scout/scout-tournament-api-mode",
    "beta/scout/scout-tournament-max-open-lobbies",
    "beta/scout/tournament_lobbies_enabled",
    "beta/scout/weekly_parlays_enabled",
    "beta/scout/scout_v2_progression_notifications_enabled",
    "beta/scout/competition_builder_v2_enabled",
    "prod/scout/scout_v2_progression_notifications_enabled",
    "prod/scout/competition_builder_v2_enabled",
    "beta/scout/dare_v2",
    "beta/scout/dare_extended_contracts_enabled",
    "beta/scout/scoutql_relational_enabled",
    "prod/scout/dare_v2",
    "prod/scout/dare_extended_contracts_enabled",
    "prod/scout/scoutql_relational_enabled",
  ]);
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
    {
      environment: "beta",
      namespace: "scout",
      retiredFlags: retiredKeysIn("beta"),
    },
    {
      environment: "prod",
      namespace: "scout",
      retiredFlags: retiredKeysIn("prod"),
    },
  ]);
  for (const environment of environments) {
    expect([...server.flagsIn(environment).keys()]).toEqual([
      "dare_notifications_enabled",
      "unrelated-unknown",
    ]);
  }
  expect(server.flags.get("dare_notifications_enabled")).toEqual(managedBefore);
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
  ).toHaveLength(retiredKeys.length);
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
  expect(deletes).toHaveLength(retiredKeys.length + 1);
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
  expect(result[0]?.retiredFlags).toEqual(retiredKeysIn("beta").slice(1));
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
