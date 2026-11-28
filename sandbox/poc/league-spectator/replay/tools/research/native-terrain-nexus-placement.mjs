export const nexusPlacements = Object.freeze([
  Object.freeze({ mapNameHash: 1341187095, skinId: 0 }),
  Object.freeze({ mapNameHash: 712301631, skinId: 3 }),
]);

/** Bind the authenticated 38-slot Map11 registration to independent opening anchors. */
export function resolveNativeTerrainNexusPlacement(
  registration,
  placeables,
  opening,
) {
  const turretAnchors = new Map(opening.map((row) => [row.mapNameHash, row]));
  const firstContext = turretAnchors.get(registration[0]?.mapNameHash)?.context;
  if (!firstContext || turretAnchors.size !== 24)
    throw Error("Unexpected current Nexus registration cohort");
  const nexusContexts = new Map();
  const names = new Set();
  let barracks = 0;
  let inhibitors = 0;
  for (const [
    index,
    { mapNameHash, worldPosition, attackableType, kind },
  ] of registration.entries()) {
    const context = firstContext + index;
    if (
      !Number.isInteger(mapNameHash) ||
      mapNameHash < 1 ||
      mapNameHash > 0xffffffff ||
      names.has(mapNameHash) ||
      (kind !== "barracks" &&
        (kind !== "building" || ![0, 1, 2].includes(attackableType))) ||
      !Array.isArray(worldPosition) ||
      worldPosition.length !== 3 ||
      !worldPosition.every(Number.isFinite)
    )
      throw Error("Invalid or duplicate Nexus registration row");
    names.add(mapNameHash);
    if (kind === "barracks") {
      barracks++;
      continue;
    }
    if (attackableType === 1) inhibitors++;
    if (attackableType === 0) {
      const anchor = turretAnchors.get(mapNameHash);
      if (
        anchor?.context !== context ||
        anchor.worldPosition.some(
          (coordinate, axis) => coordinate !== worldPosition[axis],
        )
      )
        throw Error(
          "Nexus registration disagrees with a recorded turret anchor",
        );
      turretAnchors.delete(mapNameHash);
    }
    if (attackableType === 2)
      nexusContexts.set(mapNameHash, { context, worldPosition });
  }
  if (
    turretAnchors.size !== 0 ||
    nexusContexts.size !== 2 ||
    barracks !== 6 ||
    inhibitors !== 6
  )
    throw Error("Incomplete recorded Nexus anchors");
  const instances = nexusPlacements.map(({ mapNameHash, skinId }, index) => {
    const placement = placeables[index];
    const anchor = nexusContexts.get(mapNameHash);
    const { transform } = placement;
    if (
      anchor === undefined ||
      placement.mapNameHash !== mapNameHash ||
      placement.assetId !== `nexus-${skinId}` ||
      placement.characterRecord !== "Characters/Nexus/CharacterRecords/Root" ||
      !Array.isArray(transform) ||
      transform.length !== 16 ||
      !transform.every(Number.isFinite) ||
      [3, 7, 11, 15].some(
        (offset, i) => transform[offset] !== Number(i === 3),
      ) ||
      anchor.worldPosition.some((axis, i) => axis !== transform[12 + i])
    )
      throw Error("Invalid authored Nexus placement or appearance");
    return {
      context: anchor.context,
      mapNameHash,
      assetId: placement.assetId,
      characterRecord: placement.characterRecord,
      transform,
      placementSource: placement.placementSource,
      observedKeyframeSeconds: [],
      terminalState: "unverified",
    };
  });
  return instances;
}
