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
const retirementScopes = [
  { environment: "beta", namespace: "scout" },
  { environment: "prod", namespace: "scout" },
  { environment: "beta", namespace: "temporal" },
  { environment: "prod", namespace: "temporal" },
] as const;
const retiredKeys = retiredFlagDeclarations.map(
  (declaration) => declaration.key,
);
function retiredKeysIn(
  environment: Environment,
  namespace = "scout",
): string[] {
  return retiredFlagDeclarations
    .filter(
      (declaration) =>
        declaration.environment === environment &&
        declaration.namespace === namespace,
    )
    .map((declaration) => declaration.key);
}
const emptyResults = retirementScopes.map((scope) => ({
  ...scope,
  retiredFlags: [],
}));
const firstRetired = retiredKeys[0];
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
  const preservedScoutFlags: [string, unknown][] = [
    [
      "dare_notifications_enabled",
      { enabled: false, rollouts: [{ guild: "test", result: true }] },
    ],
    ["unrelated-unknown", { enabled: true }],
  ];
  const preservedTemporalFlags: [string, unknown][] = [
    ["temporal-agent-chat-photon-enabled", { enabled: true }],
    ["temporal-agent-chat-photon-owners", { value: "[]" }],
    ["temporal-agent-chat-imessage-claude-model", { value: "claude-opus-5" }],
    ["temporal-agent-chat-imessage-codex-model", { value: "gpt-5.6-luna" }],
  ];
  const scopes = new Map(
    retirementScopes.map(({ environment, namespace }) => [
      `${environment}/${namespace}`,
      new Map<string, unknown>([
        ...(namespace === "scout"
          ? preservedScoutFlags
          : preservedTemporalFlags),
        ...(options.absent
          ? []
          : retiredKeysIn(environment, namespace).map(
              (key): [string, unknown] => [key, { enabled: true }],
            )),
      ]),
    ]),
  );
  function flagsIn(
    environment: Environment,
    namespace = "scout",
  ): Map<string, unknown> {
    const flags = scopes.get(`${environment}/${namespace}`);
    if (flags === undefined)
      throw new Error(`No ${environment}/${namespace} flags`);
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
    const match =
      /^\/api\/v2\/environments\/(beta|prod)\/namespaces\/(scout|temporal)\/resources\/flipt\.core\.Flag(?:\/|$)/u.exec(
        url.pathname,
      );
    const environment = environments.find(
      (candidate) => candidate === match?.[1],
    );
    const namespace = match?.[2];
    if (environment === undefined || namespace === undefined)
      throw new Error(`Unexpected Flipt path ${url.pathname}`);
    const selectedFlags = flagsIn(environment, namespace);
    if (method === "GET") {
      return Response.json({
        resources: [...selectedFlags].map(([key, payload]) => ({
          namespaceKey: namespace,
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
    if (!options.keepDeleted) selectedFlags.delete(key);
    revision += 1;
    return key === firstRetired && options.concurrentRemoval
      ? Response.json(
          { code: 5, message: "removed concurrently" },
          { status: 404 },
        )
      : Response.json({ revision: `rev-${String(revision)}` });
  };
  return { flags, flagsIn, scopes, requests, fetcher };
}

test("only audited Scout and BlueBubbles keys are retired, preserving managed targeting and other unknowns", async () => {
  expect(
    retiredFlagDeclarations.map(
      ({ environment, namespace, key }) => `${environment}/${namespace}/${key}`,
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
    "beta/temporal/temporal-agent-chat-imessage-enabled",
    "beta/temporal/temporal-agent-chat-imessage-owners",
    "prod/temporal/temporal-agent-chat-imessage-enabled",
    "prod/temporal/temporal-agent-chat-imessage-owners",
    "beta/scout/scout_v2_postmatch_ownership_enabled",
    "beta/scout/scout_v2_prematch_ownership_enabled",
    "prod/scout/scout_v2_postmatch_ownership_enabled",
    "prod/scout/scout_v2_prematch_ownership_enabled",
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
  ).toEqual(
    retirementScopes.map((scope) => ({
      ...scope,
      retiredFlags: retiredKeysIn(scope.environment, scope.namespace),
    })),
  );
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
  for (const scope of ["beta/temporal", "prod/temporal"]) {
    const temporalFlags = server.scopes.get(scope);
    if (temporalFlags === undefined)
      throw new Error(`Missing test scope ${scope}`);
    expect([...temporalFlags.keys()]).toEqual([
      "temporal-agent-chat-photon-enabled",
      "temporal-agent-chat-photon-owners",
      "temporal-agent-chat-imessage-claude-model",
      "temporal-agent-chat-imessage-codex-model",
    ]);
  }
  expect(
    await applyRetiredManagedFlags({
      url: "https://flipt.example",
      fetcher: server.fetcher,
    }),
  ).toEqual(emptyResults);
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
  ).toEqual(emptyResults);
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
