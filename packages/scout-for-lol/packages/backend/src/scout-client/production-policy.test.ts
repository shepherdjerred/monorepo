import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  ScoutClientObservationSchema,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";

const mocks = vi.hoisted(() => ({
  databaseAccess: vi.fn(() => {
    throw new Error("Production must not read or write client evidence");
  }),
  archive: vi.fn(() => Promise.resolve(null)),
  spectator: vi.fn(() => Promise.resolve({ kind: "not-in-game" })),
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: new Proxy({}, { get: mocks.databaseAccess }),
}));
vi.mock("#src/report-lake/durable-receipts.ts", () => ({
  storedRawArchiveDescriptor: mocks.archive,
}));
vi.mock("#src/league/api/spectator.ts", () => ({
  getActiveGame: mocks.spectator,
}));

const { handleScoutClientRoute } = await import("./http.ts");
const {
  readSelectedLocalCanonicalMatch,
  resolveLocalCanonicalMatch,
  readTimelineSelection,
} = await import("./canonical-match.ts");
const { readClientPrematch, getActiveGameWithClientEvidence } =
  await import("./prematch.ts");
const { readClientGameResults, projectClientGameResult } =
  await import("./game-results.ts");
const { projectClashEntity } = await import("./clash-entities.ts");
const { readClientClashTeams } =
  await import("#src/league/clash/client-clash.ts");
const { readLocalMasterySnapshot } = await import("./player-snapshots.ts");
const { readClientObservedBots } =
  await import("#src/league/tasks/prematch/client-bot-roster.ts");
const { recentClientRounds } =
  await import("#src/lib/teammates/client-rounds.ts");
const { reconcileAcceptedClientEvidence } = await import("./reconciliation.ts");
const { startAcceptedClientMatches, ingestObservationBatch } =
  await import("./ingress.ts");

const owner = DiscordAccountIdSchema.parse("160509172704739328");
const puuid = LeaguePuuidSchema.parse("p".repeat(78));
const matchId = RiotMatchIdSchema.parse("NA1_7101");
const observation = ScoutClientObservationSchema.parse({
  protocolVersion: 1,
  schemaVersion: 1,
  observationId: crypto.randomUUID(),
  sequence: 1,
  capturedAt: new Date().toISOString(),
  appVersion: "0.1.0",
  kind: "post_game",
  platformId: "NA1",
  localPuuid: puuid,
  gameId: "7101",
  payload: { resource: "post_game", data: {} },
});
const originalEnvironment = Bun.env["ENVIRONMENT"];

beforeEach(async () => {
  Bun.env["ENVIRONMENT"] = "prod";
  resetConfigurationForTests();
  vi.clearAllMocks();
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider({
      scout_client_ingestion: true,
      scout_client_result_recovery: true,
    }),
  });
});
afterEach(async () => {
  await shutdownFeatureFlags();
  if (originalEnvironment === undefined) delete Bun.env["ENVIRONMENT"];
  else Bun.env["ENVIRONMENT"] = originalEnvironment;
  resetConfigurationForTests();
});

test.each([
  ["POST", "pairings"],
  ["POST", "pairings/00000000-0000-4000-8000-000000000001/exchange"],
  ["POST", "check-ins"],
  ["POST", "observations/batch"],
  ["POST", "replays/7101/offer"],
  ["PUT", "replays/7101"],
])(
  "production refuses %s %s before pairing or authentication",
  async (method, path) => {
    const request = new Request(
      `https://scout.invalid/api/scout-client/v1/${path}`,
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    const response = await handleScoutClientRoute(
      request,
      new URL(request.url),
    );
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "scout_client_disabled" });
    expect(mocks.databaseAccess).not.toHaveBeenCalled();
  },
);

test("production ignores stored client artifacts even when the provider answers true", async () => {
  expect(await readSelectedLocalCanonicalMatch(matchId)).toBeNull();
  expect(await resolveLocalCanonicalMatch(matchId)).toBeNull();
  expect(await readTimelineSelection(matchId)).toEqual({ source: "RIOT" });
  expect(await readClientPrematch(puuid, "AMERICA_NORTH")).toBeNull();
  expect(await readClientGameResults(owner, 20)).toEqual({
    results: [],
    conflicts: [],
  });
  expect(await readClientClashTeams([puuid], new Date(), true)).toEqual([]);
  expect(await readLocalMasterySnapshot(puuid)).toBeNull();
  expect(await readClientObservedBots("7101", new Set([puuid]))).toEqual([]);
  expect(
    await recentClientRounds([{ puuid, region: "AMERICA_NORTH" }], 10),
  ).toEqual([]);
  expect(await reconcileAcceptedClientEvidence()).toBe(0);
  await projectClientGameResult(observation);
  await projectClashEntity({ ...observation, kind: "clash" });
  const batch = { observations: [observation] };
  await startAcceptedClientMatches(batch, [
    { observationId: observation.observationId, outcome: "accepted" },
  ]);
  await expect(
    ingestObservationBatch(
      { deviceId: crypto.randomUUID(), ownerId: owner, appVersion: "0.1.0" },
      batch,
    ),
  ).rejects.toThrow("disabled in production");
  expect(mocks.databaseAccess).not.toHaveBeenCalled();
});

test("production keeps the Riot prematch path available", async () => {
  const riot = { kind: "not-in-game" };
  expect(await getActiveGameWithClientEvidence(puuid, "AMERICA_NORTH")).toEqual(
    riot,
  );
  expect(mocks.spectator).toHaveBeenCalledWith(puuid, "AMERICA_NORTH");
  expect(mocks.databaseAccess).not.toHaveBeenCalled();
});
