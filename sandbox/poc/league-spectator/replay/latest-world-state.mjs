import { sha256 } from "./structural-comparison.mjs";
import { LATEST_REPLICATION_SHA } from "./latest-replication.mjs";
import { bindLatestBuildings, bindLatestMinions } from "./latest-world.mjs";
import { decodeRegisteredState } from "./latest-state-fields.mjs";
import { assertLatestSelectedWorldState } from "./latest-selected-world-state.mjs";
import { WORLD_STATE_SHA } from "./latest-world-state-contract.mjs";
export { WORLD_STATE_SHA } from "./latest-world-state-contract.mjs";

export async function createLatestWorldStateReader(
  profile,
  image,
  bytes,
  sceneBytes,
  catalogBytes,
  staticCatalog = null,
) {
  if (staticCatalog !== null)
    await assertLatestSelectedWorldState({
      selection: staticCatalog,
      profile,
      packageBytes: bytes,
      sceneBytes,
      catalogBytes,
    });
  else if ((await sha256(bytes)) !== WORLD_STATE_SHA)
    throw Error("Pinned world state schema required");
  const parse = (b) =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)),
    meta = parse(bytes),
    scene = parse(sceneBytes),
    catalog = parse(catalogBytes);
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-world-state-schema" ||
    meta.build !== "16.21.829.8620" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !== profile.sliceSha256 ||
    meta.replicationPackageSha256 !== LATEST_REPLICATION_SHA ||
    meta.sceneManifestSha256 !== (await sha256(sceneBytes)) ||
    meta.worldCatalogSha256 !== (await sha256(catalogBytes)) ||
    meta.mapId !== scene.map.id ||
    catalog.mapId !== meta.mapId ||
    meta.optionalObserverConfig !== false
  )
    throw Error("Unsupported world state package");
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original world state instructions changed");
  function bind(report) {
    const entities = [],
      ids = new Set(report.heroes.map((h) => h.entityId));
    const add = (e) => {
      if (ids.has(e.entityId))
        throw Error("World identity collision/generation reuse unresolved");
      ids.add(e.entityId);
      entities.push(e);
    };
    for (const b of bindLatestBuildings(report, scene, catalog)) {
      if (b.asset.character !== "Turret")
        throw Error("Unadmitted building replication class");
      add({
        entityId: b.event.entityId,
        entityClass: "turret",
        creationTime: b.event.time,
        asset: b.object.asset,
        characterRecords: [b.object.characterRecord],
        team: b.event.team,
        replicationSchema: "turret",
        healthBarHeight: null,
      });
    }
    for (const b of bindLatestMinions(report, scene, catalog).minions) {
      const paths = [...new Set(b.unit.records.map((r) => r.characterRecord))],
        records = paths.map((p) => meta.assets[b.unit.asset]?.records[p]);
      if (
        !records.length ||
        records.some((r) => !r) ||
        records.some(
          (r) =>
            r.schema !== records[0].schema ||
            r.healthBarHeight !== records[0].healthBarHeight,
        )
      )
        throw Error(
          "Minion replication/overhead definition is unprepared or ambiguous",
        );
      add({
        entityId: b.event.entityId,
        entityClass: "lane-minion",
        creationTime: b.event.time,
        asset: b.unit.asset,
        characterRecords: paths,
        team: null,
        replicationSchema: records[0].schema,
        healthBarHeight: records[0].healthBarHeight,
      });
    }
    return entities;
  }
  function worldState(record, entity) {
    const schema = meta.classes[entity.replicationSchema];
    if (
      !schema ||
      record.entityId !== entity.entityId ||
      record.time < entity.creationTime
    )
      throw Error("World replication does not match admitted entity lifetime");
    return decodeRegisteredState(record, schema);
  }
  function reconstruct(report) {
    const entities = bind(report),
      ids = new Map(entities.map((e) => [e.entityId, e])),
      updates = [];
    for (const record of report.replicationRecords) {
      const entity = ids.get(record.entityId);
      if (!entity) continue;
      const decoded = worldState(record, entity);
      if (!Object.keys(decoded.values).length) continue;
      updates.push({
        entityId: entity.entityId,
        ...decoded.values,
        time: record.time,
        transportSequence: record.transportSequence,
        recordIndex: record.recordIndex,
        stateSequence: updates.length,
        chunkId: record.chunkId,
        blockOffset: record.blockOffset,
        stream: record.stream,
      });
    }
    return { entities, updates };
  }
  return { metadata: structuredClone(meta), bind, worldState, reconstruct };
}
