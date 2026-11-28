import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { bindNativeTerrainTurretCatalog } from "./native-terrain-turret-catalog.mjs";
import {
  createCurrentTurretSnapshotCollector,
  prepareNativeTerrainTurretOpening,
  prepareNativeTerrainTurrets,
  turretPlacementReceiptDigests,
} from "./native-terrain-turrets.mjs";

export function createCurrentReplayTurretCollector(prepared, input) {
  const { packetReader } = prepared;
  if (
    packetReader.build !== currentTerrainPositionBuild ||
    packetReader.protocol !== terrainPositionProtocol ||
    input?.build !== packetReader.build ||
    input.protocol !== packetReader.protocol ||
    Object.hasOwn(input, "replaySha256") ||
    !Array.isArray(input.placeables) ||
    input.placeables.length !== 24 ||
    !Array.isArray(input.models) ||
    input.models.length !== 2
  )
    throw Error("Expected the exact build-scoped Map11 turret catalog");
  const { build, protocol, placementReceipt, placeables } = input;
  const models = new Map(input.models);
  const orderModel = models.get("turret/0");
  const chaosModel = models.get("turret/3");
  if (
    !Number.isSafeInteger(orderModel) ||
    !Number.isSafeInteger(chaosModel) ||
    orderModel < 0 ||
    chaosModel < 0 ||
    orderModel === chaosModel
  )
    throw Error("Expected two distinct authored turret models");
  const options = { allowCurrentBuild: true };
  const turretOpening = prepareNativeTerrainTurretOpening(
    packetReader,
    placementReceipt,
    options,
  );
  const snapshotCollector = createCurrentTurretSnapshotCollector(
    packetReader,
    turretOpening.keys(),
  );
  const standardNames = new Set(
    placeables
      .filter(({ asset }) => models.has(asset))
      .map(({ mapNameHash }) => mapNameHash),
  );
  const candidateContexts = [...turretOpening]
    .filter(([, { mapNameHash }]) => standardNames.has(mapNameHash))
    .map(([context]) => context);

  return {
    candidateContexts,
    observe: snapshotCollector.observe,
    finish() {
      const reducerOptions = {
        ...options,
        turretOpening,
        turretSnapshots: snapshotCollector.finish(),
      };
      const turrets = prepareNativeTerrainTurrets(
        prepared,
        placementReceipt,
        reducerOptions,
      );
      const bound = bindNativeTerrainTurretCatalog(
        prepared,
        placementReceipt,
        {
          schema: 1,
          kind: "exact-native-terrain-turret-catalog",
          build,
          protocol,
          placementReceiptSha256: turretPlacementReceiptDigests[build],
          placeables,
        },
        reducerOptions,
        turrets,
      );
      const instances = bound.instances.map(
        ({ context, assetId, transform, destroyedAtSeconds }) => ({
          context,
          participantId: assetId === "turret-0" ? orderModel : chaosModel,
          position: transform.slice(12, 15),
          basis: [
            ...transform.slice(0, 3),
            ...transform.slice(4, 7),
            ...transform.slice(8, 11),
          ],
          destroyedAtSeconds,
        }),
      );
      if (
        new Set(instances.map(({ participantId }) => participantId)).size !== 2
      )
        throw Error("Expected both reviewed turret appearances to render");
      const omittedContexts = bound.presentationOmissions.map(
        ({ context }) => context,
      );
      return {
        structureModels: {
          instances,
          ...(omittedContexts.length === 0 ? {} : { omittedContexts }),
        },
        turretLosses: bound.losses,
      };
    },
  };
}
