import { prepareNativeTerrainInhibitors } from "./native-terrain-inhibitors.mjs";
import {
  prepareNativeTerrainTurrets,
  turretPlacementReceiptDigests,
} from "./native-terrain-turrets.mjs";

function readAuthoredTeam({ characterRecord, asset, explicitTeam }) {
  if (
    characterRecord === "Characters/Inhibitor/CharacterRecords/SR_Order" &&
    asset === "inhibitor/0" &&
    explicitTeam === null
  )
    return 100;
  if (
    characterRecord === "Characters/Inhibitor/CharacterRecords/SR_Chaos" &&
    asset === "inhibitor/3" &&
    explicitTeam === 200
  )
    return 200;
  throw Error("Unexpected authored inhibitor appearance");
}

/** Bind the authenticated Map11 registration to original replay contexts and lifetimes. */
export function bindNativeTerrainInhibitorCatalog(
  prepared,
  receipt,
  catalog,
  options,
  turrets,
) {
  const { build, protocol } = prepared.packetReader;
  if (
    catalog?.schema !== 1 ||
    catalog.kind !== "exact-native-terrain-inhibitor-catalog" ||
    catalog.build !== build ||
    catalog.protocol !== protocol ||
    catalog.placementReceiptSha256 !== turretPlacementReceiptDigests[build] ||
    catalog.installedMapSha256 !== receipt.installedSha256 ||
    !Array.isArray(catalog.registration) ||
    catalog.registration.length !== 38
  )
    throw Error("Inhibitor catalog differs from the exact Map11 source");
  const { opening } =
    turrets ?? prepareNativeTerrainTurrets(prepared, receipt, options);
  const inhibitors = prepareNativeTerrainInhibitors(prepared, options);
  const openingInhibitors = new Set(
    inhibitors.read(0).inhibitors.map(({ context }) => context),
  );
  const registration = resolveNativeTerrainInhibitorRegistration(
    catalog.registration,
    opening,
    openingInhibitors,
  );
  if (inhibitors.losses === null)
    throw Error("Incomplete exact inhibitor placement or lifecycle evidence");
  return {
    ...registration,
    losses: inhibitors.losses,
    renderableLosses: inhibitors.renderableLosses,
    ...(inhibitors.inactivity === undefined
      ? {}
      : { inactivity: inhibitors.inactivity }),
    presentationOmissions: inhibitors.presentationOmissions,
    unresolvedSnapshotStates: inhibitors.unresolvedSnapshotStates,
  };
}

export function resolveNativeTerrainInhibitorRegistration(
  registration,
  opening,
  openingInhibitors,
) {
  const turretByName = new Map(opening.map((row) => [row.mapNameHash, row]));
  const firstContext = turretByName.get(registration[0]?.mapNameHash)?.context;
  if (!firstContext) throw Error("Missing opening Map11 structure anchor");
  const turretAnchors = [];
  const instances = [];
  const installedOffsets = new Set();
  const names = new Set();
  const typeCounts = { barracks: 0, 0: 0, 1: 0, 2: 0 };
  for (const [index, row] of registration.entries()) {
    const context = firstContext + index;
    const { mapNameHash, transform, placementSource } = row;
    const type = row.kind === "barracks" ? "barracks" : row.attackableType;
    if (
      (type !== "barracks" && ![0, 1, 2].includes(type)) ||
      !Number.isInteger(mapNameHash) ||
      mapNameHash < 1 ||
      mapNameHash > 0xffffffff ||
      names.has(mapNameHash) ||
      !Number.isSafeInteger(placementSource?.installedOffset) ||
      placementSource.installedOffset < 0 ||
      installedOffsets.has(placementSource.installedOffset) ||
      !Number.isSafeInteger(placementSource.archivedOffset) ||
      placementSource.archivedOffset < 0 ||
      !Number.isInteger(placementSource.bytes) ||
      placementSource.bytes <= 0 ||
      typeof placementSource.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(placementSource.sha256) ||
      !Array.isArray(transform) ||
      transform.length !== 4 ||
      transform.some(
        (column, axis) =>
          !Array.isArray(column) ||
          column.length !== 4 ||
          !column.every(Number.isFinite) ||
          column[3] !== Number(axis === 3),
      )
    )
      throw Error("Invalid or duplicate authored Map11 registration row");
    names.add(mapNameHash);
    installedOffsets.add(placementSource.installedOffset);
    typeCounts[type]++;
    if (type === 0) {
      const anchor = turretByName.get(mapNameHash);
      if (
        anchor?.context !== context ||
        anchor.worldPosition.some(
          (coordinate, axis) => coordinate !== transform[3][axis],
        )
      )
        throw Error(
          "Replay turret anchors disagree with authored registration order",
        );
      turretAnchors.push(anchor);
    }
    if (type !== 1) continue;
    if (!openingInhibitors.delete(context))
      throw Error("Inhibitor slot lacks independent recorded opening state");
    const team = readAuthoredTeam(row);
    instances.push({
      context,
      mapNameHash,
      assetId: row.asset.replace("/", "-"),
      team,
      transform: transform.flat(),
      placementSource,
    });
  }
  if (
    typeCounts.barracks !== 6 ||
    typeCounts[0] !== 24 ||
    typeCounts[1] !== 6 ||
    typeCounts[2] !== 2 ||
    openingInhibitors.size !== 0 ||
    instances.filter(({ team }) => team === 100).length !== 3
  )
    throw Error("Incomplete exact inhibitor placement or lifecycle evidence");
  return { turretAnchors, instances };
}
