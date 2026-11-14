import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  ScoutClientObservationSchema,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import {
  StaticProvider,
  type StaticFlagValue,
} from "@shepherdjerred/feature-flags/providers/static.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { MY_SERVER } from "#src/configuration/flags.ts";
import { riotMatchWithSeats } from "#src/testing/riot-match-seats.ts";

const mocks = vi.hoisted(() => ({
  databaseAccess: vi.fn((_target: object, model: string | symbol): unknown => {
    throw new Error(
      `A closed Scout Client must not touch the database (${String(model)})`,
    );
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
const { authenticateScoutClient } = await import("./access/authentication.ts");
const { isScoutClientEnabledFor, isScoutClientLive } =
  await import("./access/policy.ts");
const {
  readSelectedLocalCanonicalMatch,
  resolveLocalCanonicalMatch,
  readTimelineSelection,
} = await import("./canonical-match.ts");
const { readClientPrematch } = await import("./prematch-evidence.ts");
const { resolvePrematch: getActiveGameWithClientEvidence } =
  await import("#src/evidence/prematch.ts");
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
const { reconcileRawClientObservations } =
  await import("./archive/reconciliation.ts");
const { startAcceptedClientMatches, ingestObservationBatch } =
  await import("./ingress.ts");
const { learnAliasesFromRiotMatch } =
  await import("./alias-attempts/riot-match-aliases.ts");

const CLIENT_FLAGS = [
  "scout_client_ingestion",
  "scout_client_result_recovery",
] as const;
const owner = DiscordAccountIdSchema.parse("160509172704739328");
const member = DiscordAccountIdSchema.parse("260509172704739328");
const OTHER_GUILD = DiscordGuildIdSchema.parse("2337623164146155593");
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
type EvaluationContext = Parameters<
  StaticProvider["resolveBooleanEvaluation"]
>[2];

/**
 * Flipt with one segment rollout on both client flags: true when the
 * evaluation context carries the targeted attribute, the flag's default
 * (false) otherwise. Other keys answer from a fixed map.
 */
class TargetedProvider extends StaticProvider {
  constructor(
    private readonly attribute: "server" | "user",
    private readonly value: string,
    values: Readonly<Record<string, StaticFlagValue>> = {},
  ) {
    super(values);
  }

  override async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ) {
    const clientFlags: readonly string[] = CLIENT_FLAGS;
    return clientFlags.includes(flagKey)
      ? { value: context[this.attribute] === this.value, reason: "STATIC" }
      : await super.resolveBooleanEvaluation(flagKey, defaultValue, context);
  }
}

async function answerWith(provider: StaticProvider): Promise<void> {
  await shutdownFeatureFlags();
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider,
  });
}

/** A database holding one active device for `deviceOwner` and their Players. */
function databaseWith(deviceOwner: string, playerGuilds: readonly string[]) {
  const findDevice = vi.fn(() =>
    Promise.resolve({
      id: "00000000-0000-4000-8000-000000000001",
      ownerId: deviceOwner,
      appVersion: "0.1.0",
      deviceState: "ACTIVE",
    }),
  );
  const findPlayers = vi.fn(() =>
    Promise.resolve(playerGuilds.map((serverId) => ({ serverId }))),
  );
  mocks.databaseAccess.mockImplementation((_target, model) => {
    if (model === "scoutClientDevice") return { findUnique: findDevice };
    if (model === "player") return { findMany: findPlayers };
    throw new Error(`Unexpected database access (${String(model)})`);
  });
  return { findPlayers };
}

function deviceRequest(): Request {
  return new Request("https://scout.invalid/api/scout-client/v1/check-ins", {
    method: "POST",
    headers: { Authorization: `Bearer sct_${"t".repeat(40)}` },
  });
}

beforeEach(async () => {
  Bun.env["ENVIRONMENT"] = "prod";
  resetConfigurationForTests();
  vi.clearAllMocks();
  // Production's managed declaration: both flags off, no rollout.
  await initFeatureFlags({
    environment: { FEATURE_FLAGS_MODE: "disabled" },
    provider: new StaticProvider({
      scout_client_ingestion: false,
      scout_client_result_recovery: false,
    }),
  });
});
afterEach(async () => {
  await shutdownFeatureFlags();
  mocks.databaseAccess.mockReset();
  mocks.databaseAccess.mockImplementation((_target, model) => {
    throw new Error(
      `A closed Scout Client must not touch the database (${String(model)})`,
    );
  });
  if (originalEnvironment === undefined) delete Bun.env["ENVIRONMENT"];
  else Bun.env["ENVIRONMENT"] = originalEnvironment;
  resetConfigurationForTests();
});

test.each([
  ["POST", "pairings"],
  ["POST", "pairings/00000000-0000-4000-8000-000000000001/exchange"],
  ["POST", "check-ins"],
  ["POST", "observations/batch"],
  ["POST", "desktop/events"],
  ["POST", "replays/7101/offer"],
  ["PUT", "replays/7101"],
])(
  "a Flipt false refuses %s %s before pairing or authentication",
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

test("a Flipt false closes every owner decision without a guild lookup", async () => {
  for (const flag of CLIENT_FLAGS) {
    expect(await isScoutClientLive(flag)).toBe(false);
    expect(await isScoutClientEnabledFor(flag, owner)).toBe(false);
    expect(await isScoutClientEnabledFor(flag, member)).toBe(false);
  }
  expect(mocks.databaseAccess).not.toHaveBeenCalled();
});

test("a Flipt false ignores stored client artifacts and writes none", async () => {
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
  expect(await reconcileRawClientObservations()).toBe(0);
  expect(await projectClientGameResult(observation)).toBe("skipped");
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
  ).rejects.toThrow("disabled in this environment");
  expect(mocks.databaseAccess).not.toHaveBeenCalled();
});

test("a Flipt false learns no aliases from a Riot-published game", async () => {
  const riotMatch = await riotMatchWithSeats(matchId, [
    { participantId: 1, teamId: 100, championId: 1, puuid },
  ]);
  expect(await learnAliasesFromRiotMatch(riotMatch)).toBe(0);
  expect(mocks.databaseAccess).not.toHaveBeenCalled();
});

test("a Flipt false keeps the Riot prematch path available", async () => {
  const riot = { kind: "not-in-game" };
  expect(await getActiveGameWithClientEvidence(puuid, "AMERICA_NORTH")).toEqual(
    riot,
  );
  expect(mocks.spectator).toHaveBeenCalledWith(puuid, "AMERICA_NORTH");
  expect(mocks.databaseAccess).not.toHaveBeenCalled();
});

test("a server-targeted rule enables the devices of every owner with a Player there", async () => {
  await answerWith(new TargetedProvider("server", MY_SERVER));
  const { findPlayers } = databaseWith(member, [OTHER_GUILD, MY_SERVER]);

  expect(await isScoutClientLive("scout_client_ingestion")).toBe(true);
  await expect(authenticateScoutClient(deviceRequest())).resolves.toEqual({
    deviceId: "00000000-0000-4000-8000-000000000001",
    ownerId: member,
    appVersion: "0.1.0",
  });
  expect(findPlayers).toHaveBeenCalledWith({
    where: { discordId: member },
    select: { serverId: true },
    distinct: ["serverId"],
  });
});

test("a server-targeted rule leaves owners without a Player in that guild closed", async () => {
  await answerWith(new TargetedProvider("server", MY_SERVER));
  databaseWith(member, [OTHER_GUILD]);

  await expect(authenticateScoutClient(deviceRequest())).resolves.toBeNull();
});

test("a user-targeted rule enables its owner without a guild lookup", async () => {
  await answerWith(new TargetedProvider("user", owner));
  const { findPlayers } = databaseWith(owner, [MY_SERVER]);

  await expect(authenticateScoutClient(deviceRequest())).resolves.toEqual(
    expect.objectContaining({ ownerId: owner }),
  );
  expect(findPlayers).not.toHaveBeenCalled();
  // A rule for one user reaches no one else.
  expect(await isScoutClientEnabledFor("scout_client_ingestion", member)).toBe(
    false,
  );
});

test("production keeps evidence recovery off while the client flags answer true", async () => {
  // Evidence recovery has its own gate: affirmative client answers still leave
  // production's Riot evidence contract off.
  await answerWith(
    new StaticProvider({
      scout_client_ingestion: true,
      scout_client_result_recovery: true,
    }),
  );
  const { evidenceRecoveryEnabled } =
    await import("#src/evidence/recovery-gate.ts");
  expect(evidenceRecoveryEnabled()).toBe(false);
});
