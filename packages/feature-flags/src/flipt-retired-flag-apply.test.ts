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
  { environment: "beta", namespace: "storm" },
  { environment: "prod", namespace: "storm" },
  { environment: "beta", namespace: "birmel" },
  { environment: "prod", namespace: "birmel" },
  { environment: "beta", namespace: "trmnl-dashboard" },
  { environment: "prod", namespace: "trmnl-dashboard" },
  { environment: "beta", namespace: "alert-dashboard" },
  { environment: "prod", namespace: "alert-dashboard" },
  { environment: "beta", namespace: "tracker" },
  { environment: "prod", namespace: "tracker" },
  { environment: "beta", namespace: "streambot" },
  { environment: "prod", namespace: "streambot" },
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
  const preservedTrackerFlags: [string, unknown][] = [
    ["tracker-writes-enabled", { enabled: true }],
  ];
  const preservedOtherFlags: [string, unknown][] = [
    ["unrelated-unknown", { enabled: true }],
  ];
  const preservedStreambotFlags: [string, unknown][] = [
    [
      "streambot-music-catalog-enabled",
      { enabled: false, rules: [{ guild: "test" }] },
    ],
  ];
  const preservedByNamespace = new Map([
    ["scout", preservedScoutFlags],
    ["temporal", preservedTemporalFlags],
    ["tracker", preservedTrackerFlags],
    ["streambot", preservedStreambotFlags],
  ]);
  const preservedFlags = (namespace: string): [string, unknown][] =>
    preservedByNamespace.get(namespace) ?? preservedOtherFlags;
  const scopes = new Map(
    retirementScopes.map(({ environment, namespace }) => [
      `${environment}/${namespace}`,
      new Map<string, unknown>([
        ...preservedFlags(namespace),
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
      /^\/api\/v2\/environments\/(beta|prod)\/namespaces\/([a-z-]+)\/resources\/flipt\.core\.Flag(?:\/|$)/u.exec(
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

test("only audited keys are retired, preserving managed targeting and other unknowns", async () => {
  expect(
    retiredFlagDeclarations.map(
      ({ environment, namespace, key }) => `${environment}/${namespace}/${key}`,
    ),
  ).toEqual([
    "beta/scout/ai_reviews_enabled",
    "prod/scout/ai_reviews_enabled",
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
    "beta/scout/scout-bucks-ask-model",
    "prod/scout/scout-bucks-ask-model",
    "beta/scout/scout-report-lake-schema-upgrade-enabled",
    "prod/scout/scout-report-lake-schema-upgrade-enabled",
    "beta/storm/storm-brain-classify-enabled",
    "beta/storm/storm-brain-triage-enabled",
    "prod/storm/storm-brain-classify-enabled",
    "prod/storm/storm-brain-triage-enabled",
    "beta/birmel/birmel-image-generation-enabled",
    "prod/birmel/birmel-image-generation-enabled",
    "beta/trmnl-dashboard/pet-dashboard-enabled",
    "prod/trmnl-dashboard/pet-dashboard-enabled",
    "beta/alert-dashboard/ops-digest-email-enabled",
    "prod/alert-dashboard/ops-digest-email-enabled",
    "beta/scout/custom_nights_enabled",
    "prod/scout/custom_nights_enabled",
    "beta/tracker/tracker-imports-enabled",
    "prod/tracker/tracker-imports-enabled",
    "beta/streambot/streambot-playlist-limit",
    "prod/streambot/streambot-playlist-limit",
    "beta/scout/betting_enabled",
    "beta/scout/betting_player_bet_outcome_dm_enabled",
    "beta/scout/betting_settlement_dm_enabled",
    "beta/scout/bucks_dares_enabled",
    "beta/scout/bucks_transfers_enabled",
    "beta/scout/scout-betting-parlay-ai-model",
    "prod/scout/betting_enabled",
    "prod/scout/betting_player_bet_outcome_dm_enabled",
    "prod/scout/betting_settlement_dm_enabled",
    "prod/scout/bucks_dares_enabled",
    "prod/scout/bucks_transfers_enabled",
    "prod/scout/scout-betting-parlay-ai-model",
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
  for (const environment of environments) {
    expect([...server.flagsIn(environment, "tracker").keys()]).toEqual([
      "tracker-writes-enabled",
    ]);
    expect([...server.flagsIn(environment, "streambot")]).toEqual([
      [
        "streambot-music-catalog-enabled",
        { enabled: false, rules: [{ guild: "test" }] },
      ],
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
