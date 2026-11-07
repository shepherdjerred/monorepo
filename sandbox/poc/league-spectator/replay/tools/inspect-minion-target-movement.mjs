// Read-only planning from an exact archived decode. It is deliberately not an
// ordinary current-source reconstruction or a new target-acceptance capability.
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sha256 } from "../structural-comparison.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { prepareLatestMovement } from "../latest-movement.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [cacheArg = ".cache/replay-spike", ...entityArgs] = process.argv.slice(2),
  cache = resolve(cacheArg),
  ids = entityArgs.map(Number),
  inputs = {};
if (
  !ids.length ||
  ids.some((id) => !Number.isInteger(id) || id <= 0 || id > 0xffffffff) ||
  new Set(ids).size !== ids.length
)
  throw Error(
    "Usage: bun inspect-minion-target-movement.mjs <cache> <minion-id> [...minion-ids]",
  );
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const archivedBytes = await raw(
  `${cache}/research/viewer-root-reconstruction-v35-pre-startup.json`,
);
if (
  (await sha256(archivedBytes)) !==
  "ecf27e0bdea9dca4a048d5c46aca7c6c0a1401e89bb8c9c59f436877f581d681"
)
  throw Error("Exact pre-startup archived decode required");
const archived = JSON.parse(new TextDecoder().decode(archivedBytes)),
  report = archived.report,
  scene = await read(`${cache}/public/latest-scene/manifest.json`),
  heightBytes = await raw(`${cache}/public/latest-scene/heights.bin`),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(
      heightBytes.buffer,
      heightBytes.byteOffset,
      heightBytes.byteLength / 4,
    ),
  ),
  movement = prepareLatestMovement(report, scene.map),
  world = createLatestWorldPresentation({ report, scene, terrain }),
  historicalSourceDrift = [],
  rows = [];
for (const [path, oldSha256] of Object.entries(archived.inputs)) {
  const actual = await sha256(await raw(path));
  if (actual !== oldSha256)
    historicalSourceDrift.push({ path, oldSha256, currentSha256: actual });
}
const summarize = (entity) =>
  entity
    ? {
        entityClass: entity.entityClass,
        position: entity.position,
        positionStatus: entity.positionStatus,
        positionSource: entity.positionSource,
        direction: entity.direction,
        orientationStatus: entity.orientationStatus,
        reasons: entity.reasons,
      }
    : null;
for (const id of ids) {
  const entity = report.worldEntities.find((row) => row.entityId === id),
    creation = report.worldEvents.find(
      (row) =>
        row.entityId === id && row.kind === "lane-minion-creation-candidate",
    ),
    rawTrack = report.movement.filter((row) => row.entityId === id),
    accepted = movement.tracks.get(id),
    missiles = report.missiles.filter(
      (row) =>
        row.time >= 69 &&
        row.time <= 99 &&
        row.cast.requestedTargets.some(
          (target) => target.requestedEntityId === id,
        ),
    );
  if (
    entity?.entityClass !== "lane-minion" ||
    !creation ||
    !accepted?.length ||
    !missiles.length
  )
    throw Error(
      "Recorded minion creation, causal movement and requested-target cohort required",
    );
  const first = accepted[0],
    initialCursor = {
      transportSequence: first.transportSequence,
      entryOrder: first.entryOrder ?? 0,
    },
    before = world.entity(id, first.time, {
      ...initialCursor,
      exclusive: true,
    }),
    atFirst = world.entity(id, first.time, initialCursor);
  if (
    before.position !== null ||
    atFirst.position === null ||
    atFirst.positionSource.transportSequence !== first.transportSequence
  )
    throw Error(
      "First recorded movement must own position availability at its exact cursor",
    );
  const queries = [];
  for (const missile of missiles) {
    const cursor = {
        transportSequence: missile.transportSequence,
        entryOrder: missile.entryOrder ?? 0,
      },
      causal = accepted.filter(
        (record) =>
          record.time < missile.time ||
          (record.time === missile.time &&
            (record.transportSequence < cursor.transportSequence ||
              (record.transportSequence === cursor.transportSequence &&
                (record.entryOrder ?? 0) <= cursor.entryOrder))),
      ),
      value = world.entity(id, missile.time, cursor),
      visibility = world.visibility(id, missile.time, cursor),
      target = world.presentationTarget(id, missile.time, cursor);
    if (
      !causal.length ||
      value.position === null ||
      value.positionSource.transportSequence !== causal.at(-1).transportSequence
    )
      throw Error("Causal minion movement was omitted from world presentation");
    world.entity(id, first.time, { ...initialCursor, exclusive: true });
    if (!isDeepStrictEqual(value, world.entity(id, missile.time, cursor)))
      throw Error("Repeated/backward world query changed minion position");
    queries.push({
      sourceEventId: `packet:${missile.transportSequence}:entry:${missile.entryOrder ?? 0}:missile:${missile.entityId}`,
      sequence: missile.sequence,
      time: missile.time,
      cursor,
      causalMovementRecords: causal.length,
      latestMovement: causal.at(-1),
      entity: summarize(value),
      visibility,
      target,
      decodedCastTarget: missile.cast.targetPosition,
      castTargetDeltaFromWorldPreview: missile.cast.targetPosition.map(
        (n, i) => n - value.position[i],
      ),
      priorVisibilityPackets: report.visibilityRequests.filter(
        (request) => request.entityId === id && request.time <= missile.time,
      ),
      movementQuantizationScope:
        "Shared exact-build decoded waypoint origin and2unit quantization; interpolation/terrain-Y remains existing presentation policy, not native live target parity",
    });
  }
  rows.push({
    entityId: id,
    entity,
    creation,
    rawMovementRecords: rawTrack.length,
    acceptedMovementRecords: accepted.length,
    rejectedMovementRecords: movement.rejected.filter(
      (row) => row.entityId === id,
    ),
    firstRecordedMovement: first,
    beforeFirstMovement: summarize(before),
    atFirstMovement: summarize(atFirst),
    queries,
  });
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Minion movement input changed: ${path}`);
const result = {
  schema: 1,
  kind: "archived-minion-target-movement-conjunction",
  inputs,
  historicalSourceDrift,
  recordedInputSha256: await sha256(archivedBytes),
  currentWorldAdapterQueries: true,
  rows,
  conclusion:
    "Recorded causal minion waypoint positions already reach world.entity; current target eligibility is blocked by unproven non-champion AI visibility component ownership, not absent decoded movement",
  scope: {
    archivedDecodedInputsOnly: true,
    currentOrdinaryReconstructionProof: false,
    noTargetGuardRelaxed: true,
    noBarracksProxyUsed: true,
    nativeLiveTargetAcceptance: null,
    browserObserved: false,
  },
};
await Bun.write(
  `${cache}/research/minion-target-movement-planning-v35.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    rows.map((row) => ({
      entityId: row.entityId,
      raw: row.rawMovementRecords,
      accepted: row.acceptedMovementRecords,
      queries: row.queries.map((query) => ({
        id: query.sourceEventId,
        position: query.entity.position,
        source: query.entity.positionSource,
        visibility: query.visibility.reasons,
        target: query.target.reasons,
      })),
    })),
  ),
);
