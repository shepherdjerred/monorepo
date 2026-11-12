import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  RawMatchSchema,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  ArtifactDescriptorSchema,
  type ArtifactDescriptor,
} from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { createTestScoutClientDevice } from "#src/testing/scout-client-device.ts";

const { prisma } = createTestDatabase("scout-client-remediation");
vi.doMock("#src/database/index.ts", async (original) => ({
  ...(await original()),
  prisma,
}));

const { lookupMatchContributors } = await import("./contributor-lookup.ts");
const { applyRemediationPlan, buildRemediationPlan, isPlanEmpty } =
  await import("./remediation.ts");
const { formatRemediationPlan } = await import("./format.ts");
const { parseRemediationArgs } = await import("./args.ts");
const { rawArchiveReceiptRecord } =
  await import("#src/report-lake/durable-receipts.ts");
const { recordReceipt } =
  await import("#src/database/durable/receipt-repository.ts");
const { revokeDevice } = await import("../pairing.ts");

const OWNER = DiscordAccountIdSchema.parse("160509172704739328");
const OTHER_OWNER = DiscordAccountIdSchema.parse("160509172704739329");
const RIOT_MATCH = RiotMatchIdSchema.parse("NA1_7101");
const LOST_MATCH = RiotMatchIdSchema.parse("NA1_7102");
const DIGEST = "a".repeat(64);

let deviceId: string;
let otherDeviceId: string;
let sequence = 0;

async function observation(
  device: string,
  kind: string,
  gameId: string | null,
  extra: { rawArchiveKey?: string; payload?: object } = {},
): Promise<string> {
  const { rawArchiveKey, payload = { resource: kind, data: {} } } = extra;
  sequence += 1;
  const observationId = crypto.randomUUID();
  await prisma.scoutClientObservation.create({
    data: {
      observationId,
      deviceId: device,
      sequence: BigInt(sequence),
      capturedAt: new Date(),
      protocolVersion: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      kind,
      gameId,
      platformId: gameId === null ? null : "NA1",
      payload,
      bodyDigest: `digest-${sequence.toString()}`,
      disposition: "ACCEPTED",
      ...(rawArchiveKey === undefined ? {} : { rawArchiveKey }),
    },
  });
  return observationId;
}

async function archive(
  matchId: RiotMatchId,
  kind: ArtifactDescriptor["kind"],
): Promise<string> {
  const key = `games/2026/01/01/${matchId}/${kind}.json`;
  await recordReceipt(
    prisma,
    rawArchiveReceiptRecord({
      matchId,
      artifact: ArtifactDescriptorSchema.parse({
        kind,
        key,
        digest: DIGEST,
        bytes: 10,
        contentType: "application/json",
        capturedAt: new Date().toISOString(),
      }),
    }),
  );
  return key;
}

async function clientMatch(matchId: RiotMatchId, observationId: string) {
  await prisma.scoutClientCanonicalMatch.create({
    data: {
      riotMatchId: matchId,
      sourceObservationId: observationId,
      payloadDigest: DIGEST,
    },
  });
  return [
    await archive(matchId, "match"),
    await archive(matchId, "timeline"),
    await archive(matchId, "client_bundle"),
  ];
}

beforeEach(async () => {
  await prisma.matchProcessingReceipt.deleteMany();
  await prisma.scoutClientCanonicalMatch.deleteMany();
  await prisma.scoutClientObservation.deleteMany();
  await prisma.leagueIdentityAlias.deleteMany();
  await prisma.scoutClientDevice.deleteMany();
  await prisma.scoutClientPairing.deleteMany();
  await prisma.user.deleteMany();
  deviceId = await createTestScoutClientDevice(prisma, OWNER);
  otherDeviceId = await createTestScoutClientDevice(prisma, OTHER_OWNER);
  sequence = 0;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("contributor lookup", () => {
  test("names the source device, its owner and every observation id", async () => {
    const selected = await observation(deviceId, "post_game", "7101");
    const other = await observation(otherDeviceId, "post_game", "7101");
    await observation(deviceId, "post_game", "9999");
    await prisma.scoutClientCanonicalMatch.create({
      data: {
        riotMatchId: RIOT_MATCH,
        sourceObservationId: selected,
        payloadDigest: DIGEST,
      },
    });

    const result = await lookupMatchContributors(prisma, RIOT_MATCH);

    expect(result.source).toMatchObject({
      observationId: selected,
      deviceId,
      ownerId: OWNER,
    });
    expect(
      result.observations.map((row) => row.observationId).toSorted(),
    ).toEqual([selected, other].toSorted());
    expect(
      result.observations.find((row) => row.observationId === other)?.ownerId,
    ).toBe(OTHER_OWNER);
  });

  test("has no source for a match no client supplied", async () => {
    const result = await lookupMatchContributors(prisma, RIOT_MATCH);
    expect(result).toMatchObject({ source: null, observations: [] });
  });
});

const RIFT = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

function riotMatch(matchId: RiotMatchId): RawMatch {
  return { ...RIFT, metadata: { ...RIFT.metadata, matchId, participants: [] } };
}

type Fakes = ReturnType<typeof fakes>;

function fakes(riotHas: ReadonlySet<string>) {
  const deleted: string[] = [];
  const ingested: string[] = [];
  const refreshed: string[] = [];
  return {
    deleted,
    ingested,
    refreshed,
    deps: {
      riot: {
        fetchMatch: (matchId: RiotMatchId) =>
          Promise.resolve(
            riotHas.has(matchId) ? riotMatch(matchId) : undefined,
          ),
        fetchTimeline: () =>
          Promise.resolve<RawTimeline | undefined>(undefined),
      },
      objects: {
        delete: (key: string) => {
          deleted.push(key);
          return Promise.resolve();
        },
      },
      ingestMatch: (value: RawMatch) => {
        ingested.push(value.metadata.matchId);
        return Promise.resolve();
      },
      ingestTimeline: () => Promise.resolve(),
      revokeDevice: (id: string, ownerId: string) =>
        revokeDevice(id, DiscordAccountIdSchema.parse(ownerId)),
      refresh: {
        rebuildLake: () => {
          refreshed.push("lake");
          return Promise.resolve();
        },
        refreshHallOfFame: () => {
          refreshed.push("hall");
          return Promise.resolve();
        },
        refreshCompetitions: () => {
          refreshed.push("competitions");
          return Promise.resolve();
        },
      },
    },
  };
}

function oracleOf(
  riot: Fakes,
  prematch: Readonly<Record<string, string>> = {},
) {
  return {
    hasMatch: async (id: RiotMatchId) =>
      (await riot.deps.riot.fetchMatch(id)) !== undefined,
    prematchSourceObservation: (id: RiotMatchId) =>
      Promise.resolve(prematch[id] ?? null),
  };
}

async function snapshot() {
  return {
    observations: await prisma.scoutClientObservation.count(),
    canonical: await prisma.scoutClientCanonicalMatch.count(),
    receipts: await prisma.matchProcessingReceipt.count(),
    revoked: await prisma.scoutClientDevice.count({
      where: { deviceState: "REVOKED" },
    }),
  };
}

async function seed() {
  const riotObs = await observation(deviceId, "post_game", "7101");
  const lostObs = await observation(deviceId, "post_game", "7102", {
    rawArchiveKey: "scout-client/observations/x.json",
  });
  await observation(deviceId, "gameflow", "7101");
  await observation(otherDeviceId, "post_game", "7103");
  await clientMatch(RIOT_MATCH, riotObs);
  const lostKeys = await clientMatch(LOST_MATCH, lostObs);
  return { lostKeys };
}

function scope() {
  return { kind: "owner", ownerId: OWNER } as const;
}

describe("remediation plan", () => {
  test("a dry run reads and plans but writes nothing", async () => {
    await seed();
    const before = await snapshot();
    const riot = fakes(new Set([RIOT_MATCH]));

    const plan = await buildRemediationPlan(prisma, scope(), oracleOf(riot));

    expect(await snapshot()).toEqual(before);
    expect(riot.deleted).toEqual([]);
    expect(plan.revokeDeviceIds).toEqual([deviceId]);
    expect(plan.observationTotal).toBe(3);
    expect(plan.prematchObservationIds).toHaveLength(1);
    expect(
      Object.fromEntries(plan.matches.map((m) => [m.matchId, m.action])),
    ).toEqual({ [RIOT_MATCH]: "rederive", [LOST_MATCH]: "delete" });
    expect(formatRemediationPlan(plan).join("\n")).toContain("rederive");
  });

  test("re-derives a match Riot has and deletes one it does not", async () => {
    const { lostKeys } = await seed();
    const riot = fakes(new Set([RIOT_MATCH]));
    const plan = await buildRemediationPlan(prisma, scope(), oracleOf(riot));

    await applyRemediationPlan(prisma, plan, riot.deps);

    expect(riot.ingested).toEqual([RIOT_MATCH]);
    // The lost match's objects are deleted; the re-derived one's were
    // replaced by the Riot ingest, so its keys were removed first too.
    for (const key of lostKeys) expect(riot.deleted).toContain(key);
    expect(riot.deleted).toContain("scout-client/observations/x.json");
    expect(riot.refreshed).toEqual(["lake", "hall", "competitions"]);
    expect(await snapshot()).toEqual({
      observations: 1,
      canonical: 0,
      receipts: 0,
      revoked: 1,
    });
    // The other owner's upload and device are untouched.
    expect(
      await prisma.scoutClientObservation.count({
        where: { deviceId: otherDeviceId },
      }),
    ).toBe(1);
  });

  test("applying twice is safe and the second plan is empty", async () => {
    await seed();
    const riot = fakes(new Set([RIOT_MATCH]));
    const oracle = oracleOf(riot);
    const first = await buildRemediationPlan(prisma, scope(), oracle);
    await applyRemediationPlan(prisma, first, riot.deps);
    const after = await snapshot();
    const ingestedOnce = [...riot.ingested];

    const second = await buildRemediationPlan(prisma, scope(), oracle);
    expect(isPlanEmpty(second)).toBe(true);
    await applyRemediationPlan(prisma, second, riot.deps);

    expect(await snapshot()).toEqual(after);
    expect(riot.ingested).toEqual(ingestedOnce);
  });

  test("an interrupted run is finished by running it again", async () => {
    await seed();
    const riot = fakes(new Set([RIOT_MATCH]));
    const oracle = oracleOf(riot);
    const plan = await buildRemediationPlan(prisma, scope(), oracle);
    const failing: Fakes["deps"] = {
      ...riot.deps,
      ingestMatch: () => Promise.reject(new Error("object store down")),
    };
    await expect(applyRemediationPlan(prisma, plan, failing)).rejects.toThrow(
      "object store down",
    );
    // The selection row survives, so the match still plans as client-derived.
    const rerun = await buildRemediationPlan(prisma, scope(), oracle);
    expect(rerun.matches.find((m) => m.matchId === RIOT_MATCH)?.action).toBe(
      "rederive",
    );
    await applyRemediationPlan(prisma, rerun, riot.deps);
    const final = await snapshot();
    expect(final.canonical).toBe(0);
    expect(riot.ingested).toEqual([RIOT_MATCH]);
  });

  test("scopes to one device when asked", async () => {
    await seed();
    const plan = await buildRemediationPlan(
      prisma,
      { kind: "device", deviceId: otherDeviceId },
      { ...oracleOf(fakes(new Set())), hasMatch: () => Promise.resolve(false) },
    );
    expect(plan.devices.map((d) => d.id)).toEqual([otherDeviceId]);
    expect(plan.observationTotal).toBe(1);
  });
});

describe("remediation scope", () => {
  test("leaves a match alone when another owner's upload was selected", async () => {
    const mine = await observation(deviceId, "post_game", "7101");
    const theirs = await observation(otherDeviceId, "post_game", "7101");
    expect(mine).not.toBe(theirs);
    const keys = await clientMatch(RIOT_MATCH, theirs);
    const riot = fakes(new Set());

    const plan = await buildRemediationPlan(prisma, scope(), oracleOf(riot));
    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0]).toMatchObject({
      action: "observations-only",
      clientSelected: false,
    });
    await applyRemediationPlan(prisma, plan, riot.deps);

    for (const key of keys) expect(riot.deleted).not.toContain(key);
    expect(await prisma.scoutClientCanonicalMatch.count()).toBe(1);
    expect(await prisma.matchProcessingReceipt.count()).toBe(3);
  });

  test("replaces a client timeline that rides with Riot's result", async () => {
    await observation(deviceId, "post_game", "7101", {
      payload: { data: { matchHistory: {}, timeline: {} } },
    });
    const key = await archive(RIOT_MATCH, "timeline");
    const matchKey = await archive(RIOT_MATCH, "match");
    const riot = fakes(new Set([RIOT_MATCH]));

    const plan = await buildRemediationPlan(prisma, scope(), oracleOf(riot));
    expect(plan.matches[0]).toMatchObject({
      action: "timeline",
      clientSelected: false,
      clientTimeline: true,
    });
    await applyRemediationPlan(prisma, plan, riot.deps);

    expect(riot.deleted).toContain(key);
    expect(riot.deleted).not.toContain(matchKey);
    // Riot's match stays archived.
    expect(await prisma.matchProcessingReceipt.count()).toBe(1);
    const second = await buildRemediationPlan(prisma, scope(), oracleOf(riot));
    expect(isPlanEmpty(second)).toBe(true);
  });

  test("removes a canonical prematch snapshot derived from the scope", async () => {
    const flow = await observation(deviceId, "gameflow", "7101");
    const other = await observation(otherDeviceId, "gameflow", "7102");
    const key = await archive(RIOT_MATCH, "prematch");
    await archive(LOST_MATCH, "prematch");
    const riot = fakes(new Set());

    const plan = await buildRemediationPlan(
      prisma,
      scope(),
      oracleOf(riot, { [RIOT_MATCH]: flow, [LOST_MATCH]: other }),
    );
    expect(plan.prematchSnapshots).toEqual([
      { matchId: RIOT_MATCH, observationId: flow },
    ]);
    expect(isPlanEmpty(plan)).toBe(false);
    await applyRemediationPlan(prisma, plan, riot.deps);

    expect(riot.deleted).toContain(key);
    // Only the other owner's snapshot receipt remains.
    expect(await prisma.matchProcessingReceipt.count()).toBe(1);
  });
});

describe("argument parsing", () => {
  test("defaults to a dry run and requires exactly one scope", () => {
    expect(parseRemediationArgs(["--owner", "160509172704739328"])).toEqual({
      scope: { kind: "owner", ownerId: "160509172704739328" },
      apply: false,
    });
    expect(parseRemediationArgs(["--device", "d", "--apply"]).apply).toBe(true);
    expect(() => parseRemediationArgs([])).toThrow();
    expect(() =>
      parseRemediationArgs(["--owner", "160509172704739328", "--device", "d"]),
    ).toThrow();
    expect(() => parseRemediationArgs(["--nope"])).toThrow("Unknown argument");
  });
});
