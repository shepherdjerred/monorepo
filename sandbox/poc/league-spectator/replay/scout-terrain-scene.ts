import { z } from "zod";
import { sampleRecordedLaneMinionHealth } from "../../../../packages/scout-for-lol/packages/replay/src/observations/replay-lane-minion-health.mjs";
import { parseReplaySceneTrace } from "@scout-for-lol/replay/scene";
import type {
  ReplayPlayerScore,
  ReplayScoreboard,
} from "@scout-for-lol/replay/types";
import {
  AnnouncerCuesSchema,
  AnnouncerEventsSchema,
  validateAnnouncerCues,
} from "./scout-terrain-announcer.ts";
import {
  ChampionAnimationCatalogSchema,
  ChampionAnimationCuesSchema,
  ChampionAnimationModelCatalogSchema,
  ChampionAnimationWorkerCuesSchema,
  loadRecordedChampionAnimations,
  matchesRenderedAnimationCatalog,
  validateWorkerAnimationCues,
} from "./scout-terrain-animations.ts";
import {
  championExperienceSceneSchema,
  championExperienceThresholdsSchema,
  createChampionExperienceTracksSchema,
  createChampionHealthTracksSchema,
  createChampionResourceTracksSchema,
  effectiveChampionLevelCap,
  readChampionExperienceTracks,
  readChampionHealthTracks,
  readChampionResourceTracks,
} from "./scout-terrain-champion-stats.ts";
import {
  inventoryTracksSchema,
  replayInventorySceneSchema,
  replayItemAssetSchema,
  type ReplayInventoryPoints,
} from "./scout-terrain-inventory.ts";
import {
  NeutralCampCoverageSchema,
  NeutralCampModelIdSchema,
  NeutralObjectiveKillsSchema,
  NeutralObjectiveModelIdSchema,
  NeutralObjectiveWorkerKillsSchema,
} from "./scout-terrain-objectives.ts";
import {
  loadRecordedTerrainParticles,
  type LoadedTerrainParticles,
} from "./scout-terrain-particles.ts";
import {
  currentTerrainPositionBuild,
  terrainPositionBuild,
  terrainPositionProtocol,
} from "./tools/research/native-terrain-byte-codecs.mjs";
import { createNavgridGroundHeight } from "./tools/research/native-terrain-ground.mjs";
import { mayhemFlowMapControlSha256 } from "./tools/research/mayhem-flowmap-control-contract.mjs";
import { loadFlowMapControl } from "./tools/research/native-terrain-flowmap.mjs";
import { chaosTurretCollapseModelPath } from "./tools/research/native-terrain-turret-collapse-assets.mjs";
import { sampleNativeTerrainMotion } from "./tools/research/native-terrain-motion-sample.mjs";
import { sampleNativeTerrainWorldUnits } from "./tools/research/native-terrain-world-unit-sample.mjs";
import {
  prepareTeamVision,
  TeamVisionSchema,
} from "./scout-terrain-team-vision.ts";
import {
  ChaosTurretCollapseSchema,
  loadRecordedTurretCollapse,
} from "./scout-terrain-turret-collapse.ts";

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
const PlayerStateSchema = z.object({
  checkpoints: z
    .array(
      z.object({
        timeSeconds: z.number().nonnegative(),
        players: z.array(playerState).length(10),
      }),
    )
    .nonempty(),
});
const ChampionEliminationsSchema = z.array(
  z.strictObject({
    timeSeconds: z.number().nonnegative(),
    killerId: participantId,
    victimId: participantId,
  }),
);
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
const inhibitorModelBinding = modelBinding.extend({
  inactiveModelRange: z.literal("Destroyed").optional(),
});
const renderedTurretBinding = modelBinding.extend({
  collapse: ChaosTurretCollapseSchema.optional(),
  settledRubble: z
    .union([
      z.strictObject({
        ranges: z.tuple([z.literal("Rubble")]),
        afterSeconds: z.literal(0.06666667),
      }),
      z.strictObject({
        ranges: z.tuple([z.literal("Rubble"), z.literal("RubbleBase")]),
        afterSeconds: z.literal(Math.fround(1.9)),
      }),
    ])
    .optional(),
});
const ChampionModelsSchema = z.object({
  bindings: z
    .array(modelBinding.extend({ skinId: z.number().int().nonnegative() }))
    .length(10),
});
const championAssetKey = /^[a-z0-9_]+-(?:0|[1-9]\d{0,4})$/;
const ChampionModelCatalogSchema = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("exact-native-terrain-champion-catalog"),
  build: z.literal(currentTerrainPositionBuild),
  protocol: z.literal(terrainPositionProtocol),
  selectionKind: z.literal("archive"),
  assets: z.record(
    z.string().regex(championAssetKey),
    z.strictObject({
      champion: z.string().regex(/^[a-z0-9_]+$/i),
      skinId: z.number().int().nonnegative().max(10000),
      skinScale: z.number().positive().nullable(),
      hiddenRanges: z.array(z.string().min(1)),
      model: z.strictObject({
        file: z.string().regex(/^[a-z0-9_]+-(?:0|[1-9]\d{0,4})\/model\.glb$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().positive(),
      }),
    }),
  ),
});
const worldModelInstance = z.object({
  context: z.number().int().positive(),
  participantId,
  position,
  basis: z.array(z.number()).length(9),
});
const inactiveInhibitorRanges = z.array(
  z.tuple([z.number().positive(), z.number().positive().nullable()]),
);
const inhibitorInstance = worldModelInstance.extend({
  teamId,
  destroyedAtSeconds: z.number().positive().nullable(),
  inactiveRanges: inactiveInhibitorRanges.optional(),
});
const inhibitorLosses = z.array(
  z.object({ timeSeconds: z.number().positive() }),
);
const transformColumn = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);
const worldTransform = z.tuple([
  transformColumn,
  transformColumn,
  transformColumn,
  transformColumn,
]);
const turretPlacementReceipt = z.strictObject({
  archivedBuild: z.string(),
  archivedSha256: z.string(),
  installedCompatibilityVersion: z.string(),
  installedSha256: z.string(),
  entryPath: z.string(),
  attackableType: z.literal(0),
  uniqueMatches: z.literal(24),
  records: z
    .array(
      z.strictObject({
        keyHash: z.number().int().nonnegative(),
        mapNameHash: z.number().int().positive(),
        explicitTeam: z.number().int().nullable(),
        translation: position,
        archivedOffset: z.number().int().nonnegative(),
        installedOffset: z.number().int().nonnegative(),
        bytes: z.number().int().positive(),
        sha256: z.string(),
      }),
    )
    .length(24),
});
const turretCatalog = z.strictObject({
  build: z.literal(currentTerrainPositionBuild),
  protocol: z.literal(terrainPositionProtocol),
  placementReceipt: turretPlacementReceipt,
  placeables: z
    .array(
      z.strictObject({
        mapNameHash: z.number().int().positive().max(0xffffffff),
        asset: z.string().min(1),
        transform: worldTransform,
        characterRecord: z.string().min(1),
      }),
    )
    .length(24),
  models: z.tuple([
    z.tuple([z.literal("turret/0"), z.literal(0)]),
    z.tuple([z.literal("turret/3"), z.literal(1)]),
  ]),
});
const authoredPlacementSource = z.strictObject({
  archivedOffset: z.number().int().nonnegative(),
  installedOffset: z.number().int().nonnegative(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const nexusCatalog = z.strictObject({
  build: z.literal(currentTerrainPositionBuild),
  protocol: z.literal(terrainPositionProtocol),
  placementReceipt: turretPlacementReceipt,
  registration: z
    .array(
      z.strictObject({
        mapNameHash: z.number().int().positive().max(0xffffffff),
        attackableType: z.union([
          z.literal(0),
          z.literal(1),
          z.literal(2),
          z.null(),
        ]),
        kind: z.enum(["building", "barracks"]),
        worldPosition: position,
      }),
    )
    .length(38),
  placeables: z
    .array(
      z.strictObject({
        mapNameHash: z.number().int().positive().max(0xffffffff),
        assetId: z.enum(["nexus-0", "nexus-3"]),
        characterRecord: z.string().min(1),
        transform: z.array(z.number()).length(16),
        placementSource: authoredPlacementSource,
      }),
    )
    .length(2),
  models: z.tuple([
    z.tuple([z.literal("nexus-0"), z.literal(100)]),
    z.tuple([z.literal("nexus-3"), z.literal(101)]),
  ]),
});
const turretLosses = z.array(
  z.object({
    context: z.number().int().nonnegative(),
    timeSeconds: z.number().nonnegative(),
    worldPosition: position,
  }),
);
const structureModelData = z.object({
  instances: z
    .array(
      worldModelInstance.extend({
        destroyedAtSeconds: z.number().nonnegative().nullable(),
      }),
    )
    .min(1)
    .max(22),
  omittedContexts: z.array(participantId).optional(),
});

function hasDistinctTurretContexts({
  instances,
  omittedContexts,
}: z.infer<typeof structureModelData>) {
  const contexts = [
    ...instances.map(({ context }) => context),
    ...(omittedContexts ?? []),
  ];
  return contexts.length === 22 && new Set(contexts).size === 22;
}

function validateWorkerTurrets(
  catalog: z.infer<typeof turretCatalog>,
  structure: z.infer<typeof structureModelData>,
  losses: z.infer<typeof turretLosses>,
  duration: number,
) {
  const ids = new Map<string, number>(catalog.models);
  const placements = new Map(
    catalog.placeables.map(({ asset, transform: [x, y, z, origin] }) => [
      origin.slice(0, 3).join(","),
      {
        id: ids.get(asset),
        basis: [...x.slice(0, 3), ...y.slice(0, 3), ...z.slice(0, 3)],
      },
    ]),
  );
  const destroyed = new Map<number, (typeof structure.instances)[number]>();
  for (const instance of structure.instances) {
    const key = instance.position.join(",");
    const placement = placements.get(key);
    if (
      instance.participantId !== placement?.id ||
      instance.basis.some((axis, i) => axis !== placement.basis[i])
    )
      throw Error(
        "Replay motion worker returned an unadmitted turret placement.",
      );
    placements.delete(key);
    if (instance.destroyedAtSeconds !== null)
      destroyed.set(instance.context, instance);
  }
  let previous = 0;
  for (const loss of losses) {
    const instance = destroyed.get(loss.context);
    if (
      instance?.destroyedAtSeconds !== loss.timeSeconds ||
      loss.timeSeconds <= 0 ||
      loss.timeSeconds > duration ||
      loss.timeSeconds < previous ||
      loss.worldPosition.some((axis, i) => axis !== instance.position[i])
    )
      throw Error("Replay motion worker returned an unadmitted turret loss.");
    previous = loss.timeSeconds;
    destroyed.delete(loss.context);
  }
  if (destroyed.size !== 0)
    throw Error("Replay motion worker omitted a verified turret loss.");
}

const inhibitorCatalog = z.strictObject({
  build: z.literal(currentTerrainPositionBuild),
  protocol: z.literal(terrainPositionProtocol),
  registration: z
    .array(
      z.strictObject({
        kind: z.enum(["building", "barracks"]),
        attackableType: z.union([
          z.literal(0),
          z.literal(1),
          z.literal(2),
          z.null(),
        ]),
        mapNameHash: z.number().int().positive().max(0xffffffff),
        characterRecord: z.string().nullable(),
        asset: z.string().nullable(),
        explicitTeam: teamId.nullable(),
        transform: worldTransform,
        placementSource: authoredPlacementSource,
      }),
    )
    .length(38),
  models: z.tuple([
    z.tuple([z.literal("inhibitor/0"), participantId]),
    z.tuple([z.literal("inhibitor/3"), participantId]),
  ]),
});

function validInhibitorRanges(
  instances: readonly z.infer<typeof inhibitorInstance>[],
  duration: number,
) {
  return instances.every(({ destroyedAtSeconds, inactiveRanges }) => {
    if (inactiveRanges === undefined) return true;
    return (
      (inactiveRanges.length === 0) === (destroyedAtSeconds === null) &&
      (destroyedAtSeconds === null || destroyedAtSeconds <= duration) &&
      inactiveRanges.every(([start, end], index) => {
        const previous = inactiveRanges[index - 1];
        return (
          start <= duration &&
          (end === null || (end > start && end <= duration)) &&
          (previous === undefined ||
            (previous[1] !== null && start >= previous[1]))
        );
      })
    );
  });
}

function validateWorkerInhibitors(
  catalog: z.infer<typeof inhibitorCatalog>,
  instances: z.infer<typeof inhibitorInstance>[],
  losses: z.infer<typeof inhibitorLosses>,
  duration: number,
) {
  if (!validInhibitorRanges(instances, duration))
    throw Error(
      "Replay motion worker returned invalid inhibitor inactivity ranges.",
    );
  const models = new Map<string, number>(catalog.models);
  const times: number[] = [];
  let startContext: number | undefined;
  let index = 0;
  for (const [offset, row] of catalog.registration.entries()) {
    if (row.attackableType !== 1) continue;
    const instance = instances[index++];
    const [x, y, z, translation] = row.transform;
    const basis = [...x.slice(0, 3), ...y.slice(0, 3), ...z.slice(0, 3)];
    if (
      instance === undefined ||
      instance.inactiveRanges === undefined ||
      row.asset === null
    )
      throw Error(
        "Replay motion worker returned incomplete inhibitor coverage.",
      );
    startContext ??= instance.context - offset;
    if (
      startContext <= 0 ||
      instance.context !== startContext + offset ||
      instance.participantId !== models.get(row.asset) ||
      instance.teamId !== (row.asset === "inhibitor/0" ? 100 : 200) ||
      instance.position.some((value, axis) => value !== translation[axis]) ||
      instance.basis.some((value, axis) => value !== basis[axis]) ||
      instance.destroyedAtSeconds !== (instance.inactiveRanges[0]?.[0] ?? null)
    )
      throw Error(
        "Replay motion worker returned an unadmitted inhibitor placement.",
      );
    times.push(...instance.inactiveRanges.map(([time]) => time));
  }
  times.sort((a, b) => a - b);
  if (
    index !== instances.length ||
    times.length !== losses.length ||
    losses.some(({ timeSeconds }, i) => timeSeconds !== times[i])
  )
    throw Error(
      "Replay motion worker returned inconsistent inhibitor loss clocks.",
    );
}
const worldUnitInstance = z.object({
  context: z.number().int().positive(),
  participantId,
  teamId: teamId.optional(),
  creationTimeSeconds: z.number().nonnegative(),
  killTimeSeconds: z.number().positive().nullable(),
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
});
const laneMinionId = z
  .string()
  .regex(/^(?:sru|ha)_(?:order|chaos)minion(?:melee|ranged|siege|super)$/);
const laneMinionAsset = z.strictObject({
  asset: z
    .string()
    .regex(/^(?:sru|ha)_(?:order|chaos)minion(?:melee|ranged|siege|super)\/0$/),
});
const laneTransformRow = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);
const LaneMinionCatalogSchema = z
  .strictObject({
    map: z.literal("mayhem-bloom").optional(),
    barracksPlacements: z
      .array(
        z.strictObject({
          transform: z.tuple([
            laneTransformRow,
            laneTransformRow,
            laneTransformRow,
            laneTransformRow,
          ]),
          units: z.strictObject({
            "4": laneMinionAsset,
            "5": laneMinionAsset,
            "6": laneMinionAsset,
            "7": laneMinionAsset,
          }),
        }),
      )
      .min(2)
      .max(6),
    models: z.array(z.tuple([laneMinionId, participantId])).length(8),
  })
  .refine(({ map, barracksPlacements, models }) => {
    const mayhem = map === "mayhem-bloom";
    const prefix = mayhem ? "ha_" : "sru_";
    return (
      barracksPlacements.length === (mayhem ? 2 : 6) &&
      barracksPlacements.every(({ units }) =>
        Object.values(units).every(({ asset }) => asset.startsWith(prefix)),
      ) &&
      models.every(([model]) => model.startsWith(prefix))
    );
  });
const laneCount = z.number().int().positive();
const LaneMinionCoverageSchema = z.strictObject({
  candidateBirths: z.number().int().nonnegative(),
  birthsByClass: z.record(z.string().regex(/^\d{1,3}$/), laneCount),
  admittedByModel: z.record(laneMinionId, laneCount),
  omissions: z.record(z.string().regex(/^[a-zA-Z]+$/), laneCount),
});
const LaneMinionInstancesSchema = z.array(
  worldUnitInstance.extend({ teamId, killTimeSeconds: z.number().positive() }),
);
const LaneMinionHealthSchema = z.array(
  z.strictObject({
    context: participantId,
    start: z.number().nonnegative(),
    end: z.number().positive(),
    points: z
      .array(
        z.tuple([
          z.number().nonnegative(),
          z.number().nonnegative(),
          z.number().positive(),
        ]),
      )
      .min(1),
  }),
);
const NeutralObjectiveInstancesSchema = z.array(
  worldUnitInstance.omit({ teamId: true }),
);
const NeutralObjectiveOmissionsSchema = z.record(
  z.string().regex(/^[a-zA-Z]+$/),
  laneCount,
);

function matchesWorldModelBindings(
  models: [string, number][],
  bindings: z.infer<typeof modelBinding>[],
  occupiedBindings: z.infer<typeof modelBinding>[],
) {
  if (models.length !== bindings.length) return false;
  const ids = new Set(
    occupiedBindings.map(({ participantId }) => participantId),
  );
  const names = new Set<string>();
  return models.every(([name, id], index) => {
    if (ids.has(id) || names.has(name) || bindings[index].participantId !== id)
      return false;
    ids.add(id);
    names.add(name);
    return true;
  });
}
const recordedStructureLoss = z.object({
  context: z.number().int().positive(),
  timeSeconds: z.number().positive(),
});
const workerNexusModels = z.strictObject({
  instances: z.array(worldModelInstance).length(2),
  terminalLoss: recordedStructureLoss.extend({
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});

function validateWorkerNexusModels(
  catalog: z.infer<typeof nexusCatalog>,
  { instances, terminalLoss }: z.infer<typeof workerNexusModels>,
  duration: number,
) {
  const models = new Map<string, number>(catalog.models);
  const contexts = new Set(instances.map(({ context }) => context));
  if (
    contexts.size !== 2 ||
    !contexts.has(terminalLoss.context) ||
    terminalLoss.timeSeconds > duration
  )
    throw Error("Replay motion worker returned an unadmitted Nexus loss.");
  let firstContext: number | undefined;
  for (const { assetId, mapNameHash, transform } of catalog.placeables) {
    const ordinal = catalog.registration.findIndex(
      (row) => row.mapNameHash === mapNameHash,
    );
    const modelId = models.get(assetId);
    const instance = instances.find(
      ({ participantId }) => participantId === modelId,
    );
    if (instance === undefined || ordinal < 0)
      throw Error("Replay motion worker returned incomplete Nexus placements.");
    firstContext ??= instance.context - ordinal;
    const origin = transform.slice(12, 15);
    const basis = [
      ...transform.slice(0, 3),
      ...transform.slice(4, 7),
      ...transform.slice(8, 11),
    ];
    if (
      firstContext <= 0 ||
      instance.context !== firstContext + ordinal ||
      instance.position.some((axis, index) => axis !== origin[index]) ||
      instance.basis.some((axis, index) => axis !== basis[index])
    )
      throw Error(
        "Replay motion worker returned an unadmitted Nexus placement.",
      );
  }
}
const ChampionHealthTracksSchema = createChampionHealthTracksSchema(z);
const ChampionResourceTracksSchema = createChampionResourceTracksSchema(z);
const WorkerChampionStatsSchema = z.strictObject({
  championHealthTracks: ChampionHealthTracksSchema,
  championResourceTracks: ChampionResourceTracksSchema,
});
const meshId = z.number().int().positive().max(0xffffffff);
const TerrainControllerGraphSchema = z.strictObject({
  geometrySha256: z.string().regex(/^[0-9a-f]{64}$/),
  materialsSha256: z.string().regex(/^[0-9a-f]{64}$/),
  meshControllerIds: z.array(meshId).min(12).max(13),
  controllers: z
    .record(
      z.string().regex(/^[1-9]\d{0,9}$/),
      z.union([
        z.strictObject({
          classHash: z.enum(["c406a533", "ec733fe2", "e07edfa4"]),
          nameHash: meshId,
          defaultVisible: z.boolean().nullable(),
          elementalTerrainFlags: z.number().int().nonnegative().nullable(),
        }),
        z.strictObject({
          classHash: z.literal("e21083b5"),
          children: z.array(meshId).min(1).max(6),
          operation: z
            .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
            .nullable(),
        }),
      ]),
    )
    .refine((entries) => Object.keys(entries).length === 35),
  missingReplacementMeshControllerIds: z.array(meshId).max(2),
});
const TerrainVisibilitySchema = z.object({
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
});

const TerrainParticipantsSchema = z
  .array(
    z.object({
      participantId: z.number().int().nonnegative(),
      name: z.string(),
      championName: z.string(),
      teamId,
    }),
  )
  .length(10);

const TerrainSceneFields = z.object({
  identity: z.object({
    build: z.enum([terrainPositionBuild, currentTerrainPositionBuild]),
    protocol: z.literal(terrainPositionProtocol),
    durationMilliseconds: z.number().int().positive(),
    participantCount: z.literal(10),
    replaySha256: z.string().regex(/^[a-f0-9]{64}$/),
    mayhemMapSkin: z.string().min(1).optional(),
  }),
  winningTeam: teamId.optional(),
  mayhemFlowMapControl: z.literal(mayhemFlowMapControlSha256).optional(),
  teamVision: TeamVisionSchema.optional(),
  championAnimationCues: ChampionAnimationCuesSchema.optional(),
  championHealthTracks: ChampionHealthTracksSchema.optional(),
  championResourceTracks: ChampionResourceTracksSchema.optional(),
  championExperience: championExperienceSceneSchema(z).optional(),
  championExperienceThresholds:
    championExperienceThresholdsSchema(z).optional(),
  championInventory: replayInventorySceneSchema(z).optional(),
  championInventoryItems: z.array(replayItemAssetSchema(z)).optional(),
  championEliminations: ChampionEliminationsSchema.optional(),
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
  turretLosses: turretLosses.optional(),
  dragonKills: z
    .array(
      z.object({
        timeSeconds: z.number().nonnegative(),
        actorContext: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  neutralObjectiveKills: NeutralObjectiveKillsSchema.optional(),
  inhibitorLosses: inhibitorLosses.optional(),
  playerState: PlayerStateSchema.optional(),
  participants: z.union([TerrainParticipantsSchema, z.tuple([])]),
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
  terrainVisibility: TerrainVisibilitySchema.optional(),
  championModels: ChampionModelsSchema.optional(),
  structureModels: structureModelData
    .extend({ bindings: z.array(renderedTurretBinding).min(1) })
    .refine(
      hasDistinctTurretContexts,
      "Expected 22 accounted-for turret contexts",
    )
    .optional(),
  structureModelBindings: z.array(renderedTurretBinding).length(2).optional(),
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
  nexusModelBindings: z.array(modelBinding).length(2).optional(),
  inhibitorModels: z
    .object({
      bindings: z.array(modelBinding).length(2),
      instances: z.array(inhibitorInstance).min(1).max(6),
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
  inhibitorModelBindings: z.array(inhibitorModelBinding).length(2).optional(),
  worldUnitModels: z
    .object({
      bindings: z.array(modelBinding).nonempty(),
      instances: z.array(worldUnitInstance).nonempty(),
    })
    .optional(),
  laneMinionModelBindings: z.array(modelBinding).length(8).optional(),
  neutralObjectiveModelBindings: z.array(modelBinding).max(19).optional(),
  workerMotion: z
    .object({
      waypointOrigin: z.tuple([z.number().int(), z.number().int()]),
      allowCurrentBuild: z.literal(true).optional(),
      decodeChampionStats: z.literal(true).optional(),
      decodePlayerState: z.literal(true).optional(),
      decodeChampionInventory: z.literal(true).optional(),
      decodeChampionExperience: z.literal(true).optional(),
      championAnimationCatalog: ChampionAnimationCatalogSchema.optional(),
      championAnimationModelCatalog:
        ChampionAnimationModelCatalogSchema.optional(),
      championModelCatalog: ChampionModelCatalogSchema.optional(),
      inhibitorCatalog: inhibitorCatalog.optional(),
      turretCatalog: turretCatalog.optional(),
      nexusCatalog: nexusCatalog.optional(),
      announcerEvents: AnnouncerEventsSchema.optional(),
      terrainControllerGraph: TerrainControllerGraphSchema.optional(),
      laneMinionCatalog: LaneMinionCatalogSchema.optional(),
      neutralObjectiveModels: z
        .array(
          z.tuple([
            z.union([NeutralObjectiveModelIdSchema, NeutralCampModelIdSchema]),
            participantId,
          ]),
        )
        .max(19)
        .optional(),
      decodeNeutralCamps: z.literal(true).optional(),
      neutralCampSkins: z
        .array(
          z.tuple([
            z.union([NeutralCampModelIdSchema, z.literal("sru_horde")]),
            z.number().int().nonnegative().max(0xffffffff),
          ]),
        )
        .max(11)
        .optional(),
      decodeTeamVision: z.literal(true).optional(),
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
    scene.mayhemFlowMapControl === undefined ||
    (scene.identity.build === currentTerrainPositionBuild &&
      scene.identity.mayhemMapSkin === "Bloom" &&
      scene.terrainMaterials !== undefined),
  {
    path: ["mayhemFlowMapControl"],
    message:
      "The FlowMap comparison requires the reviewed textured Bloom scene.",
  },
)
  .refine(
    (scene) =>
      scene.participants.length !== 0 ||
      (scene.identity.build === currentTerrainPositionBuild &&
        scene.workerMotion?.championModelCatalog !== undefined &&
        scene.frames.length === 0 &&
        scene.decodedPositionFrames === undefined &&
        scene.motion === undefined),
    {
      path: ["participants"],
      message:
        "A replay-derived roster requires the exact archive model catalog and motion worker.",
    },
  )
  .refine(
    ({ identity, inhibitorModels }) =>
      validInhibitorRanges(
        inhibitorModels?.instances ?? [],
        identity.durationMilliseconds / 1000,
      ),
    {
      path: ["inhibitorModels", "instances"],
      message:
        "Recorded inhibitor inactive ranges must be ordered and within the replay.",
    },
  )
  .refine(
    (scene) => {
      const catalog = scene.workerMotion?.nexusCatalog;
      const bindings = scene.nexusModelBindings;
      if (catalog === undefined) return bindings === undefined;
      const ids = new Set<number>(catalog.models.map(([, id]) => id));
      return (
        scene.identity.build === catalog.build &&
        scene.identity.protocol === catalog.protocol &&
        scene.workerMotion?.allowCurrentBuild === true &&
        scene.motion === undefined &&
        scene.nexusModels === undefined &&
        bindings !== undefined &&
        bindings.every(
          ({ participantId, url }) =>
            ids.delete(participantId) && url.startsWith("/nexus-models/"),
        )
      );
    },
    {
      path: ["workerMotion", "nexusCatalog"],
      message:
        "Replay-derived Nexus models require an exact archive catalog and no prepared loss.",
    },
  )
  .refine(
    (scene) => {
      const catalog = scene.workerMotion?.turretCatalog;
      const bindings = scene.structureModelBindings;
      if (catalog === undefined)
        return (
          bindings === undefined &&
          scene.structureModels?.bindings.every(
            ({ collapse, settledRubble }) =>
              collapse === undefined && settledRubble === undefined,
          ) !== false
        );
      const ids = new Set<number>(catalog.models.map(([, id]) => id));
      return (
        scene.identity.build === catalog.build &&
        scene.identity.protocol === catalog.protocol &&
        scene.workerMotion?.allowCurrentBuild === true &&
        scene.motion === undefined &&
        scene.structureModels === undefined &&
        scene.turretLosses === undefined &&
        bindings !== undefined &&
        bindings.every(
          ({ participantId, url, settledRubble, hiddenRanges, collapse }) =>
            ids.delete(participantId) &&
            url.startsWith("/structure-models/") &&
            (collapse === undefined ||
              (participantId === 1 &&
                url === chaosTurretCollapseModelPath &&
                settledRubble !== undefined &&
                hiddenRanges.includes("Stage2") &&
                hiddenRanges.includes("Stage3"))) &&
            (settledRubble === undefined ||
              (settledRubble.ranges.length === participantId + 1 &&
                settledRubble.ranges.every((range) =>
                  hiddenRanges.includes(range),
                ))),
        )
      );
    },
    {
      path: ["workerMotion", "turretCatalog"],
      message:
        "Replay-derived turrets require an exact archive catalog and no prepared lifetimes.",
    },
  )
  .refine(
    (scene) => {
      const catalog = scene.workerMotion?.inhibitorCatalog;
      const bindings = scene.inhibitorModelBindings;
      if (catalog === undefined) return bindings === undefined;
      const ids = new Set(catalog.models.map(([, modelId]) => modelId));
      return (
        scene.identity.build === catalog.build &&
        scene.identity.protocol === catalog.protocol &&
        scene.workerMotion?.allowCurrentBuild === true &&
        scene.motion === undefined &&
        scene.inhibitorModels === undefined &&
        scene.inhibitorLosses === undefined &&
        ids.size === 2 &&
        bindings !== undefined &&
        bindings[0]?.inactiveModelRange === bindings[1]?.inactiveModelRange &&
        bindings.every(
          ({ participantId, url }) =>
            ids.delete(participantId) && url.startsWith("/inhibitor-models/"),
        )
      );
    },
    {
      path: ["workerMotion", "inhibitorCatalog"],
      message:
        "Replay-derived inhibitors require an exact archive catalog and no prepared lifetimes.",
    },
  )
  .refine(
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
  )
  .refine(
    (scene) =>
      scene.workerMotion?.decodeChampionInventory === true
        ? scene.identity.build === currentTerrainPositionBuild &&
          scene.workerMotion.allowCurrentBuild === true &&
          scene.motion === undefined &&
          scene.championInventory === undefined &&
          scene.championInventoryItems !== undefined
        : scene.championInventoryItems === undefined,
    {
      path: ["workerMotion", "decodeChampionInventory"],
      message:
        "Replay-derived champion inventory requires current worker motion and item assets without embedded motion or inventory tracks.",
    },
  )
  .refine(
    (scene) =>
      scene.workerMotion?.decodeChampionExperience === true
        ? scene.identity.build === currentTerrainPositionBuild &&
          scene.workerMotion.allowCurrentBuild === true &&
          scene.motion === undefined &&
          scene.championExperience === undefined &&
          scene.championExperienceThresholds !== undefined
        : scene.championExperienceThresholds === undefined,
    {
      path: ["workerMotion", "decodeChampionExperience"],
      message:
        "Replay-derived champion experience requires current worker motion and authored thresholds without embedded experience tracks.",
    },
  )
  .refine(
    (scene) => {
      const catalog = scene.workerMotion?.championModelCatalog;
      return (
        catalog === undefined ||
        (scene.identity.build === catalog.build &&
          scene.identity.protocol === catalog.protocol &&
          scene.workerMotion?.allowCurrentBuild === true &&
          scene.motion === undefined &&
          scene.championModels === undefined)
      );
    },
    {
      path: ["workerMotion", "championModelCatalog"],
      message:
        "Replay-derived champion models require an exact current archive catalog and worker motion.",
    },
  )
  .refine(
    (scene) => {
      const worker = scene.workerMotion;
      const catalog = worker?.championAnimationModelCatalog;
      if (catalog === undefined) return true;
      if (
        worker?.championModelCatalog === undefined ||
        worker.championAnimationCatalog !== undefined ||
        scene.championAnimationCues !== undefined ||
        scene.identity.build !== catalog.build ||
        scene.identity.protocol !== catalog.protocol
      )
        return false;
      const models = new Set(
        Object.values(worker.championModelCatalog.assets).map(
          ({ model }) => `/champion-models/${model.sha256}.glb`,
        ),
      );
      return catalog.models.every(({ model }) => models.has(model));
    },
    {
      path: ["workerMotion", "championAnimationModelCatalog"],
      message:
        "Build-scoped animation requires the exact archive model catalog and no prepared cues or bindings.",
    },
  )
  .refine(
    (scene) => {
      const catalog = scene.workerMotion?.championAnimationCatalog;
      return (
        catalog === undefined ||
        (scene.identity.build === currentTerrainPositionBuild &&
          scene.workerMotion?.allowCurrentBuild === true &&
          scene.motion === undefined &&
          scene.championAnimationCues === undefined &&
          (scene.workerMotion?.championModelCatalog !== undefined ||
            (scene.championModels !== undefined &&
              matchesRenderedAnimationCatalog(
                catalog,
                scene.participants,
                scene.championModels.bindings,
              ))))
      );
    },
    {
      path: ["workerMotion", "championAnimationCatalog"],
      message:
        "Replay-derived champion animation requires an exact current rendered-model catalog and no embedded cues or motion.",
    },
  )
  .refine(
    (scene) =>
      scene.workerMotion?.announcerEvents === undefined ||
      (scene.identity.build === currentTerrainPositionBuild &&
        scene.workerMotion.allowCurrentBuild === true &&
        scene.motion === undefined),
    {
      path: ["workerMotion", "announcerEvents"],
      message:
        "Replay-derived announcements require exact current worker motion.",
    },
  )
  .refine(
    (scene) =>
      scene.workerMotion?.terrainControllerGraph === undefined ||
      (scene.identity.build === currentTerrainPositionBuild &&
        scene.workerMotion.allowCurrentBuild === true &&
        scene.motion === undefined &&
        scene.terrainMaterials !== undefined &&
        scene.terrainVisibility === undefined),
    {
      path: ["workerMotion", "terrainControllerGraph"],
      message:
        "Replay-derived terrain visibility requires exact current worker motion and no baked visibility.",
    },
  )
  .refine(
    (scene) =>
      scene.workerMotion?.decodeTeamVision !== true ||
      (scene.identity.build === currentTerrainPositionBuild &&
        scene.workerMotion.allowCurrentBuild === true &&
        scene.motion === undefined &&
        scene.teamVision === undefined),
    {
      path: ["workerMotion", "decodeTeamVision"],
      message:
        "Replay-derived team vision requires exact current worker motion without embedded masks.",
    },
  )
  .refine(
    (scene) => {
      const catalog = scene.workerMotion?.laneMinionCatalog;
      const bindings = scene.laneMinionModelBindings;
      if (catalog === undefined) return bindings === undefined;
      if (
        bindings === undefined ||
        scene.identity.build !== currentTerrainPositionBuild ||
        (scene.identity.mayhemMapSkin === "Bloom") !==
          (catalog.map === "mayhem-bloom") ||
        scene.workerMotion?.allowCurrentBuild !== true ||
        scene.motion !== undefined ||
        scene.teamVision !== undefined
      )
        return false;
      return matchesWorldModelBindings(catalog.models, bindings, [
        ...(scene.worldUnitModels?.bindings ?? []),
        ...(scene.neutralObjectiveModelBindings ?? []),
      ]);
    },
    {
      path: ["workerMotion", "laneMinionCatalog"],
      message:
        "Replay-derived lanes require exact current model bindings and no baked vision.",
    },
  )
  .refine(
    (scene) => {
      const models = scene.workerMotion?.neutralObjectiveModels;
      const bindings = scene.neutralObjectiveModelBindings;
      const decodeCamps = scene.workerMotion?.decodeNeutralCamps === true;
      if (decodeCamps !== (scene.workerMotion?.neutralCampSkins !== undefined))
        return false;
      if (models === undefined) return bindings === undefined && !decodeCamps;
      return (
        bindings !== undefined &&
        (decodeCamps ||
          models.every(
            ([name]) =>
              name !== "sru_horde" &&
              NeutralObjectiveModelIdSchema.safeParse(name).success,
          )) &&
        scene.identity.build === currentTerrainPositionBuild &&
        scene.workerMotion?.allowCurrentBuild === true &&
        scene.motion === undefined &&
        scene.teamVision === undefined &&
        scene.neutralObjectiveKills === undefined &&
        scene.dragonKills === undefined &&
        matchesWorldModelBindings(
          models,
          bindings,
          scene.worldUnitModels?.bindings ?? [],
        )
      );
    },
    {
      path: ["workerMotion", "neutralObjectiveModels"],
      message:
        "Replay-derived objectives require exact current model bindings and no baked objectives or vision.",
    },
  )
  .refine(
    (scene) =>
      scene.workerMotion?.decodePlayerState !== true ||
      (scene.identity.build === currentTerrainPositionBuild &&
        scene.workerMotion.allowCurrentBuild === true &&
        scene.playerState === undefined &&
        scene.championEliminations === undefined &&
        scene.winningTeam === undefined),
    {
      path: ["workerMotion", "decodePlayerState"],
      message:
        "Replay-derived player state requires exact current worker motion without prepared state.",
    },
  );
export type TerrainScene = z.infer<typeof SceneSchema>;
type CapturedTerrainFrame = TerrainScene["frames"][number];
type TerrainFrame = CapturedTerrainFrame & {
  markers: (CapturedTerrainFrame["markers"][number] & {
    pathDirection?: readonly [number, number];
  })[];
};
type MaterialBindings = Map<
  string,
  {
    image: ImageBitmap;
    alphaTest: number;
    sourceAlphaBlend: boolean;
  }
>;
type ModelBindings = z.infer<typeof inhibitorModelBinding>[];
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
      animationPalettesAt?: Awaited<
        ReturnType<typeof loadRecordedChampionAnimations>
      >;
      turretCollapseAt?: Awaited<ReturnType<typeof loadRecordedTurretCollapse>>;
      recordedParticles?: LoadedTerrainParticles;
      flowMapControl?: Awaited<ReturnType<typeof loadFlowMapControl>>;
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
        showRecordedParticles?: boolean;
        championHealthAt?: (
          participantId: number,
          timeSeconds: number,
        ) =>
          | readonly [timeSeconds: number, current: number, max: number]
          | undefined;
        laneMinionHealthAt?: (
          context: number,
          timeSeconds: number,
        ) => { current: number; max: number } | undefined;
        championNameplateAt?: (
          participantId: number,
          timeSeconds: number,
        ) =>
          | {
              name: string;
              level?: number;
              resource?: { current: number; max: number };
            }
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

const WorkerPlayerNames = z
  .array(
    z.strictObject({
      participantId,
      gameName: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[^\u0000-\u001f\u007f]+$/u),
    }),
  )
  .max(10);

const WorkerMotionResponse = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    participants: TerrainParticipantsSchema.refine(
      (rows) =>
        new Set(rows.map(({ participantId }) => participantId)).size === 10 &&
        rows.filter(({ teamId }) => teamId === 100).length === 5,
      "Expected a unique replay-derived roster with five players per side.",
    ).optional(),
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
    championInventoryTracks: inventoryTracksSchema(z).optional(),
    championExperienceTracks:
      createChampionExperienceTracksSchema(z).optional(),
    championAnimationCues: ChampionAnimationWorkerCuesSchema.optional(),
    championAnimationOmissions: z
      .strictObject({
        missingModel: z.array(z.number().int().positive()).max(10),
      })
      .optional(),
    announcerCues: AnnouncerCuesSchema.optional(),
    teamVision: TeamVisionSchema.optional(),
    terrainVisibility: TerrainVisibilitySchema.optional(),
    laneMinionInstances: LaneMinionInstancesSchema.optional(),
    laneMinionCoverage: LaneMinionCoverageSchema.optional(),
    laneMinionHealth: LaneMinionHealthSchema.optional(),
    neutralObjectiveInstances: NeutralObjectiveInstancesSchema.optional(),
    neutralObjectiveKills: NeutralObjectiveWorkerKillsSchema.optional(),
    neutralObjectiveOmissions: NeutralObjectiveOmissionsSchema.optional(),
    neutralCampCoverage: NeutralCampCoverageSchema.optional(),
    championModels: ChampionModelsSchema.optional(),
    inhibitorModels: z
      .strictObject({ instances: z.array(inhibitorInstance).length(6) })
      .optional(),
    inhibitorLosses: inhibitorLosses.optional(),
    structureModels: structureModelData
      .refine(
        hasDistinctTurretContexts,
        "Expected 22 accounted-for turret contexts",
      )
      .optional(),
    turretLosses: turretLosses.optional(),
    nexusModels: workerNexusModels.optional(),
    recordedPlayerState: z
      .strictObject({
        playerState: PlayerStateSchema,
        championEliminations: ChampionEliminationsSchema,
        winningTeam: teamId.optional(),
      })
      .optional(),
    playerNames: WorkerPlayerNames.optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

function validateWorkerTerrainVisibility(
  visibility: z.infer<typeof TerrainVisibilitySchema>,
  graph: z.infer<typeof TerrainControllerGraphSchema>,
  duration: number,
) {
  const expected = new Set(graph.meshControllerIds);
  const unresolved = visibility.unresolvedMeshControllerIds;
  const missing = visibility.missingReplacementMeshControllerIds;
  const omitted = visibility.omittedMeshControllerIds;
  if (
    omitted === undefined ||
    omitted.length !== unresolved.length ||
    !omitted.every((id, index) => id === unresolved[index]) ||
    missing.length !== graph.missingReplacementMeshControllerIds.length ||
    !missing.every(
      (id, index) => id === graph.missingReplacementMeshControllerIds[index],
    ) ||
    ![...unresolved, ...missing].every((id) => expected.delete(id))
  )
    throw Error(
      "Worker terrain visibility does not match its authored mesh omissions.",
    );
  const tracked = new Set<number>();
  for (const { controllerId, points } of visibility.tracks) {
    if (
      !expected.delete(controllerId) ||
      points[0][0] !== 0 ||
      !points.every(
        ([time], index) =>
          time <= duration && time > (points[index - 1]?.[0] ?? -1),
      )
    )
      throw Error("Worker terrain visibility has an invalid track.");
    tracked.add(controllerId);
  }
  if (expected.size !== 0)
    throw Error(
      "Worker terrain visibility did not cover all authored mesh controllers.",
    );
  const lastEnd = new Map<number, number>();
  for (const {
    controllerId,
    startSeconds,
    endSeconds,
  } of visibility.unresolvedWindows ?? []) {
    if (
      !tracked.has(controllerId) ||
      startSeconds < (lastEnd.get(controllerId) ?? 0) ||
      endSeconds <= startSeconds ||
      endSeconds > duration
    )
      throw Error(
        "Worker terrain visibility has an invalid unresolved window.",
      );
    lastEnd.set(controllerId, endSeconds);
  }
}

async function loadWorkerMotion(
  { identity, participants }: TerrainScene,
  workerMotion: NonNullable<TerrainScene["workerMotion"]>,
  signal: AbortSignal,
  assets: TerrainMotionAssets,
  teamVisionActors?: { world: [number, number][]; contexts: Set<number> },
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
          {
            identity,
            ...workerMotion,
            ...(participants.length === 0 ? { deriveParticipants: true } : {}),
            replayBytes,
            decoderBytes,
            ...(teamVisionActors === undefined
              ? {}
              : { teamVisionWorldActors: teamVisionActors.world }),
          },
          [replayBytes, decoderBytes],
        );
      },
    );
    if (result.type === "error") throw new Error(result.message);
    if ((result.participants !== undefined) !== (participants.length === 0))
      throw Error("Replay motion worker returned unexpected roster data.");
    if (
      (result.championModels !== undefined) !==
      (workerMotion.championModelCatalog !== undefined)
    )
      throw Error("Replay motion worker returned unexpected champion models.");
    if (
      (result.recordedPlayerState !== undefined) !==
        (workerMotion.decodePlayerState === true) ||
      (result.playerNames !== undefined) !==
        (workerMotion.decodePlayerState === true)
    )
      throw Error("Replay motion worker returned unexpected player state.");
    const decodeLanes = workerMotion.laneMinionCatalog !== undefined;
    if (
      (result.laneMinionInstances !== undefined) !== decodeLanes ||
      (result.laneMinionCoverage !== undefined) !== decodeLanes ||
      (result.laneMinionHealth !== undefined) !== decodeLanes
    )
      throw Error("Replay motion worker returned unexpected lane coverage.");
    const laneHealth = new Map<
      number,
      z.infer<typeof LaneMinionHealthSchema>[number]
    >();
    const laneActors = new Map(
      result.laneMinionInstances?.map((actor) => [actor.context, actor]),
    );
    for (const track of result.laneMinionHealth ?? []) {
      const actor = laneActors.get(track.context);
      if (
        actor === undefined ||
        track.start !== actor.creationTimeSeconds ||
        track.end !== actor.killTimeSeconds ||
        laneHealth.has(track.context)
      )
        throw Error(
          "Lane minion health does not match a unique recorded actor.",
        );
      let previous = -1;
      for (const [seconds, current, max] of track.points) {
        if (
          seconds < track.start ||
          seconds >= track.end ||
          seconds <= previous ||
          current > max
        )
          throw Error("Lane minion health has an invalid observation.");
        previous = seconds;
      }
      laneHealth.set(track.context, track);
    }
    const decodeObjectives = workerMotion.neutralObjectiveModels !== undefined;
    if (
      (result.neutralObjectiveInstances !== undefined) !== decodeObjectives ||
      (result.neutralObjectiveKills !== undefined) !== decodeObjectives ||
      (result.neutralObjectiveOmissions !== undefined) !== decodeObjectives ||
      (result.neutralCampCoverage !== undefined) !==
        (workerMotion.decodeNeutralCamps === true)
    )
      throw Error(
        "Replay motion worker returned unexpected objective coverage.",
      );
    const terrainGraph = workerMotion.terrainControllerGraph;
    if (
      (result.terrainVisibility !== undefined) !==
      (terrainGraph !== undefined)
    )
      throw Error(
        "Replay motion worker returned unexpected terrain visibility coverage.",
      );
    if (result.terrainVisibility !== undefined && terrainGraph !== undefined)
      validateWorkerTerrainVisibility(
        result.terrainVisibility,
        terrainGraph,
        identity.durationMilliseconds / 1000,
      );
    const turrets = workerMotion.turretCatalog;
    const nexus = workerMotion.nexusCatalog;
    if ((result.nexusModels !== undefined) !== (nexus !== undefined))
      throw Error("Replay motion worker returned unexpected Nexus coverage.");
    if (nexus !== undefined && result.nexusModels !== undefined)
      validateWorkerNexusModels(
        nexus,
        result.nexusModels,
        identity.durationMilliseconds / 1000,
      );
    if (
      (result.structureModels !== undefined) !== (turrets !== undefined) ||
      (result.turretLosses !== undefined) !== (turrets !== undefined)
    )
      throw Error("Replay motion worker returned unexpected turret coverage.");
    if (
      turrets !== undefined &&
      result.structureModels !== undefined &&
      result.turretLosses !== undefined
    )
      validateWorkerTurrets(
        turrets,
        result.structureModels,
        result.turretLosses,
        identity.durationMilliseconds / 1000,
      );
    const inhibitors = workerMotion.inhibitorCatalog;
    if (
      (result.inhibitorModels !== undefined) !== (inhibitors !== undefined) ||
      (result.inhibitorLosses !== undefined) !== (inhibitors !== undefined)
    )
      throw Error(
        "Replay motion worker returned unexpected inhibitor coverage.",
      );
    if (
      inhibitors !== undefined &&
      result.inhibitorModels !== undefined &&
      result.inhibitorLosses !== undefined
    )
      validateWorkerInhibitors(
        inhibitors,
        result.inhibitorModels.instances,
        result.inhibitorLosses,
        identity.durationMilliseconds / 1000,
      );
    if ((result.teamVision !== undefined) !== (teamVisionActors !== undefined))
      throw Error(
        "Replay motion worker returned unexpected team vision coverage.",
      );
    if (result.teamVision !== undefined && teamVisionActors !== undefined) {
      const decodedContexts = [
        ...(result.laneMinionInstances ?? []),
        ...(result.neutralObjectiveInstances ?? []),
        ...(result.inhibitorModels?.instances ?? []),
        ...(result.structureModels?.instances ?? []),
        ...(result.nexusModels?.instances ?? []),
      ].map(({ context }) => context);
      const boundContexts = [
        ...teamVisionActors.contexts,
        ...(result.participants ?? []).map(
          ({ participantId }) => participantId,
        ),
        ...decodedContexts,
      ];
      const contexts = new Set(boundContexts);
      const received = new Set(result.teamVision.map(({ context }) => context));
      if (
        contexts.size !== boundContexts.length ||
        received.size !== contexts.size ||
        result.teamVision.length !== contexts.size ||
        [...received].some((context) => !contexts.has(context))
      )
        throw Error(
          "Replay motion worker returned incorrect team vision actors.",
        );
    }
    if (
      (result.championStats !== undefined) !==
      (workerMotion.decodeChampionStats === true)
    )
      throw new Error(
        "Replay motion worker returned unexpected champion stats coverage.",
      );
    if (
      (result.championInventoryTracks !== undefined) !==
      (workerMotion.decodeChampionInventory === true)
    )
      throw new Error(
        "Replay motion worker returned unexpected champion inventory coverage.",
      );
    if (
      (result.championExperienceTracks !== undefined) !==
      (workerMotion.decodeChampionExperience === true)
    )
      throw new Error(
        "Replay motion worker returned unexpected champion experience coverage.",
      );
    const animationCatalog = workerMotion.championAnimationCatalog;
    const animationModelCatalog = workerMotion.championAnimationModelCatalog;
    if (
      (result.championAnimationCues !== undefined) !==
        (animationCatalog !== undefined ||
          animationModelCatalog !== undefined) ||
      (result.championAnimationOmissions !== undefined) !==
        (animationModelCatalog !== undefined)
    )
      throw new Error(
        "Replay motion worker returned unexpected champion animation coverage.",
      );
    if (
      result.championAnimationCues !== undefined &&
      animationCatalog !== undefined
    )
      validateWorkerAnimationCues(
        result.championAnimationCues,
        animationCatalog,
      );
    if (
      animationModelCatalog !== undefined &&
      result.championModels !== undefined &&
      result.championAnimationCues !== undefined &&
      result.championAnimationOmissions !== undefined
    ) {
      const models = new Map(
        animationModelCatalog.models.map((entry) => [entry.model, entry]),
      );
      const missingModel: number[] = [];
      const selected = result.championModels.bindings.flatMap(
        ({ participantId, url }) => {
          const entry = models.get(url);
          if (entry !== undefined) return [{ ...entry, participantId }];
          missingModel.push(participantId);
          return [];
        },
      );
      const omissions = result.championAnimationOmissions.missingModel;
      if (
        omissions.length !== missingModel.length ||
        missingModel.some(
          (participantId, index) => participantId !== omissions[index],
        )
      )
        throw Error(
          "Replay motion worker returned inconsistent animation omissions.",
        );
      validateWorkerAnimationCues(result.championAnimationCues, selected);
    }
    const announcerEvents = workerMotion.announcerEvents;
    if (
      (result.announcerCues !== undefined) !==
      (announcerEvents !== undefined)
    )
      throw new Error(
        "Replay motion worker returned unexpected announcer coverage.",
      );
    if (result.announcerCues !== undefined && announcerEvents !== undefined)
      validateAnnouncerCues(
        result.announcerCues,
        announcerEvents,
        identity.durationMilliseconds / 1000,
      );
    return { ...result, laneHealth };
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

function teamVisionActorBindings(scene: TerrainScene) {
  if (scene.workerMotion?.decodeTeamVision !== true) return;
  const world: [number, number][] = [
    scene.worldUnitModels,
    scene.structureModels,
    scene.inhibitorModels,
    scene.nexusModels,
  ].flatMap(
    (group) =>
      group?.instances.map((actor): [number, number] => [
        actor.context,
        "creationTimeSeconds" in actor ? actor.creationTimeSeconds : 0,
      ]) ?? [],
  );
  const contexts = new Set([
    ...scene.participants.map(({ participantId }) => participantId),
    ...world.map(([context]) => context),
  ]);
  if (contexts.size !== scene.participants.length + world.length)
    throw Error("Duplicate actor binding in replay-derived team vision.");
  return { world, contexts };
}

function validateWorldUnitPaths(
  actor: z.infer<typeof worldUnitInstance>,
  mapBounds: TerrainScene["mapBounds"],
  activeEnd: number,
  allowAnchors = false,
) {
  const { min, max } = mapBounds;
  let previousEnd = actor.creationTimeSeconds;
  for (const { timeSeconds, endTimeSeconds, points, speeds } of actor.paths) {
    const [knot] = speeds;
    const anchor =
      allowAnchors &&
      points.length === 1 &&
      endTimeSeconds === timeSeconds &&
      knot.speed === 0;
    if (
      timeSeconds < previousEnd ||
      endTimeSeconds > activeEnd ||
      knot.timeSeconds !== timeSeconds ||
      (!anchor &&
        (endTimeSeconds <= timeSeconds || points.length < 2 || knot.speed <= 0))
    )
      throw Error("A decoded world unit path falls outside its recorded life.");
    previousEnd = endTimeSeconds;
    let distance = 0;
    for (const [index, [x, z]] of points.entries()) {
      if (x < min[0] || x > max[0] || z < min[2] || z > max[2])
        throw Error("A decoded world unit path falls outside Map11.");
      if (index > 0) {
        const [priorX, priorZ] = points[index - 1];
        distance += Math.hypot(x - priorX, z - priorZ);
      }
    }
    if (
      !anchor &&
      (distance <= 0 ||
        endTimeSeconds > timeSeconds + distance / knot.speed + 1e-9)
    )
      throw Error(
        "A decoded world unit path is longer than its recorded movement.",
      );
  }
}

function occupiedWorldContexts(scene: TerrainScene) {
  return new Set([
    ...scene.participants.map(({ participantId }) => participantId),
    ...[
      scene.worldUnitModels,
      scene.structureModels,
      scene.inhibitorModels,
      scene.nexusModels,
    ].flatMap((group) => group?.instances.map(({ context }) => context) ?? []),
  ]);
}

function mergeWorldModels(
  previous: TerrainScene["worldUnitModels"],
  bindings: z.infer<typeof modelBinding>[],
  instances: z.infer<typeof worldUnitInstance>[],
): TerrainScene["worldUnitModels"] {
  if (instances.length === 0) return previous;
  return {
    bindings: [...(previous?.bindings ?? []), ...bindings],
    instances: [...(previous?.instances ?? []), ...instances],
  };
}

function loadWorldUnits(
  scene: TerrainScene,
  laneActors: z.infer<typeof LaneMinionInstancesSchema> | undefined,
  coverage: z.infer<typeof LaneMinionCoverageSchema> | undefined,
): TerrainScene["worldUnitModels"] {
  if (laneActors === undefined || coverage === undefined)
    return scene.worldUnitModels;
  const catalog = scene.workerMotion?.laneMinionCatalog;
  const bindings = scene.laneMinionModelBindings;
  if (catalog === undefined || bindings === undefined)
    throw Error("Decoded lanes are missing their authored catalog.");

  const models = new Map(catalog.models.map(([name, id]) => [id, name]));
  const contexts = occupiedWorldContexts(scene);
  const counts = new Map<string, number>();
  const duration = scene.identity.durationMilliseconds / 1000;
  const orderPrefix = catalog.map === "mayhem-bloom" ? "ha_order" : "sru_order";
  for (const actor of laneActors) {
    const model = models.get(actor.participantId);
    const team = model?.startsWith(orderPrefix) ? 100 : 200;
    if (
      model === undefined ||
      actor.teamId !== team ||
      contexts.has(actor.context) ||
      actor.creationTimeSeconds >= actor.killTimeSeconds ||
      actor.killTimeSeconds > duration
    )
      throw Error("A decoded lane actor conflicts with the scene or catalog.");
    contexts.add(actor.context);
    counts.set(model, (counts.get(model) ?? 0) + 1);
    validateWorldUnitPaths(actor, scene.mapBounds, actor.killTimeSeconds);
  }
  const count = (rows: Record<string, number>) =>
    Object.values(rows).reduce((total, count) => total + count, 0);
  if (
    coverage.candidateBirths !== count(coverage.birthsByClass) ||
    coverage.candidateBirths !==
      laneActors.length + count(coverage.omissions) ||
    Object.keys(coverage.admittedByModel).length !== counts.size ||
    !Object.entries(coverage.admittedByModel).every(
      ([model, amount]) => counts.get(model) === amount,
    )
  )
    throw Error(
      "Decoded lane coverage does not account for the recorded births.",
    );

  return mergeWorldModels(scene.worldUnitModels, bindings, laneActors);
}

function loadNeutralObjectives(
  scene: TerrainScene,
  instances: z.infer<typeof NeutralObjectiveInstancesSchema>,
  events: z.infer<typeof NeutralObjectiveWorkerKillsSchema>,
  ground: (x: number, z: number) => number | null,
) {
  const bindings = scene.neutralObjectiveModelBindings;
  const selectors = scene.workerMotion?.neutralObjectiveModels;
  if (bindings === undefined || selectors === undefined)
    throw Error("Decoded objectives are missing their authored bindings.");
  const models = new Map(selectors.map(([name, id]) => [id, name]));
  const champions = new Set(
    scene.participants.map(({ participantId }) => participantId),
  );
  const occupied = occupiedWorldContexts(scene);
  const duration = scene.identity.durationMilliseconds / 1000;
  const bySubject = new Map(
    events.map((event) => [event.subjectContext, event]),
  );
  if (bySubject.size !== events.length)
    throw Error("Decoded objective defeats repeat an actor.");
  const neutralObjectiveKills = events.map(
    ({ subjectContext, actorContext, timeSeconds, modelId, position }) => {
      if (
        occupied.has(subjectContext) ||
        !champions.has(actorContext) ||
        timeSeconds > duration
      )
        throw Error(
          "A decoded objective defeat conflicts with the replay roster or clock.",
        );
      const event = { actorContext, timeSeconds, modelId };
      if (position === undefined) return event;
      const [x, z] = position;
      const y = ground(x, z);
      if (y === null) throw Error("A decoded objective lies outside Map11.");
      return { ...event, position: [x, y, z] as [number, number, number] };
    },
  );
  for (const actor of instances) {
    const model = models.get(actor.participantId);
    const death = bySubject.get(actor.context);
    const end = actor.killTimeSeconds ?? duration;
    const ordinaryCamp = NeutralCampModelIdSchema.safeParse(model).success;
    if (
      model === undefined ||
      occupied.has(actor.context) ||
      actor.creationTimeSeconds >= end ||
      end > duration ||
      (!ordinaryCamp &&
        (death?.timeSeconds ?? null) !== actor.killTimeSeconds) ||
      (death !== undefined && death.modelId !== model)
    )
      throw Error(
        "A decoded neutral actor conflicts with its catalog or recorded life.",
      );
    occupied.add(actor.context);
    validateWorldUnitPaths(actor, scene.mapBounds, end, true);
  }
  return {
    neutralObjectiveKills,
    worldUnitModels: mergeWorldModels(
      scene.worldUnitModels,
      bindings,
      instances,
    ),
    neutralObjectiveModelBindings: undefined,
    workerMotion: undefined,
  };
}

function validateSelectedChampionModels(
  scene: TerrainScene,
  models: z.infer<typeof ChampionModelsSchema>,
) {
  const catalog = scene.workerMotion?.championModelCatalog;
  const participants = new Map(
    scene.participants.map(({ participantId, championName }) => [
      participantId,
      championName,
    ]),
  );
  for (const binding of models.bindings) {
    const champion = participants.get(binding.participantId);
    const key = `${champion?.toLowerCase()}-${String(binding.skinId)}`;
    const asset = catalog?.assets[key];
    if (
      champion === undefined ||
      asset?.champion !== champion ||
      asset.skinId !== binding.skinId ||
      asset.model.file !== `${key}/model.glb` ||
      binding.url !== `/champion-models/${asset.model.sha256}.glb` ||
      binding.skinScale !== (asset.skinScale ?? 1) ||
      binding.hiddenRanges.length !== asset.hiddenRanges.length ||
      binding.hiddenRanges.some(
        (range, index) => range !== asset.hiddenRanges[index],
      )
    )
      throw Error(
        "Worker-selected champion models disagree with the roster or archive catalog.",
      );
    participants.delete(binding.participantId);
  }
  if (participants.size !== 0)
    throw Error(
      "Worker-selected champion models do not cover the replay roster.",
    );
  const animation = scene.workerMotion?.championAnimationCatalog;
  if (
    animation !== undefined &&
    !matchesRenderedAnimationCatalog(
      animation,
      scene.participants,
      models.bindings,
    )
  )
    throw Error(
      "Worker-selected champion models disagree with the animation catalog.",
    );
}

export async function loadSceneMotion(
  source: TerrainScene,
  signal: AbortSignal,
  assets: TerrainMotionAssets,
) {
  if (source.motion === undefined && source.workerMotion === undefined)
    return { scene: source, heights: undefined };
  const { navgrid } = source;
  if (navgrid === undefined)
    throw new Error("Replay motion is missing navigation terrain metadata.");
  const [heights, decoded] = await Promise.all([
    assets.read("/heights.bin").then((buffer) => new Float32Array(buffer)),
    source.workerMotion === undefined
      ? undefined
      : loadWorkerMotion(
          source,
          source.workerMotion,
          signal,
          assets,
          teamVisionActorBindings(source),
        ),
  ]);
  if (decoded === undefined) return { scene: source, heights };
  const scene =
    decoded.participants === undefined
      ? source
      : { ...source, participants: decoded.participants };
  const championModels = decoded.championModels;
  if (championModels !== undefined)
    validateSelectedChampionModels(scene, championModels);
  const ground = createNavgridGroundHeight(scene.mapBounds, navgrid, heights);
  const teams = new Map(
    scene.participants.map((participant) => [
      participant.participantId,
      participant.teamId,
    ]),
  );
  const championStats = decoded.championStats;
  const inventoryTracks = decoded.championInventoryTracks;
  const inventoryItems = scene.championInventoryItems;
  const experienceTracks = decoded.championExperienceTracks;
  const experienceThresholds = scene.championExperienceThresholds;
  const animationCues = decoded.championAnimationCues;
  const neutrals =
    decoded.neutralObjectiveInstances !== undefined &&
    decoded.neutralObjectiveKills !== undefined
      ? loadNeutralObjectives(
          scene,
          decoded.neutralObjectiveInstances,
          decoded.neutralObjectiveKills,
          ground,
        )
      : undefined;
  const worldScene =
    neutrals === undefined
      ? scene
      : { ...scene, worldUnitModels: neutrals.worldUnitModels };
  if (
    experienceTracks !== undefined &&
    (experienceThresholds === undefined ||
      teams.size !== scene.identity.participantCount)
  )
    throw new Error(
      "Replay-derived champion experience requires authored thresholds and a unique roster.",
    );
  if (
    inventoryTracks !== undefined &&
    (inventoryItems === undefined ||
      teams.size !== scene.identity.participantCount)
  )
    throw new Error(
      "Replay-derived champion inventory requires item assets and a unique roster.",
    );
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
      ...neutrals,
      ...(decoded.nexusModels === undefined ||
      scene.nexusModelBindings === undefined
        ? {}
        : {
            nexusModels: {
              bindings: scene.nexusModelBindings,
              ...decoded.nexusModels,
            },
            nexusModelBindings: undefined,
            workerMotion: undefined,
          }),
      ...(decoded.structureModels === undefined ||
      scene.structureModelBindings === undefined
        ? {}
        : {
            structureModels: {
              bindings: scene.structureModelBindings,
              ...decoded.structureModels,
            },
            turretLosses: decoded.turretLosses,
            structureModelBindings: undefined,
            workerMotion: undefined,
          }),
      ...(decoded.inhibitorModels === undefined ||
      scene.inhibitorModelBindings === undefined
        ? {}
        : {
            inhibitorModels: {
              bindings: scene.inhibitorModelBindings,
              instances: decoded.inhibitorModels.instances,
            },
            inhibitorLosses: decoded.inhibitorLosses,
            inhibitorModelBindings: undefined,
            workerMotion: undefined,
          }),
      ...(decoded.laneMinionInstances === undefined
        ? {}
        : {
            worldUnitModels: loadWorldUnits(
              worldScene,
              decoded.laneMinionInstances,
              decoded.laneMinionCoverage,
            ),
            laneMinionModelBindings: undefined,
            workerMotion: undefined,
          }),
      ...(decoded.teamVision === undefined
        ? {}
        : { teamVision: decoded.teamVision, workerMotion: undefined }),
      ...(decoded.terrainVisibility === undefined
        ? {}
        : {
            terrainVisibility: decoded.terrainVisibility,
            workerMotion: undefined,
          }),
      ...(championStats === undefined
        ? {}
        : { ...championStats, workerMotion: undefined }),
      ...(inventoryTracks === undefined || inventoryItems === undefined
        ? {}
        : {
            championInventory: {
              items: inventoryItems,
              tracks: inventoryTracks,
            },
            championInventoryItems: undefined,
            workerMotion: undefined,
          }),
      ...(experienceTracks === undefined || experienceThresholds === undefined
        ? {}
        : {
            championExperience: {
              thresholds: experienceThresholds,
              tracks: experienceTracks,
            },
            championExperienceThresholds: undefined,
            workerMotion: undefined,
          }),
      ...(animationCues === undefined
        ? {}
        : {
            championAnimationCues:
              animationCues.length === 0 ? undefined : animationCues,
            workerMotion: undefined,
          }),
      ...(decoded.recordedPlayerState === undefined
        ? {}
        : { ...decoded.recordedPlayerState, workerMotion: undefined }),
      ...(championModels === undefined
        ? {}
        : { championModels, workerMotion: undefined }),
    },
    heights,
    announcerCues: decoded.announcerCues,
    playerNames: decoded.playerNames,
    laneHealth: decoded.laneHealth,
  };
}

export function prepareScene(
  scene: TerrainScene,
  heights: Float32Array | undefined,
  {
    inventoryPoints,
    playerNames,
    laneHealth,
  }: {
    inventoryPoints?: ReplayInventoryPoints;
    playerNames?: z.infer<typeof WorkerPlayerNames>;
    laneHealth?: ReadonlyMap<
      number,
      z.infer<typeof LaneMinionHealthSchema>[number]
    >;
  } = {},
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
  const championNames = new Map(
    trace.participants.map(({ participantId, championName }) => [
      participantId,
      championName,
    ]),
  );
  const names = new Map<number, string>();
  for (const { participantId, gameName } of playerNames ?? []) {
    if (!championNames.has(participantId) || names.has(participantId))
      throw Error(
        "Replay player name does not identify a unique scene participant.",
      );
    names.set(participantId, gameName);
  }
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
      const resource = championResourceAt(participantId, timeSeconds);
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
  function championResourceAt(participantId: number, timeSeconds: number) {
    const points = resourceTracks?.get(participantId)?.resource;
    return points && lastAtOrBefore(points, timeSeconds, ([time]) => time);
  }
  function championNameplateAt(participantId: number, timeSeconds: number) {
    const name = names.get(participantId) ?? championNames.get(participantId);
    if (name === undefined) return;
    const experience = experienceTracks?.get(participantId)?.points;
    const level =
      experience &&
      lastAtOrBefore(experience, timeSeconds, ([time]) => time)?.[2];
    const resource = championResourceAt(participantId, timeSeconds);
    return {
      name,
      ...(level === undefined ? {} : { level }),
      ...(resource === undefined || resource[2] === 0
        ? {}
        : { resource: { current: resource[1], max: resource[2] } }),
    };
  }
  function laneMinionHealthAt(context: number, timeSeconds: number) {
    const track = laneHealth?.get(context);
    return track === undefined
      ? undefined
      : sampleRecordedLaneMinionHealth(track, timeSeconds);
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
        markers: {
          participantId: number;
          x: number;
          z: number;
          direction: readonly [number, number] | null;
        }[];
      } = sampleNativeTerrainMotion(motion, timeSeconds);
      for (const { participantId, x, z, direction } of sample.markers) {
        const teamId = teams.get(participantId);
        if (teamId === undefined)
          throw new Error("Motion marker has no participant.");
        const height = groundHeight(x, z);
        if (height !== null)
          markers.push({
            participantId,
            position: [x, height, z],
            teamId,
            ...(direction === null ? {} : { pathDirection: direction }),
          });
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
    laneMinionHealthAt: laneHealth?.size ? laneMinionHealthAt : undefined,
    championNameplateAt:
      healthTracks === null ? undefined : championNameplateAt,
  };
}

export async function loadRenderer(
  canvas: HTMLCanvasElement,
  scene: TerrainScene,
  signal: AbortSignal,
  read: ReadTerrainAsset,
  render: RendererModule,
  hasRecordedParticles: boolean,
  mayhemImpactComparison = false,
) {
  const chaosTurret = scene.structureModels?.bindings.find(
    ({ collapse }) => collapse !== undefined,
  );
  const [metadata, bytes, animationPalettesAt, turretCollapseAt] =
    await Promise.all([
      read("/map.json").then(parseTerrainJson),
      read("/map.bin"),
      scene.championAnimationCues === undefined
        ? undefined
        : loadRecordedChampionAnimations(
            scene.championAnimationCues,
            scene.identity.durationMilliseconds / 1000,
            read,
          ),
      chaosTurret?.collapse === undefined ||
      chaosTurret.settledRubble === undefined
        ? undefined
        : loadRecordedTurretCollapse(
            {
              url: chaosTurret.url,
              collapse: chaosTurret.collapse,
              settledRubble: chaosTurret.settledRubble,
            },
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
  let recordedParticles: LoadedTerrainParticles | undefined;
  let flowMapControl:
    Awaited<ReturnType<typeof loadFlowMapControl>> | undefined;
  try {
    if (scene.mayhemFlowMapControl !== undefined)
      flowMapControl = await loadFlowMapControl(read);
    if (hasRecordedParticles)
      recordedParticles = await loadRecordedTerrainParticles(
        read,
        { ...scene.identity, mayhemImpactComparison },
        signal,
      );
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
      turretCollapseAt,
      recordedParticles,
      flowMapControl,
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
    recordedParticles?.closeImages();
    flowMapControl?.closeImages();
  }
  return renderer;
}
