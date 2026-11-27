import { z } from "zod";
import { parseReplaySceneTrace } from "@scout-for-lol/replay/scene";
import type {
  ReplayPlayerScore,
  ReplayScoreboard,
} from "@scout-for-lol/replay/types";
import {
  ChampionAnimationCuesSchema,
  loadRecordedChampionAnimations,
} from "./scout-terrain-animations.ts";
import {
  championExperienceSceneSchema,
  createChampionHealthTracksSchema,
  createChampionResourceTracksSchema,
  effectiveChampionLevelCap,
  readChampionExperienceTracks,
  readChampionHealthTracks,
  readChampionResourceTracks,
} from "./scout-terrain-champion-stats.ts";
import {
  replayInventorySceneSchema,
  type ReplayInventoryPoints,
} from "./scout-terrain-inventory.ts";
import {
  currentTerrainPositionBuild,
  terrainPositionBuild,
  terrainPositionProtocol,
} from "./tools/research/native-terrain-byte-codecs.mjs";
import { createNavgridGroundHeight } from "./tools/research/native-terrain-ground.mjs";
import { sampleNativeTerrainMotion } from "./tools/research/native-terrain-motion-sample.mjs";
import { sampleNativeTerrainWorldUnits } from "./tools/research/native-terrain-world-unit-sample.mjs";
import {
  prepareTeamVision,
  TeamVisionSchema,
} from "./scout-terrain-team-vision.ts";

type ReadTerrainAsset = (path: string) => Promise<ArrayBuffer>;

export function parseTerrainJson(bytes: ArrayBuffer): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function lastAtOrBefore<T>(
  points: readonly T[],
  timeSeconds: number,
  timeOf: (point: T) => number,
): T | undefined {
  let lower = 0;
  let upper = points.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (timeOf(points[middle]!) <= timeSeconds) lower = middle + 1;
    else upper = middle;
  }
  return points[lower - 1];
}

const teamId = z.union([z.literal(100), z.literal(200)]);
const position = z.tuple([z.number(), z.number(), z.number()]);
const bounds = z.object({ min: position, max: position });
const participantId = z.number().int().nonnegative();
const count = z.number().int().nonnegative().nullable();
const playerState = z.object({
  participantId,
  kills: count,
  deaths: count,
  assists: count,
  level: z.number().int().positive().nullable(),
  alive: z.boolean().nullable(),
});
const terrainFrame = z.object({
  timeSeconds: z.number().nonnegative(),
  markers: z.array(
    z.object({
      participantId: z.number().int().nonnegative(),
      position,
      teamId,
    }),
  ),
  worldUnits: z
    .array(
      z.object({
        participantId,
        position,
        context: participantId.optional(),
        teamId: teamId.optional(),
      }),
    )
    .optional(),
});
const modelBinding = z.object({
  participantId,
  skinScale: z.number().positive(),
  hiddenRanges: z.array(z.string().min(1)),
  url: z
    .string()
    .regex(
      /^\/(?:champion|structure|nexus|inhibitor|world-unit)-models\/[a-f0-9]{64}\.glb$/,
    ),
});
const worldModelInstance = z.object({
  context: z.number().int().positive(),
  participantId,
  position,
  basis: z.array(z.number()).length(9),
});
const recordedStructureLoss = z.object({
  context: z.number().int().positive(),
  timeSeconds: z.number().positive(),
});
const ChampionHealthTracksSchema = createChampionHealthTracksSchema(z);
const ChampionResourceTracksSchema = createChampionResourceTracksSchema(z);
const WorkerChampionStatsSchema = z.strictObject({
  championHealthTracks: ChampionHealthTracksSchema,
  championResourceTracks: ChampionResourceTracksSchema,
});
const TerrainSceneFields = z.object({
  identity: z.object({
    build: z.enum([terrainPositionBuild, currentTerrainPositionBuild]),
    protocol: z.literal(terrainPositionProtocol),
    durationMilliseconds: z.number().int().positive(),
    participantCount: z.literal(10),
    replaySha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  winningTeam: teamId.optional(),
  teamVision: TeamVisionSchema.optional(),
  championAnimationCues: ChampionAnimationCuesSchema.optional(),
  championHealthTracks: ChampionHealthTracksSchema.optional(),
  championResourceTracks: ChampionResourceTracksSchema.optional(),
  championExperience: championExperienceSceneSchema(z).optional(),
  championInventory: replayInventorySceneSchema(z).optional(),
  championEliminations: z
    .array(
      z.strictObject({
        timeSeconds: z.number().nonnegative(),
        killerId: participantId,
        victimId: participantId,
      }),
    )
    .optional(),
  mapBounds: bounds,
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
  staticMesh: z.object({
    exportedMeshes: z.number().int().positive(),
    sourceMeshCount: z.number().int().positive(),
    meshTriangles: z.number().int().positive(),
  }),
  turretLosses: z
    .array(
      z.object({
        context: z.number().int().nonnegative(),
        timeSeconds: z.number().nonnegative(),
        worldPosition: position,
      }),
    )
    .optional(),
  dragonKills: z
    .array(
      z.object({
        timeSeconds: z.number().nonnegative(),
        actorContext: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  neutralObjectiveKills: z
    .array(
      z.object({
        timeSeconds: z.number().positive(),
        actorContext: z.number().int().positive(),
        modelId: z.enum(["sru_baron", "sru_riftherald"]),
        position: position.optional(),
      }),
    )
    .optional(),
  inhibitorLosses: z
    .array(z.object({ timeSeconds: z.number().positive() }))
    .optional(),
  playerState: z
    .object({
      checkpoints: z
        .array(
          z.object({
            timeSeconds: z.number().nonnegative(),
            players: z.array(playerState).length(10),
          }),
        )
        .nonempty(),
    })
    .optional(),
  participants: z
    .array(
      z.object({
        participantId: z.number().int().nonnegative(),
        name: z.string(),
        championName: z.string(),
        teamId,
      }),
    )
    .length(10),
  frames: z.array(terrainFrame),
  decodedPositionFrames: z.array(terrainFrame).optional(),
  motion: z.unknown().optional(),
  minimap: z.literal(true).optional(),
  terrainMaterials: z
    .object({
      texturedTriangles: z.number().int().positive(),
      bindings: z.array(
        z.object({
          material: z.string().min(1),
          url: z.string().regex(/^\/map-textures\/[a-f0-9]{64}\.png$/),
          alphaTest: z.number().min(0).max(1),
          sourceAlphaBlend: z.literal(true).optional(),
          width: z.number().int().min(1).max(512),
          height: z.number().int().min(1).max(512),
        }),
      ),
    })
    .optional(),
  terrainVisibility: z
    .object({
      tracks: z
        .array(
          z.object({
            controllerId: z.number().int().positive(),
            points: z
              .array(z.tuple([z.number().nonnegative(), z.boolean()]))
              .nonempty(),
          }),
        )
        .nonempty(),
      unresolvedMeshControllerIds: z.array(z.number().int().positive()),
      missingReplacementMeshControllerIds: z.array(z.number().int().positive()),
      omittedMeshControllerIds: z.array(z.number().int().positive()).optional(),
      unresolvedWindows: z
        .array(
          z.object({
            controllerId: z.number().int().positive(),
            startSeconds: z.number().nonnegative(),
            endSeconds: z.number().positive(),
          }),
        )
        .optional(),
    })
    .optional(),
  championModels: z
    .object({
      bindings: z
        .array(modelBinding.extend({ skinId: z.number().int().nonnegative() }))
        .length(10),
    })
    .optional(),
  structureModels: z
    .object({
      bindings: z.array(modelBinding).min(1),
      instances: z
        .array(
          worldModelInstance.extend({
            destroyedAtSeconds: z.number().nonnegative().nullable(),
          }),
        )
        .min(1)
        .max(22),
      omittedContexts: z.array(participantId).optional(),
    })
    .refine(({ instances, omittedContexts }) => {
      const contexts = [
        ...instances.map(({ context }) => context),
        ...(omittedContexts ?? []),
      ];
      return contexts.length === 22 && new Set(contexts).size === 22;
    }, "Expected 22 accounted-for turret contexts")
    .optional(),
  nexusModels: z
    .object({
      bindings: z.array(modelBinding).length(2),
      instances: z.array(worldModelInstance).length(2),
      cue: recordedStructureLoss.optional(),
      terminalLoss: recordedStructureLoss.optional(),
    })
    .refine(({ cue, terminalLoss, instances }) => {
      const loss = terminalLoss ?? cue;
      return (
        loss !== undefined &&
        (cue === undefined || terminalLoss === undefined) &&
        instances.some(({ context }) => context === loss.context)
      );
    }, "Expected one loss witness for a rendered Nexus")
    .optional(),
  inhibitorModels: z
    .object({
      bindings: z.array(modelBinding).length(2),
      instances: z
        .array(
          worldModelInstance.extend({
            teamId,
            destroyedAtSeconds: z.number().positive().nullable(),
          }),
        )
        .min(1)
        .max(6),
      omittedContexts: z.array(participantId).optional(),
    })
    .refine(({ instances, omittedContexts }) => {
      const contexts = [
        ...instances.map(({ context }) => context),
        ...(omittedContexts ?? []),
      ];
      return contexts.length === 6 && new Set(contexts).size === 6;
    }, "Expected six accounted-for inhibitor contexts")
    .optional(),
  worldUnitModels: z
    .object({
      bindings: z.array(modelBinding).nonempty(),
      instances: z
        .array(
          z.object({
            context: z.number().int().positive(),
            participantId,
            teamId: teamId.optional(),
            creationTimeSeconds: z.number().nonnegative(),
            killTimeSeconds: z.number().positive(),
            paths: z
              .array(
                z.object({
                  timeSeconds: z.number().nonnegative(),
                  endTimeSeconds: z.number().nonnegative(),
                  points: z.array(z.tuple([z.number(), z.number()])).nonempty(),
                  speeds: z
                    .array(
                      z.object({
                        timeSeconds: z.number().nonnegative(),
                        distance: z.literal(0),
                        speed: z.number().nonnegative(),
                      }),
                    )
                    .length(1),
                }),
              )
              .nonempty(),
          }),
        )
        .nonempty(),
    })
    .optional(),
  workerMotion: z
    .object({
      waypointOrigin: z.tuple([z.number().int(), z.number().int()]),
      allowCurrentBuild: z.literal(true).optional(),
      decodeChampionStats: z.literal(true).optional(),
    })
    .optional(),
  navgrid: z
    .object({
      columns: z.number().int().positive(),
      rows: z.number().int().positive(),
      step: z.tuple([z.number().positive(), z.number().positive()]),
    })
    .optional(),
});
export const SceneSchema = TerrainSceneFields.refine(
  (scene) =>
    scene.workerMotion?.decodeChampionStats !== true ||
    (scene.identity.build === currentTerrainPositionBuild &&
      scene.workerMotion.allowCurrentBuild === true &&
      scene.motion === undefined &&
      scene.championHealthTracks === undefined &&
      scene.championResourceTracks === undefined),
  {
    path: ["workerMotion", "decodeChampionStats"],
    message:
      "Replay-derived champion stats require current worker motion without embedded motion or stat tracks.",
  },
);
export type TerrainScene = z.infer<typeof SceneSchema>;
type TerrainFrame = TerrainScene["frames"][number];
type MaterialBindings = Map<
  string,
  {
    image: ImageBitmap;
    alphaTest: number;
    sourceAlphaBlend: boolean;
  }
>;
type ModelBindings = z.infer<typeof modelBinding>[];
type LoadedChampionModels = Map<number, unknown>;
export type RendererModule = {
  loadChampionModels: (
    bindings: ModelBindings,
    signal: AbortSignal,
    read: ReadTerrainAsset,
  ) => Promise<LoadedChampionModels>;
  closeChampionModelImages: (models: LoadedChampionModels) => void;
  createTerrainRenderer: (
    canvas: HTMLCanvasElement,
    metadata: unknown,
    bytes: ArrayBuffer,
    scene: TerrainScene,
    presentation?: {
      bindings?: MaterialBindings;
      championModels?: LoadedChampionModels;
      structureModels?: LoadedChampionModels;
      nexusModels?: LoadedChampionModels;
      inhibitorModels?: LoadedChampionModels;
      worldUnitModels?: LoadedChampionModels;
    },
  ) => {
    draw: (
      frame: TerrainFrame,
      angleDegrees: number,
      view: {
        focus?: z.infer<typeof position>;
        useFollowDefaults?: true;
        distance?: number;
        zoom?: number;
        championHealthAt?: (
          participantId: number,
          timeSeconds: number,
        ) =>
          | readonly [timeSeconds: number, current: number, max: number]
          | undefined;
        width: number;
        height: number;
        devicePixelRatio: number;
      },
    ) => void;
    dragFocus: (
      deltaX: number,
      deltaY: number,
    ) => { x: number; z: number; distance: number };
    dispose: () => void;
  };
};

async function loadTerrainBindings(
  terrainMaterials: TerrainScene["terrainMaterials"],
  read: ReadTerrainAsset,
) {
  if (terrainMaterials === undefined) return undefined;
  const images = new Map<string, Promise<ImageBitmap>>();
  async function closeImages() {
    for (const image of await Promise.allSettled(images.values())) {
      if (image.status === "fulfilled") image.value.close();
    }
  }
  try {
    const entries = await Promise.all(
      terrainMaterials.bindings.map(
        async ({
          url,
          material,
          alphaTest,
          sourceAlphaBlend,
          width,
          height,
        }) => {
          const imageKey =
            sourceAlphaBlend === true ? `${url}:straight-alpha` : url;
          if (!images.has(imageKey)) {
            images.set(
              imageKey,
              read(url).then((bytes) => {
                const blob = new Blob([bytes], { type: "image/png" });
                return sourceAlphaBlend === true
                  ? createImageBitmap(blob, { premultiplyAlpha: "none" })
                  : createImageBitmap(blob);
              }),
            );
          }
          const image = await images.get(imageKey);
          if (image?.width !== width || image.height !== height)
            throw new Error(
              "Terrain texture dimensions differ from the verified material.",
            );
          return [
            material,
            { image, alphaTest, sourceAlphaBlend: sourceAlphaBlend === true },
          ] as const;
        },
      ),
    );
    const bindings = new Map(entries);
    if (bindings.size !== entries.length)
      throw new Error("Duplicate terrain material.");
    return { bindings, closeImages };
  } catch (cause) {
    await closeImages();
    throw cause;
  }
}

const WorkerMotionResponse = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    frames: z.array(
      z.object({
        timeSeconds: z.number().nonnegative(),
        markers: z.array(
          z.object({ participantId, x: z.number(), z: z.number() }),
        ),
      }),
    ),
    motion: z.object({
      durationSeconds: z.number().positive(),
      unresolvedParticipants: z.number().int().nonnegative(),
      tracks: z.array(z.looseObject({ participantId })),
    }),
    championStats: WorkerChampionStatsSchema.optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

async function loadWorkerMotion(
  identity: TerrainScene["identity"],
  workerMotion: NonNullable<TerrainScene["workerMotion"]>,
  signal: AbortSignal,
  assets: TerrainMotionAssets,
) {
  const [replayBytes, decoderBytes] = await Promise.all([
    assets.replay(),
    assets.read("/replay-motion-decoder.bin"),
  ]);
  signal.throwIfAborted();
  const worker = await assets.worker();
  let cancel: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const result = await new Promise<z.infer<typeof WorkerMotionResponse>>(
      (resolve, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener("abort", cancel, { once: true });
        worker.addEventListener(
          "message",
          ({ data }) => {
            const parsed = WorkerMotionResponse.safeParse(data);
            if (parsed.success) resolve(parsed.data);
            else reject(new Error("Invalid replay motion worker result."));
          },
          { once: true },
        );
        worker.addEventListener(
          "error",
          ({ message }) =>
            reject(new Error(message || "Replay motion worker failed.")),
          { once: true },
        );
        worker.addEventListener(
          "messageerror",
          () =>
            reject(
              new Error("Could not read the replay motion worker result."),
            ),
          { once: true },
        );
        worker.postMessage(
          { identity, ...workerMotion, replayBytes, decoderBytes },
          [replayBytes, decoderBytes],
        );
      },
    );
    if (result.type === "error") throw new Error(result.message);
    if (
      (result.championStats !== undefined) !==
      (workerMotion.decodeChampionStats === true)
    )
      throw new Error(
        "Replay motion worker returned unexpected champion stats coverage.",
      );
    return result;
  } finally {
    if (cancel !== undefined) signal.removeEventListener("abort", cancel);
    worker.terminate();
  }
}

type TerrainMotionAssets = {
  read: ReadTerrainAsset;
  replay: () => Promise<ArrayBuffer>;
  worker: () => Promise<Worker>;
};

export async function loadSceneMotion(
  scene: TerrainScene,
  signal: AbortSignal,
  assets: TerrainMotionAssets,
) {
  if (scene.motion === undefined && scene.workerMotion === undefined)
    return { scene, heights: undefined };
  if (scene.navgrid === undefined)
    throw new Error("Replay motion is missing navigation terrain metadata.");
  const [heights, decoded] = await Promise.all([
    assets.read("/heights.bin").then((buffer) => new Float32Array(buffer)),
    scene.workerMotion === undefined
      ? undefined
      : loadWorkerMotion(scene.identity, scene.workerMotion, signal, assets),
  ]);
  if (decoded === undefined) return { scene, heights };
  const ground = createNavgridGroundHeight(
    scene.mapBounds,
    scene.navgrid,
    heights,
  );
  const teams = new Map(
    scene.participants.map((participant) => [
      participant.participantId,
      participant.teamId,
    ]),
  );
  const championStats = decoded.championStats;
  if (championStats !== undefined) {
    if (teams.size !== scene.identity.participantCount)
      throw new Error("Replay-derived champion stats require a unique roster.");
    readChampionHealthTracks(
      championStats.championHealthTracks,
      teams.keys(),
      scene.identity.durationMilliseconds,
    );
    readChampionResourceTracks(
      championStats.championResourceTracks,
      teams.keys(),
      scene.identity.durationMilliseconds,
    );
  }
  const decodedPositionFrames: TerrainFrame[] = decoded.frames
    .filter(({ markers }) => markers.length > 0)
    .map(({ timeSeconds, markers }) => ({
      timeSeconds,
      markers: markers.map(({ participantId, x, z }) => {
        const height = ground(x, z);
        const teamId = teams.get(participantId);
        if (height === null || teamId === undefined)
          throw new Error(
            "Decoded keyframe conflicts with the terrain or roster.",
          );
        return { participantId, position: [x, height, z], teamId };
      }),
    }));
  return {
    scene: {
      ...scene,
      motion: decoded.motion,
      decodedPositionFrames,
      ...(championStats === undefined
        ? {}
        : { ...championStats, workerMotion: undefined }),
    },
    heights,
  };
}

export function prepareScene(
  scene: TerrainScene,
  heights: Float32Array | undefined,
  inventoryPoints?: ReplayInventoryPoints,
) {
  const teams = new Map(
    scene.participants.map((participant) => [
      participant.participantId,
      participant.teamId,
    ]),
  );
  const captured = new Map(
    scene.frames
      .filter(({ markers }) => markers.length > 0)
      .map((frame) => [frame.timeSeconds, frame]),
  );
  const decoded = new Map<number, TerrainFrame>();
  let previousDecodedTime = -1;
  for (const frame of scene.decodedPositionFrames ?? []) {
    if (frame.timeSeconds <= previousDecodedTime || !frame.markers.length)
      throw new Error("Expected ordered, populated decoded position frames.");
    previousDecodedTime = frame.timeSeconds;
    if (!captured.has(frame.timeSeconds)) decoded.set(frame.timeSeconds, frame);
  }
  const merged = new Map(
    scene.frames.map((frame) => [frame.timeSeconds, frame]),
  );
  if (merged.size !== scene.frames.length)
    throw new Error("Duplicate captured replay time.");
  for (const [time, frame] of decoded) merged.set(time, frame);
  const durationSeconds = scene.identity.durationMilliseconds / 1000;
  for (const timeSeconds of [0, durationSeconds]) {
    if (!merged.has(timeSeconds))
      merged.set(timeSeconds, { timeSeconds, markers: [] });
  }
  const trace = parseReplaySceneTrace({
    durationSeconds,
    width: scene.mapBounds.max[0],
    height: scene.mapBounds.max[2],
    participants: scene.participants,
    frames: [...merged.values()]
      .sort((a, b) => a.timeSeconds - b.timeSeconds)
      .map(({ timeSeconds, markers }) => ({
        timeSeconds,
        actors: markers.map((marker) => {
          if (teams.get(marker.participantId) !== marker.teamId)
            throw new Error("Position marker team disagrees with the roster.");
          return {
            participantId: marker.participantId,
            x: marker.position[0],
            y: marker.position[2],
            visibleTo: [],
          };
        }),
        directedParticipantId: null,
      })),
  });
  const healthTracks =
    scene.championHealthTracks === undefined
      ? null
      : readChampionHealthTracks(
          scene.championHealthTracks,
          teams.keys(),
          scene.identity.durationMilliseconds,
        );
  const resourceTracks =
    scene.championResourceTracks === undefined
      ? null
      : readChampionResourceTracks(
          scene.championResourceTracks,
          teams.keys(),
          scene.identity.durationMilliseconds,
        );
  const experienceTracks =
    scene.championExperience === undefined
      ? undefined
      : readChampionExperienceTracks(
          scene.championExperience,
          teams.keys(),
          scene.identity.durationMilliseconds,
        );
  const dragons = new Map<number, string>();
  for (const { timeSeconds, actorContext } of scene.dragonKills ?? []) {
    const killer = trace.participants.find(
      ({ participantId }) => participantId === actorContext,
    );
    if (
      killer === undefined ||
      dragons.has(timeSeconds) ||
      timeSeconds > trace.durationSeconds
    )
      throw new Error(
        "Dragon kill could not be matched to a unique replay clock and participant.",
      );
    dragons.set(timeSeconds, killer.championName);
  }
  const inhibitorTimes = scene.inhibitorLosses?.map(
    ({ timeSeconds }) => timeSeconds,
  );
  if (
    inhibitorTimes?.some(
      (time, index, times) =>
        time > trace.durationSeconds || time <= (times[index - 1] ?? 0),
    )
  ) {
    throw new Error(
      "Recorded inhibitor losses disagree with the replay clock.",
    );
  }
  let previousTime = -1;
  const playerCheckpoints = scene.playerState?.checkpoints.map(
    ({ timeSeconds, players }) => {
      if (
        timeSeconds <= previousTime ||
        timeSeconds > trace.durationSeconds ||
        new Set(players.map(({ participantId }) => participantId)).size !==
          teams.size ||
        players.some(({ participantId }) => !teams.has(participantId))
      ) {
        throw new Error(
          "Replay player state disagrees with the roster or clock.",
        );
      }
      previousTime = timeSeconds;
      const sumKills = (team: 100 | 200) => {
        let total = 0;
        for (const { participantId, kills } of players) {
          if (teams.get(participantId) !== team) continue;
          if (kills === null) return null;
          total += kills;
        }
        return total;
      };
      const blueKills = sumKills(100);
      const redKills = sumKills(200);
      const scoreboard: ReplayScoreboard = Object.freeze({
        blueKills,
        redKills,
        winningTeam: null,
        players: Object.freeze(
          players.map(
            ({ participantId, kills, deaths, assists, level, alive }) =>
              Object.freeze({
                participantId,
                kills,
                deaths,
                assists,
                level,
                alive,
              }),
          ),
        ),
      });
      return {
        timeSeconds,
        teamKills: [blueKills, redKills],
        players: new Map(
          players.map((player) => [player.participantId, player]),
        ),
        scoreboard,
      };
    },
  );
  const lastScoreboard = playerCheckpoints?.at(-1)?.scoreboard;
  const finalScoreboard: ReplayScoreboard | undefined =
    scene.winningTeam === undefined
      ? lastScoreboard
      : Object.freeze({
          blueKills: lastScoreboard?.blueKills ?? null,
          redKills: lastScoreboard?.redKills ?? null,
          players: lastScoreboard?.players ?? Object.freeze([]),
          winningTeam: scene.winningTeam,
        });
  function playerCheckpointAt(timeSeconds: number) {
    if (playerCheckpoints === undefined) return undefined;
    return lastAtOrBefore(
      playerCheckpoints,
      timeSeconds,
      (point) => point.timeSeconds,
    );
  }
  function scoreboardAt(timeSeconds: number): ReplayScoreboard | undefined {
    const scoreboard =
      timeSeconds === durationSeconds
        ? finalScoreboard
        : playerCheckpointAt(timeSeconds)?.scoreboard;
    if (
      healthTracks === null &&
      resourceTracks === null &&
      experienceTracks === undefined &&
      inventoryPoints === undefined
    )
      return scoreboard;
    const players = new Map(
      scoreboard?.players.map((player) => [player.participantId, player]),
    );
    let updated = false;
    for (const participantId of teams.keys()) {
      const health = championHealthAt(participantId, timeSeconds);
      const tracks = resourceTracks?.get(participantId);
      const gold =
        tracks && lastAtOrBefore(tracks.gold, timeSeconds, ([time]) => time);
      const resource =
        tracks &&
        lastAtOrBefore(tracks.resource, timeSeconds, ([time]) => time);
      const experience = championExperienceAt(participantId, timeSeconds);
      const items = inventoryPoints?.get(participantId);
      const inventory =
        items && lastAtOrBefore(items, timeSeconds, ([time]) => time)?.[1];
      if (
        health === undefined &&
        gold === undefined &&
        resource === undefined &&
        experience === undefined &&
        inventory === undefined
      )
        continue;
      updated = true;
      const base: ReplayPlayerScore = players.get(participantId) ?? {
        participantId,
        kills: null,
        deaths: null,
        assists: null,
        level: null,
      };
      players.set(
        participantId,
        Object.freeze({
          ...base,
          ...(health === undefined
            ? {}
            : {
                health: Object.freeze({ current: health[1], max: health[2] }),
              }),
          ...(gold === undefined ? {} : { gold: gold[1] }),
          ...(experience ?? {}),
          ...(inventory === undefined ? {} : { inventory }),
          ...(resource === undefined || resource[2] === 0
            ? {}
            : {
                resource: Object.freeze({
                  current: resource[1],
                  max: resource[2],
                }),
              }),
        }),
      );
    }
    if (!updated) return scoreboard;
    return Object.freeze({
      blueKills: scoreboard?.blueKills ?? null,
      redKills: scoreboard?.redKills ?? null,
      winningTeam: scoreboard?.winningTeam ?? null,
      players: Object.freeze([...players.values()]),
    });
  }
  function championHealthAt(participantId: number, timeSeconds: number) {
    const points = healthTracks?.get(participantId)?.points;
    return points && lastAtOrBefore(points, timeSeconds, ([time]) => time);
  }
  function championExperienceAt(participantId: number, timeSeconds: number) {
    const track = experienceTracks?.get(participantId);
    const point =
      track && lastAtOrBefore(track.points, timeSeconds, ([time]) => time);
    if (point === undefined || scene.championExperience === undefined)
      return undefined;
    const [, total, level] = point;
    const { thresholds } = scene.championExperience;
    const cap = effectiveChampionLevelCap(
      lastAtOrBefore(track.levelCaps, timeSeconds, ([time]) => time)?.[1],
    );
    const previous = thresholds[level - 2] ?? 0;
    const next = thresholds[level - 1];
    return {
      level,
      experience: Object.freeze({
        total,
        ...(next === undefined || level >= cap
          ? {}
          : {
              progress: Object.freeze({
                current: Math.fround(total - previous),
                max: Math.fround(next - previous),
              }),
            }),
      }),
    };
  }
  const motion = scene.motion;
  const groundHeight =
    motion === undefined
      ? undefined
      : createNavgridGroundHeight(scene.mapBounds, scene.navgrid, heights);
  const { min, max } = scene.mapBounds;
  const mapWidth = max[0] - min[0];
  const mapDepth = max[2] - min[2];
  function mapPointAt([x, , z]: z.infer<typeof position>): [number, number] {
    return [(x - min[0]) / mapWidth, (max[2] - z) / mapDepth];
  }
  const turrets = scene.structureModels?.instances.map(
    ({ context, position, destroyedAtSeconds }) => {
      const point = mapPointAt(position);
      if (point.some((coordinate) => coordinate < 0 || coordinate > 1))
        throw new Error("Turret position is outside the minimap.");
      return { context, point, destroyedAtSeconds };
    },
  );
  const turretLosses = (turrets ?? [])
    .flatMap(({ context, point, destroyedAtSeconds }) =>
      destroyedAtSeconds === null
        ? []
        : [{ context, point, timeSeconds: destroyedAtSeconds }],
    )
    .sort((a, b) => a.timeSeconds - b.timeSeconds);
  function cameraGroundAt([u, v]: [number, number]): [number, number, number] {
    const x = min[0] + u * mapWidth;
    const z = min[2] + (1 - v) * mapDepth;
    const y = groundHeight?.(x, z);
    if (y === null || y === undefined)
      throw new Error("Free camera target is outside the map.");
    return [x, y, z];
  }
  let cachedWorld:
    { timeSeconds: number; units: TerrainFrame["worldUnits"] } | undefined;
  function worldUnitsAt(timeSeconds: number): TerrainFrame["worldUnits"] {
    if (scene.worldUnitModels === undefined) return undefined;
    if (cachedWorld?.timeSeconds === timeSeconds) return cachedWorld.units;
    if (groundHeight === undefined)
      throw Error(
        "World unit rendering requires the verified Map11 ground surface",
      );
    const units = sampleNativeTerrainWorldUnits(
      scene.worldUnitModels.instances,
      timeSeconds,
      groundHeight,
    );
    cachedWorld = { timeSeconds, units };
    return units;
  }
  let cachedFrame: TerrainFrame | undefined;
  function positionsAt(timeSeconds: number): TerrainFrame {
    if (cachedFrame?.timeSeconds === timeSeconds) return cachedFrame;
    const observed = captured.get(timeSeconds) ?? decoded.get(timeSeconds);
    if (observed !== undefined) {
      cachedFrame = observed;
      return observed;
    }
    const markers: TerrainFrame["markers"] = [];
    if (groundHeight !== undefined) {
      const sample: {
        markers: { participantId: number; x: number; z: number }[];
      } = sampleNativeTerrainMotion(motion, timeSeconds);
      for (const { participantId, x, z } of sample.markers) {
        const teamId = teams.get(participantId);
        if (teamId === undefined)
          throw new Error("Motion marker has no participant.");
        const height = groundHeight(x, z);
        if (height !== null)
          markers.push({ participantId, position: [x, height, z], teamId });
      }
    }
    cachedFrame = { timeSeconds, markers };
    return cachedFrame;
  }
  let livingFrame: TerrainFrame | undefined;
  function livingChampionsAt(timeSeconds: number) {
    if (livingFrame?.timeSeconds === timeSeconds) return livingFrame.markers;
    const frame = positionsAt(timeSeconds);
    const players = playerCheckpointAt(timeSeconds)?.players;
    livingFrame =
      players === undefined
        ? frame
        : {
            timeSeconds,
            markers: frame.markers.filter(
              ({ participantId }) =>
                players.get(participantId)?.alive !== false,
            ),
          };
    return livingFrame.markers;
  }
  const visibleTo =
    scene.teamVision === undefined
      ? undefined
      : prepareTeamVision(scene.teamVision, trace.durationSeconds, [
          ...scene.participants.map(({ participantId }) => participantId),
          ...[
            scene.worldUnitModels,
            scene.structureModels,
            scene.inhibitorModels,
            scene.nexusModels,
          ].flatMap(
            (models) => models?.instances.map(({ context }) => context) ?? [],
          ),
        ]);
  function sampleFrame(timeSeconds: number) {
    return {
      timeSeconds,
      directedParticipantId: null,
      actors: livingChampionsAt(timeSeconds).map(
        ({ participantId, position }) => ({
          participantId,
          x: position[0],
          y: position[2],
          visibleTo: visibleTo?.(participantId, timeSeconds) ?? [],
        }),
      ),
    };
  }
  return {
    scene,
    trace,
    captured,
    decoded,
    positionsAt,
    livingChampionsAt,
    worldUnitsAt,
    sampleFrame,
    visibleTo,
    cameraGroundAt,
    mapPointAt,
    turrets,
    turretLosses,
    dragons,
    inhibitorTimes,
    playerCheckpoints,
    scoreboardAt,
    championHealthAt: healthTracks === null ? undefined : championHealthAt,
  };
}

export async function loadRenderer(
  canvas: HTMLCanvasElement,
  scene: TerrainScene,
  signal: AbortSignal,
  read: ReadTerrainAsset,
  render: RendererModule,
) {
  const [metadata, bytes, animationPalettesAt] = await Promise.all([
    read("/map.json").then(parseTerrainJson),
    read("/map.bin"),
    scene.championAnimationCues === undefined
      ? undefined
      : loadRecordedChampionAnimations(
          scene.championAnimationCues,
          scene.identity.durationMilliseconds / 1000,
          read,
        ),
  ]);
  signal.throwIfAborted();
  const materials = await loadTerrainBindings(scene.terrainMaterials, read);
  let renderer: ReturnType<RendererModule["createTerrainRenderer"]>;
  let championModels: LoadedChampionModels | undefined;
  let structureModels: LoadedChampionModels | undefined;
  let nexusModels: LoadedChampionModels | undefined;
  let inhibitorModels: LoadedChampionModels | undefined;
  let worldUnitModels: LoadedChampionModels | undefined;
  try {
    if (scene.championModels !== undefined)
      championModels = await render.loadChampionModels(
        scene.championModels.bindings,
        signal,
        read,
      );
    if (scene.structureModels !== undefined)
      structureModels = await render.loadChampionModels(
        scene.structureModels.bindings,
        signal,
        read,
      );
    if (scene.nexusModels !== undefined)
      nexusModels = await render.loadChampionModels(
        scene.nexusModels.bindings,
        signal,
        read,
      );
    if (scene.inhibitorModels !== undefined)
      inhibitorModels = await render.loadChampionModels(
        scene.inhibitorModels.bindings,
        signal,
        read,
      );
    if (scene.worldUnitModels !== undefined)
      worldUnitModels = await render.loadChampionModels(
        scene.worldUnitModels.bindings,
        signal,
        read,
      );
    signal.throwIfAborted();
    renderer = render.createTerrainRenderer(canvas, metadata, bytes, scene, {
      bindings: materials?.bindings,
      championModels,
      structureModels,
      nexusModels,
      inhibitorModels,
      worldUnitModels,
      animationPalettesAt,
    });
  } finally {
    if (championModels !== undefined)
      render.closeChampionModelImages(championModels);
    if (structureModels !== undefined)
      render.closeChampionModelImages(structureModels);
    if (nexusModels !== undefined) render.closeChampionModelImages(nexusModels);
    if (inhibitorModels !== undefined)
      render.closeChampionModelImages(inhibitorModels);
    if (worldUnitModels !== undefined)
      render.closeChampionModelImages(worldUnitModels);
    await materials?.closeImages();
  }
  return renderer;
}
