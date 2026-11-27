import path from "node:path";
import { z } from "zod";
import { PublicReplayDescriptorSchema } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { replayFixture } from "#src/lib/replay/replay-fixture.ts";
import { LocalScoutTerrainManifestSchema } from "./local-scout-terrain-manifest.ts";
import { RecordedTerrainVisibilitySchema } from "./proof/terrain-visibility-schema.ts";

const uploadOrigin = Bun.env["SCOUT_REPLAY_E2E_BACKEND_ORIGIN"];
const uploadedReplayId = Bun.env["SCOUT_REPLAY_E2E_BACKEND_REPLAY_ID"];
if ((uploadOrigin === undefined) !== (uploadedReplayId === undefined))
  throw new Error(
    "Set both the loopback replay backend origin and the uploaded replay ID.",
  );
const replayId =
  uploadedReplayId === undefined
    ? replayFixture.replayId
    : z.uuid().parse(uploadedReplayId);
export const replayPath = `/app/replays/${replayId}`;
export const apiPath = `/api/replays/${replayId}`;
export const contentPath = `${apiPath}/content`;
export const packagePrefix = "/local-replay-packages/";

const backend = uploadOrigin === undefined ? undefined : new URL(uploadOrigin);
if (
  backend !== undefined &&
  (backend.protocol !== "http:" ||
    backend.hostname !== "127.0.0.1" ||
    backend.port === "" ||
    backend.href !== `${backend.origin}/`)
)
  throw new Error(
    "The recorded backend must be a plain IPv4 loopback HTTP origin with an explicit port.",
  );

export async function fetchRecordedBackend(
  pathname: string,
  request?: Request,
) {
  if (backend === undefined) return;
  if (![apiPath, `${apiPath}/timeline`, contentPath].includes(pathname))
    throw new Error(
      "This replay path does not belong to the recorded backend.",
    );
  const headers = new Headers();
  for (const name of ["range", "if-range"]) {
    const value = request?.headers.get(name);
    if (value !== null && value !== undefined) headers.set(name, value);
  }
  return fetch(new URL(pathname, backend), {
    headers,
    method: request?.method ?? "GET",
    redirect: "error",
  });
}

export function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

const SceneIdentitySchema = z.object({
  followCameraDefaults: z
    .object({
      verticalFovDegrees: z.literal(40),
      nearClip: z.literal(50),
      pitchDegrees: z.literal(56),
      eyeDistance: z.literal(2306.10546875),
      farClipping: z
        .object({
          base: z.literal(10_000),
          configuredDistance: z.literal(2250),
        })
        .optional(),
    })
    .optional(),
  terrainMaterials: z
    .object({
      bindings: z.array(
        z.object({
          material: z.string(),
          sourceAlphaBlend: z.literal(true).optional(),
        }),
      ),
    })
    .optional(),
  terrainVisibility: RecordedTerrainVisibilitySchema.optional(),
  teamVision: z.array(z.unknown()).optional(),
  inhibitorModels: z
    .object({
      instances: z.array(
        z.object({
          position: z.tuple([z.number(), z.number(), z.number()]),
          inactiveRanges: z
            .array(
              z.tuple([
                z.number().nonnegative(),
                z.number().positive().nullable(),
              ]),
            )
            .optional(),
        }),
      ),
    })
    .optional(),
  championAnimationCues: z.array(z.unknown()).optional(),
  championHealthTracks: z.array(z.unknown()).optional(),
  championResourceTracks: z.array(z.unknown()).optional(),
  workerMotion: z
    .object({
      decodeChampionStats: z.literal(true).optional(),
      decodeChampionInventory: z.literal(true).optional(),
      decodeChampionExperience: z.literal(true).optional(),
      championAnimationCatalog: z.array(z.unknown()).nonempty().optional(),
      terrainControllerGraph: z.object({}).optional(),
      laneMinionCatalog: z
        .object({
          models: z.array(
            z.tuple([z.string(), z.number().int().nonnegative()]),
          ),
        })
        .optional(),
      neutralObjectiveModels: z
        .array(z.tuple([z.string(), z.number().int().nonnegative()]))
        .optional(),
      decodeTeamVision: z.literal(true).optional(),
      announcerEvents: z
        .array(
          z.tuple([
            z.number().int().nonnegative(),
            z.number().int().positive(),
          ]),
        )
        .nonempty()
        .optional(),
    })
    .optional(),
  championInventory: z.object({ tracks: z.array(z.unknown()) }).optional(),
  championInventoryItems: z.array(z.unknown()).nonempty().optional(),
  championExperience: z
    .object({ thresholds: z.array(z.number()), tracks: z.array(z.unknown()) })
    .optional(),
  championExperienceThresholds: z
    .array(z.number().positive())
    .nonempty()
    .optional(),
  identity: z.object({
    replaySha256: z.string(),
    build: z.string(),
    protocol: z.string(),
    durationMilliseconds: z.number().int().positive(),
    participantCount: z.literal(10),
  }),
});

async function readUploadedReplay(
  expected: Pick<
    z.infer<typeof PublicReplayDescriptorSchema>,
    "bytes" | "sha256" | "gameBuild" | "protocol" | "durationSeconds"
  >,
) {
  const upstream = await fetchRecordedBackend(apiPath);
  if (upstream === undefined) return;
  if (!upstream.ok)
    throw new Error(
      `The recorded upload descriptor returned HTTP ${String(upstream.status)}.`,
    );
  const uploaded = PublicReplayDescriptorSchema.parse(await upstream.json());
  if (
    uploaded.replayId !== replayId ||
    uploaded.matchId === null ||
    uploaded.bytes !== expected.bytes ||
    uploaded.sha256 !== expected.sha256 ||
    uploaded.gameBuild !== expected.gameBuild ||
    uploaded.protocol !== expected.protocol ||
    uploaded.durationSeconds !== expected.durationSeconds
  )
    throw new Error(
      "The uploaded replay does not match the recorded playback fixture.",
    );
  return uploaded;
}

function championCapabilities({
  workerMotion,
  championHealthTracks,
  championResourceTracks,
  championInventory,
  championInventoryItems,
  championExperience,
  championExperienceThresholds,
  championAnimationCues,
}: z.infer<typeof SceneIdentitySchema>) {
  const directChampionStats = workerMotion?.decodeChampionStats === true;
  const directChampionInventory =
    workerMotion?.decodeChampionInventory === true;
  const directChampionExperience =
    workerMotion?.decodeChampionExperience === true;
  const directChampionAnimation =
    workerMotion?.championAnimationCatalog !== undefined;
  if (directChampionAnimation && championAnimationCues !== undefined)
    throw new Error(
      "Direct worker animation requires a scene without baked cues.",
    );
  if (
    directChampionExperience
      ? championExperience !== undefined ||
        championExperienceThresholds === undefined
      : championExperienceThresholds !== undefined
  )
    throw new Error(
      "Recorded scene has inconsistent worker experience inputs.",
    );
  if (
    directChampionInventory
      ? championInventory !== undefined || championInventoryItems === undefined
      : championInventoryItems !== undefined
  )
    throw new Error("Recorded scene has inconsistent worker inventory inputs.");
  if (
    directChampionStats &&
    (championHealthTracks !== undefined || championResourceTracks !== undefined)
  )
    throw new Error(
      "Direct worker stats require a scene without baked champion stat tracks.",
    );
  return {
    directChampionObservations: [
      directChampionStats,
      directChampionInventory,
      directChampionExperience,
      directChampionAnimation,
    ].includes(true),
    directChampionAnimation,
    directChampionStats,
    directChampionExperience,
    championExperience:
      directChampionExperience || championExperience !== undefined,
    championHealth: directChampionStats || championHealthTracks !== undefined,
    championResources:
      directChampionStats || championResourceTracks !== undefined,
    championInventory:
      directChampionInventory || championInventory !== undefined,
    directChampionInventory,
  };
}

function workerCapabilities({
  workerMotion,
  terrainVisibility,
  teamVision,
}: z.infer<typeof SceneIdentitySchema>) {
  const directTerrainVisibility =
    workerMotion?.terrainControllerGraph !== undefined;
  if (directTerrainVisibility && terrainVisibility !== undefined)
    throw new Error(
      "Replay-derived terrain visibility cannot use prepared tracks.",
    );
  const directTeamVision = workerMotion?.decodeTeamVision === true;
  if (directTeamVision && teamVision !== undefined)
    throw new Error("Direct team vision requires a scene without baked masks.");
  return {
    unitVisibility: teamVision !== undefined || directTeamVision,
    directTeamVision,
    directTerrainVisibility,
    directLaneModels: workerMotion?.laneMinionCatalog?.models,
    directNeutralModels: workerMotion?.neutralObjectiveModels,
    directWorldObservations:
      directTerrainVisibility ||
      directTeamVision ||
      workerMotion?.laneMinionCatalog !== undefined ||
      workerMotion?.neutralObjectiveModels !== undefined,
  };
}

export async function readRecordedReplay() {
  const manifestPath = Bun.env["SCOUT_REPLAY_E2E_MANIFEST"] ?? "";
  const roflPath = Bun.env["SCOUT_REPLAY_E2E_ROFL"] ?? "";
  if (manifestPath === "" || roflPath === "")
    throw new Error("Set SCOUT_REPLAY_E2E_MANIFEST and SCOUT_REPLAY_E2E_ROFL.");

  const manifest = await Bun.file(manifestPath).bytes();
  const inventory = LocalScoutTerrainManifestSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifest)),
  );
  const rofl = await Bun.file(roflPath).bytes();
  const digest = sha256(rofl);
  const root = path.dirname(manifestPath);
  const scene = SceneIdentitySchema.parse(
    await Bun.file(path.join(root, "scene.json")).json(),
  );
  const {
    identity,
    followCameraDefaults,
    terrainMaterials,
    terrainVisibility,
    inhibitorModels,
    championAnimationCues,
  } = scene;
  if (
    identity.replaySha256 !== digest ||
    inventory.capabilities.replaySha256 !== digest ||
    identity.build !== inventory.gameBuild ||
    identity.protocol !== inventory.protocol
  ) {
    throw new Error(
      "The scene, manifest and ROFL must identify the same replay.",
    );
  }
  const capabilities = championCapabilities(scene);
  const { directWorldObservations, ...observationCapabilities } =
    workerCapabilities(scene);

  const packageDigest = sha256(manifest);
  const packageRoot = `${packagePrefix}${packageDigest}`;
  const packageUrl = `${packageRoot}/manifest.json`;
  const paths = new Map(
    inventory.files.map(({ path: asset }) => [
      `${packageRoot}/${asset}`,
      asset,
    ]),
  );
  const recordedIdentity = {
    bytes: rofl.byteLength,
    sha256: digest,
    gameBuild: inventory.gameBuild,
    protocol: inventory.protocol,
    durationSeconds: identity.durationMilliseconds / 1000,
  };
  const uploaded = await readUploadedReplay(recordedIdentity);
  return {
    root,
    paths,
    packageUrl,
    followCameraDefaults,
    inhibitorInstances: inhibitorModels?.instances,
    terrainMaterials,
    terrainVisibility,
    sourceAlphaBlendMaterials:
      terrainMaterials?.bindings
        .filter(({ sourceAlphaBlend }) => sourceAlphaBlend)
        .map(({ material }) => material.slice(material.lastIndexOf("/") + 1)) ??
      [],
    ...observationCapabilities,
    directReplayObservations:
      directWorldObservations || capabilities.directChampionObservations,
    announcerEvents: scene.workerMotion?.announcerEvents,
    announcerPreview: inventory.capabilities.announcerPreview,
    championAnimationCueCount: championAnimationCues?.length ?? 0,
    ...capabilities,
    descriptor: {
      ...replayFixture,
      matchId: null,
      platformId: null,
      gameId: "0",
      ...uploaded,
      ...recordedIdentity,
      playback: {
        status: "available",
        latestPatch: inventory.gameBuild.split(".").slice(0, 2).join("."),
        package: { url: packageUrl, sha256: packageDigest },
      },
    },
    manifestPath,
    roflPath,
    entrypoint: `${packageRoot}/${inventory.entrypoint}`,
  };
}
