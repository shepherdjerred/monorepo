// Match entities come only from decoded packets. This joins their map hashes to
// an offline, build-specific static catalog, never to a prepared match roster.
export function bindLatestBuildings(report, manifest, catalog) {
  if (
    catalog.schema !== 1 ||
    report.build !== manifest.build ||
    catalog.build !== report.build ||
    catalog.protocol !== report.protocol ||
    manifest.protocol !== report.protocol ||
    catalog.mapId !== manifest.map.id
  )
    throw Error("World catalog and replay package differ");
  const ids = new Set(),
    names = new Set(),
    buildings = [];
  for (const event of report.worldEvents) {
    if (event.kind !== "building-identity-candidate") continue;
    const object = catalog.objects[event.mapNameHash];
    if (!object)
      throw Error(`Unprepared building map hash ${event.mapNameHash}`);
    if (object.mapNameHash !== event.mapNameHash)
      throw Error("Static building hash contract mismatch");
    const asset = catalog.assets[object.asset];
    if (!asset) throw Error(`Unprepared building skin ${object.asset}`);
    if (object.explicitTeam !== null && object.explicitTeam !== event.team)
      throw Error("Recorded building team differs from static map");
    if (ids.has(event.entityId) || names.has(event.mapNameHash))
      throw Error("Duplicate decoded building identity");
    if (
      !Number.isFinite(event.time) ||
      event.time < 0 ||
      !Array.isArray(object.transform) ||
      object.transform.length !== 4 ||
      object.transform.some(
        (row) => row.length !== 4 || !row.every(Number.isFinite),
      ) ||
      !Number.isFinite(asset.scale) ||
      asset.scale <= 0
    )
      throw Error("Invalid building presentation fields");
    ids.add(event.entityId);
    names.add(event.mapNameHash);
    buildings.push({ event, object, asset });
  }
  return buildings;
}

export function bindLatestMinions(report, manifest, catalog) {
  const towers = bindLatestBuildings(report, manifest, catalog),
    registry = catalog.registration;
  if (
    !Array.isArray(registry) ||
    !registry.length ||
    towers.length !== Object.keys(catalog.objects).length
  )
    throw Error("Minion registry requires every prepared tower anchor");
  const names = new Map(),
    offsets = new Set();
  for (const [index, object] of registry.entries()) {
    if (
      !Number.isInteger(object.keyHash) ||
      object.keyHash < 0 ||
      object.keyHash > 0xffffffff ||
      (index && registry[index - 1].keyHash >= object.keyHash) ||
      names.has(object.mapNameHash)
    )
      throw Error("Invalid static map registration order");
    names.set(object.mapNameHash, index);
  }
  for (const tower of towers) {
    const ordinal = names.get(tower.event.mapNameHash);
    if (ordinal === undefined)
      throw Error("Tower anchor absent from static registry");
    offsets.add(tower.event.entityId - ordinal);
  }
  if (offsets.size !== 1)
    throw Error(
      "Recorded towers contradict the candidate map registration order",
    );
  const registrationBase = [...offsets][0];
  if (
    !Number.isInteger(registrationBase) ||
    registrationBase < 1 ||
    registrationBase + registry.length - 1 > 0xffffffff
  )
    throw Error("Invalid inferred static registry base");
  const ids = new Set(),
    minions = [];
  for (const event of report.worldEvents) {
    if (event.kind !== "lane-minion-creation-candidate") continue;
    const barracks = registry[event.barracksId - registrationBase];
    if (barracks?.kind !== "barracks")
      throw Error(`Unbound recorded barracks ${event.barracksId}`);
    const unit = barracks.units[event.unitType],
      asset = catalog.assets[unit?.asset];
    if (!unit || !asset)
      throw Error(`Unprepared minion type ${event.unitType}`);
    if (ids.has(event.entityId))
      throw Error("Repeated minion creation/entity reuse is not implemented");
    ids.add(event.entityId);
    minions.push({
      event,
      barracks,
      unit,
      asset,
      creationPosition: barracks.transform[3].slice(0, 3),
    });
  }
  return {
    minions,
    registrationBase,
    anchors: towers.length,
    status: catalog.registrationStatus,
  };
}
