import {
  prepareNativeTerrainTurrets,
  turretPlacementReceiptDigests,
} from "./native-terrain-turrets.mjs";

/** Bind installed Map11 authoring to this replay's independently verified actors. */
export function bindNativeTerrainTurretCatalog(
  prepared,
  receipt,
  catalog,
  options,
  turrets,
) {
  const { build, protocol } = prepared.packetReader;
  if (
    catalog?.schema !== 1 ||
    catalog.build !== build ||
    catalog.protocol !== protocol ||
    catalog.kind !== "exact-native-terrain-turret-catalog" ||
    catalog.placementReceiptSha256 !== turretPlacementReceiptDigests[build] ||
    !Array.isArray(catalog.placeables)
  )
    throw Error(
      "Turret catalog differs from the exact replay build and protocol",
    );
  const positions = new Map(
    receipt.records.map(({ mapNameHash, translation }) => [
      mapNameHash,
      translation,
    ]),
  );
  const placeables = new Map();
  for (const row of catalog.placeables) {
    const { mapNameHash, asset, transform, characterRecord } = row;
    const position = positions.get(mapNameHash);
    if (
      placeables.has(mapNameHash) ||
      position === undefined ||
      typeof asset !== "string" ||
      typeof characterRecord !== "string" ||
      !Array.isArray(transform) ||
      transform.length !== 4 ||
      transform.some(
        (column, index) =>
          !Array.isArray(column) ||
          column.length !== 4 ||
          !column.every(Number.isFinite) ||
          column[3] !== Number(index === 3),
      ) ||
      position.some((axis, index) => axis !== transform[3][index])
    )
      throw Error("Invalid or duplicate authored turret placeable");
    placeables.set(mapNameHash, row);
  }
  if (placeables.size !== positions.size)
    throw Error("Turret catalog omits an authored Map11 placeable");
  const {
    opening,
    renderableLosses: losses,
    presentationOmissions,
  } = turrets ?? prepareNativeTerrainTurrets(prepared, receipt, options);
  const disputedContexts = new Set(
    presentationOmissions.map(({ context }) => context),
  );
  const lossTimes = new Map(
    losses.map(({ context, timeSeconds }) => [context, timeSeconds]),
  );
  const instances = [];
  const omitted = [];
  for (const { context, mapNameHash } of opening) {
    const { asset, transform, characterRecord } = placeables.get(mapNameHash);
    if (disputedContexts.has(context)) continue;
    if (asset !== "turret/0" && asset !== "turret/3") {
      omitted.push({
        context,
        mapNameHash,
        asset,
        reason: "Nonstandard structure without verified lifetime",
      });
      continue;
    }
    instances.push({
      context,
      mapNameHash,
      characterRecord,
      transform: transform.flat(),
      assetId: asset.replace("/", "-"),
      destroyedAtSeconds: lossTimes.get(context) ?? null,
    });
  }
  if (
    instances.length !== 22 - presentationOmissions.length ||
    instances.filter(({ destroyedAtSeconds }) => destroyedAtSeconds !== null)
      .length !== losses.length
  )
    throw Error("Verified losses must belong to the 22 authored turret cohort");

  const snapshots = new Map(
    instances.map(({ context }) => [
      context,
      { alive: 0, dead: 0, missing: 0 },
    ]),
  );
  const reader = prepared.packetReader;
  const lastFrame = reader.keyframes.at(-1);
  for (const frame of reader.keyframes) {
    const { packets } = reader.read(frame.timeSeconds);
    const state = new Map();
    let context = 0;
    let opcode;
    for (const packet of packets) {
      if (packet.stream !== 2 || packet.chunkOffset !== frame.chunkOffset)
        continue;
      opcode = packet.explicitOpcode ?? opcode;
      context =
        packet.marker & 32
          ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
          : packet.paramBits;
      if (
        opcode !== 1012 ||
        packet.payload.length !== 41 ||
        !snapshots.has(context)
      )
        continue;
      const observedDead = (packet.payload[13] & 8) === 0;
      if (state.has(context) && state.get(context) !== observedDead)
        throw Error("Conflicting recorded turret snapshot state");
      state.set(context, observedDead);
    }
    for (const { context, destroyedAtSeconds } of instances) {
      if (frame.timeSeconds === destroyedAtSeconds) continue;
      const dead = state.get(context);
      if (dead === undefined) {
        if (
          frame.timeSeconds === 0 ||
          (frame === lastFrame && destroyedAtSeconds === null)
        )
          throw Error("Required opening or surviving turret snapshot absent");
        snapshots.get(context).missing++;
        continue;
      }
      if (
        dead !==
        (destroyedAtSeconds !== null && frame.timeSeconds > destroyedAtSeconds)
      )
        throw Error(
          "Recorded turret state disagrees with verified loss history",
        );
      snapshots.get(context)[dead ? "dead" : "alive"]++;
    }
  }

  return {
    instances,
    losses,
    omitted,
    presentationOmissions,
    snapshotEvidence: {
      lastSnapshotSeconds: lastFrame.timeSeconds,
      keyframes: reader.keyframes.length,
      counts: Object.fromEntries(snapshots),
    },
  };
}
