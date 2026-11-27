import { expect, type Page } from "@playwright/test";
import path from "node:path";
import { z } from "zod";
import {
  AnimationOmissionsSchema,
  verifyRecordedAnimationResponse,
  workerAnimationCues,
} from "./animation-worker-oracle.ts";
import { RecordedTerrainVisibilitySchema } from "./terrain-visibility-schema.ts";
import { readDirectWorkerReply } from "./motion-worker-capture.ts";
import { verifyDirectLaneWorker } from "./lane-worker-oracle.ts";
import { verifyDirectNeutralWorker } from "./neutral-worker-oracle.ts";

const schemaTrack = z.number().int().positive();
const statPoint = z.tuple([z.number(), z.number(), z.number()]);
const health = z.array(
  z.object({ participantId: schemaTrack, points: z.array(statPoint) }),
);
const resources = z.array(
  z.object({
    participantId: schemaTrack,
    gold: z.array(z.tuple([z.number(), z.number()])),
    resource: z.array(statPoint),
  }),
);
const inventory = z.array(
  z.object({
    participantId: schemaTrack,
    points: z.array(
      z.tuple([
        z.number().nonnegative(),
        z
          .array(
            z
              .object({
                itemId: z.number().int().positive(),
                count: z.number().int().nonnegative(),
              })
              .nullable(),
          )
          .length(7),
      ]),
    ),
  }),
);
const experience = z.array(
  z.object({
    participantId: schemaTrack,
    levelCaps: z.array(
      z.tuple([z.number().nonnegative(), z.number().int().positive()]),
    ),
    points: z.array(
      z.tuple([
        z.number().nonnegative(),
        z.number().nonnegative(),
        z.number().int().positive(),
      ]),
    ),
  }),
);
const teamVision = z.array(
  z.strictObject({
    context: schemaTrack,
    changes: z
      .array(
        z.tuple([
          z.number().nonnegative(),
          z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)]),
        ]),
      )
      .nonempty(),
  }),
);
const reply = z.object({
  requestKeys: z.array(z.string()),
  decodeChampionStats: z.boolean(),
  decodeChampionInventory: z.boolean(),
  decodeChampionExperience: z.boolean(),
  hasChampionAnimationCatalog: z.boolean(),
  stats: z
    .object({
      championHealthTracks: health,
      championResourceTracks: resources,
    })
    .optional(),
  inventoryTracks: inventory.optional(),
  experienceTracks: experience.optional(),
  animationCues: workerAnimationCues.optional(),
  championAnimationOmissions: AnimationOmissionsSchema.optional(),
  teamVision: teamVision.optional(),
  terrainVisibility: RecordedTerrainVisibilitySchema.optional(),
  laneMinionInstances: z.array(z.unknown()).optional(),
  laneMinionCoverage: z.unknown().optional(),
  neutralObjectiveInstances: z.array(z.unknown()).optional(),
  neutralObjectiveKills: z.array(z.unknown()).optional(),
  neutralObjectiveOmissions: z.unknown().optional(),
  neutralCampCoverage: z.unknown().optional(),
  neutralCampSkins: z.unknown().optional(),
  recordedPlayerState: z.unknown().optional(),
  announcerCues: z
    .array(
      z
        .object({
          timeSeconds: z.number().nonnegative(),
          mediaId: z.number().int().positive(),
        })
        .strict(),
    )
    .optional(),
});

const oracleFiles = {
  "scout-8428-recorded-player-state-oracle.json":
    "cc78e35ebce1cb10a2e7d161a99cf503571aab01ea105dc3aa8da166efd0298b",
  "scout-8428-camp-vision-native-tracks.json":
    "2315749d31b008bd0589141158143c47e4594fdb1131bd44331fe6eef31cf544",
  "scout-8428-v30-neutral-visibility-native-tracks.json":
    "bb002031183cb86b336b7b350d906c457eb7f328ea89271484737942eb54c04f",
  "exact-terrain-fog-agent/exact-8428-rift-terrain-windowed-receipt.json":
    "069130f305c46b9f626e8e4f70f9a9c3c20ce77892aac8e8444295aedc898f8d",
  "scout-8428-v21-team-vision-tracks.json":
    "c4a260a2e74c8d43275718126d47f013377c4df4b9e6f78cef2df0d4fe0b8979",
  "scout-8428-champion-health.json":
    "f2b0232bc86868479da10e6ed38bdb233867605ffe64c2116db078878ad651bd",
  "scout-8428-champion-resources.json":
    "4678aaf2167c5186e6bf64df83757831bdd5510b29ce8edc5308dc6ce57772e7",
  "scout-8428-health-native.json":
    "3a84587c250585b04d5e16c6c3ad49c3bfed6d406161d118100f65703d711a38",
  "scout-8428-resources-native.json":
    "824d568719f530e728eebb0d0abea47761516acef53d5f28a1c3653433258e9f",
  "scout-8428-inventory-current-tracks.json":
    "56b91b8bc6b6de0bc8b4f7a57a007ff6f35a427d2c112da6cd942eb9830495f7",
  "scout-8428-experience-tracks.json":
    "23ce79d3a3cc4f3d9620d2473ff95edcb58b65fed8067f52f28b6a8e17dd4ab9",
  "scout-8428-experience-native-proof.json":
    "456b97569682af9d810fa3380302f838ecc1b185f45103fc6f5a9c2c61685acd",
  "scout-8428-experience-cap-proof.json":
    "17d0f890d8d99e3659b656ae153a3c82190461979b056e361948892caf74f46b",
};

const sha256 = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const decode = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

async function readOracle(root: string, file: keyof typeof oracleFiles) {
  const bytes = await Bun.file(path.join(root, file)).bytes();
  if (sha256(bytes) !== oracleFiles[file])
    throw new Error(
      `Recorded champion observation oracle digest differs: ${file}.`,
    );
  return bytes;
}

function tracksHash(
  tracks:
    | z.infer<typeof health>
    | z.infer<typeof resources>
    | z.infer<typeof inventory>
    | z.infer<typeof experience>,
) {
  return sha256(
    new TextEncoder().encode(
      JSON.stringify(
        tracks.toSorted((a, b) => a.participantId - b.participantId),
      ),
    ),
  );
}

export async function verifyDirectChampionStatsWorker(
  page: Page,
  fixture: {
    descriptor: { sha256: string };
    directChampionStats: boolean;
    directChampionInventory: boolean;
    directChampionExperience: boolean;
    directChampionAnimation: boolean;
    directChampionAnimationModels: boolean;
    directChampionModels: boolean;
    directReplayObservations: boolean;
    championAnimationCueCount: number;
    announcerEvents?: unknown;
    directTeamVision: boolean;
    directTerrainVisibility: boolean;
    directLaneModels: [string, number][] | undefined;
    directNeutralModels: [string, number][] | undefined;
    directNeutralCamps: boolean;
    directNeutralCampSkins: [string, number][] | undefined;
    directPlayerState: boolean;
    terrainVisibility:
      z.infer<typeof RecordedTerrainVisibilitySchema> | undefined;
  },
) {
  if (!fixture.directReplayObservations)
    return {
      cueCount: fixture.championAnimationCueCount,
      terrainVisibility: fixture.terrainVisibility,
    };
  const {
    descriptor,
    directChampionStats,
    directChampionInventory,
    directChampionExperience,
    directChampionAnimation,
    directChampionAnimationModels,
  } = fixture;
  const oracleRoot = Bun.env["SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY"];
  if (oracleRoot === undefined || oracleRoot === "")
    throw new Error(
      "Set SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY for direct champion observation verification.",
    );
  const actual = reply.parse(await readDirectWorkerReply(page));
  expect(actual.decodeChampionStats).toBe(directChampionStats);
  expect(actual.decodeChampionInventory).toBe(directChampionInventory);
  expect(actual.decodeChampionExperience).toBe(directChampionExperience);
  const legacyAnimationCatalog =
    directChampionAnimation && !directChampionAnimationModels;
  expect(actual.hasChampionAnimationCatalog).toBe(legacyAnimationCatalog);
  const optionalKeys = Object.entries({
    announcerEvents: fixture.announcerEvents !== undefined,
    championAnimationCatalog: legacyAnimationCatalog,
    championAnimationModelCatalog: directChampionAnimationModels,
    championModelCatalog: fixture.directChampionModels,
    decodeChampionExperience: directChampionExperience,
    decodeChampionInventory: directChampionInventory,
    decodeChampionStats: directChampionStats,
    decodeTeamVision: fixture.directTeamVision,
    teamVisionWorldActors: fixture.directTeamVision,
    terrainControllerGraph: fixture.directTerrainVisibility,
    laneMinionCatalog: fixture.directLaneModels !== undefined,
    neutralObjectiveModels: fixture.directNeutralModels !== undefined,
    decodeNeutralCamps: fixture.directNeutralCamps,
    neutralCampSkins: fixture.directNeutralCampSkins !== undefined,
    decodePlayerState: fixture.directPlayerState,
  })
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  expect(actual.requestKeys).toEqual(
    [
      "allowCurrentBuild",
      ...optionalKeys,
      "decoderBytes",
      "identity",
      "replayBytes",
      "waypointOrigin",
    ].sort(),
  );
  expect(actual.neutralCampSkins).toEqual(fixture.directNeutralCampSkins);
  await verifyDirectPlayerState(
    actual.recordedPlayerState,
    fixture.directPlayerState,
    oracleRoot,
    descriptor.sha256,
  );
  await verifyDirectLaneWorker(
    oracleRoot,
    descriptor.sha256,
    fixture.directLaneModels,
    actual,
  );
  const neutralContexts = await verifyDirectNeutralWorker(
    oracleRoot,
    descriptor.sha256,
    fixture,
    actual,
  );
  await verifyDirectTeamVision(
    fixture,
    actual.teamVision,
    oracleRoot,
    neutralContexts,
  );
  const terrainVisibility = await verifyDirectTerrainVisibility(
    fixture,
    actual.terrainVisibility,
    oracleRoot,
  );
  if (directChampionStats) {
    const [healthOracle, resourceOracle] = await Promise.all([
      readOracle(oracleRoot, "scout-8428-champion-health.json"),
      readOracle(oracleRoot, "scout-8428-champion-resources.json"),
      readOracle(oracleRoot, "scout-8428-health-native.json"),
      readOracle(oracleRoot, "scout-8428-resources-native.json"),
    ]);
    const expectedHealth = z
      .object({ replaySha256: z.string(), tracks: health })
      .parse(decode(healthOracle));
    const expectedResource = z
      .object({ replaySha256: z.string(), tracks: resources })
      .parse(decode(resourceOracle));
    expect(expectedHealth.replaySha256).toBe(descriptor.sha256);
    expect(expectedResource.replaySha256).toBe(descriptor.sha256);
    if (actual.stats === undefined)
      throw new Error("Direct worker response is missing champion stats.");
    expect(tracksHash(actual.stats.championHealthTracks)).toBe(
      tracksHash(expectedHealth.tracks),
    );
    expect(tracksHash(actual.stats.championResourceTracks)).toBe(
      tracksHash(expectedResource.tracks),
    );
  }
  if (directChampionInventory) {
    const bytes = await readOracle(
      oracleRoot,
      "scout-8428-inventory-current-tracks.json",
    );
    const expected = z
      .object({ replaySha256: z.string(), tracks: inventory })
      .parse(decode(bytes));
    expect(expected.replaySha256).toBe(descriptor.sha256);
    if (actual.inventoryTracks === undefined)
      throw new Error("Direct worker response is missing champion inventory.");
    expect(tracksHash(actual.inventoryTracks)).toBe(
      tracksHash(expected.tracks),
    );
  }
  if (directChampionExperience) {
    const [bytes] = await Promise.all([
      readOracle(oracleRoot, "scout-8428-experience-tracks.json"),
      readOracle(oracleRoot, "scout-8428-experience-native-proof.json"),
      readOracle(oracleRoot, "scout-8428-experience-cap-proof.json"),
    ]);
    const expected = z
      .object({ replaySha256: z.string(), tracks: experience })
      .parse(decode(bytes));
    expect(expected.replaySha256).toBe(descriptor.sha256);
    if (actual.experienceTracks === undefined)
      throw new Error("Direct worker response is missing champion experience.");
    expect(tracksHash(actual.experienceTracks)).toBe(
      tracksHash(expected.tracks),
    );
  } else {
    expect(actual.experienceTracks).toBeUndefined();
  }
  const cueCount = await verifyRecordedAnimationResponse(
    actual,
    fixture,
    oracleRoot,
  );
  return { cueCount, terrainVisibility };
}

async function verifyDirectTerrainVisibility(
  fixture: {
    descriptor: { sha256: string };
    directTerrainVisibility: boolean;
    terrainVisibility:
      z.infer<typeof RecordedTerrainVisibilitySchema> | undefined;
  },
  actual: z.infer<typeof RecordedTerrainVisibilitySchema> | undefined,
  oracleRoot: string,
) {
  if (!fixture.directTerrainVisibility) {
    expect(actual).toBeUndefined();
    return fixture.terrainVisibility;
  }
  const bytes = await readOracle(
    oracleRoot,
    "exact-terrain-fog-agent/exact-8428-rift-terrain-windowed-receipt.json",
  );
  const { replaySha256, unresolvedMeshControllerIds, ...expected } =
    RecordedTerrainVisibilitySchema.extend({
      replaySha256: z.string(),
      unresolvedMeshControllerIds: z.array(z.number().int().positive()),
    }).parse(decode(bytes));
  expect(replaySha256).toBe(fixture.descriptor.sha256);
  expect(actual).toEqual({
    ...expected,
    omittedMeshControllerIds: unresolvedMeshControllerIds,
  });
  return actual;
}

async function verifyDirectTeamVision(
  fixture: {
    directTeamVision: boolean;
    directNeutralModels: [string, number][] | undefined;
    directNeutralCamps: boolean;
    descriptor: { sha256: string };
  },
  tracks: z.infer<typeof teamVision> | undefined,
  oracleRoot: string,
  neutralContexts: number[],
) {
  if (!fixture.directTeamVision) {
    expect(tracks).toBeUndefined();
    return;
  }
  const bytes = await readOracle(
    oracleRoot,
    fixture.directNeutralModels === undefined
      ? "scout-8428-v21-team-vision-tracks.json"
      : "scout-8428-v30-neutral-visibility-native-tracks.json",
  );
  const expected = z
    .object({ replaySha256: z.string(), tracks: teamVision })
    .parse(decode(bytes));
  expect(expected.replaySha256).toBe(fixture.descriptor.sha256);
  let expectedTracks = expected.tracks;
  if (fixture.directNeutralCamps) {
    const bound = new Set([
      ...expectedTracks.map(({ context }) => context),
      ...neutralContexts,
    ]);
    const campVision = z
      .object({ replaySha256: z.string(), tracks: teamVision })
      .parse(
        decode(
          await readOracle(
            oracleRoot,
            "scout-8428-camp-vision-native-tracks.json",
          ),
        ),
      );
    expect(campVision.replaySha256).toBe(fixture.descriptor.sha256);
    expectedTracks = campVision.tracks.filter(({ context }) =>
      bound.has(context),
    );
    expect(expectedTracks).toHaveLength(bound.size);
  }
  expect(tracks?.toSorted((a, b) => a.context - b.context)).toEqual(
    expectedTracks.toSorted((a, b) => a.context - b.context),
  );
}

async function verifyDirectPlayerState(
  actual: unknown,
  enabled: boolean,
  oracleRoot: string,
  replaySha256: string,
) {
  if (enabled) {
    const expected = z
      .strictObject({
        replaySha256: z.string(),
        recordedPlayerState: z.strictObject({
          playerState: z.unknown(),
          championEliminations: z.array(z.unknown()),
          winningTeam: z.number().optional(),
        }),
      })
      .parse(
        decode(
          await readOracle(
            oracleRoot,
            "scout-8428-recorded-player-state-oracle.json",
          ),
        ),
      );
    expect(expected.replaySha256).toBe(replaySha256);
    expect(actual).toEqual(expected.recordedPlayerState);
  } else {
    expect(actual).toBeUndefined();
  }
}

export async function readDirectAnnouncerWorker(page: Page) {
  const { announcerCues, requestKeys } = reply
    .pick({ announcerCues: true, requestKeys: true })
    .parse(await readDirectWorkerReply(page, ["announcerCues", "requestKeys"]));
  expect(requestKeys).toContain("announcerEvents");
  return announcerCues;
}
