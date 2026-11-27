import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { resolveNativeTerrainInhibitorRegistration } from "./native-terrain-inhibitor-catalog.mjs";
import { createCurrentInhibitorLifecycleCollector } from "./native-terrain-inhibitor-lifecycle.mjs";
import { readCurrentInhibitorPacketState } from "./native-terrain-inhibitor-packet.mjs";
import { readOpeningBindings } from "./native-terrain-turrets.mjs";

export function prepareCurrentInhibitorOpening(packetReader, catalog) {
  if (
    packetReader.build !== currentTerrainPositionBuild ||
    packetReader.protocol !== terrainPositionProtocol ||
    catalog?.build !== packetReader.build ||
    catalog.protocol !== packetReader.protocol ||
    Object.hasOwn(catalog, "replaySha256") ||
    !Array.isArray(catalog.registration) ||
    catalog.registration.length !== 38 ||
    !Array.isArray(catalog.models) ||
    catalog.models.length !== 2
  )
    throw Error("Expected the exact build-scoped Map11 inhibitor catalog");
  const models = new Map(catalog.models);
  const orderModel = models.get("inhibitor/0");
  const chaosModel = models.get("inhibitor/3");
  if (
    !Number.isSafeInteger(orderModel) ||
    !Number.isSafeInteger(chaosModel) ||
    orderModel <= 0 ||
    chaosModel <= 0 ||
    orderModel === chaosModel
  )
    throw Error("Expected two distinct authored inhibitor models");

  const placements = new Map(
    catalog.registration
      .filter(
        ({ kind, attackableType }) =>
          kind === "building" && attackableType === 0,
      )
      .map(({ mapNameHash, transform }) => [
        mapNameHash,
        transform[3].slice(0, 3),
      ]),
  );
  const opening = new Map();
  const anchors = readOpeningBindings(
    packetReader,
    placements,
    (opcode, context, payload) => {
      if (opcode !== 947) return;
      const state = readCurrentInhibitorPacketState(payload);
      if (state !== "alive" || opening.has(context))
        throw Error("Invalid or duplicate recorded opening inhibitor state");
      opening.set(context, state);
    },
  );
  const { instances } = resolveNativeTerrainInhibitorRegistration(
    catalog.registration,
    [...anchors].map(([context, row]) => ({ context, ...row })),
    new Set(opening.keys()),
  );
  return {
    opening,
    instances: instances.map(({ context, team, transform }) => ({
      context,
      participantId: team === 100 ? orderModel : chaosModel,
      position: transform.slice(12, 15),
      basis: [
        ...transform.slice(0, 3),
        ...transform.slice(4, 7),
        ...transform.slice(8, 11),
      ],
      teamId: team,
      destroyedAtSeconds: null,
      inactiveRanges: [],
    })),
  };
}

export function createCurrentReplayInhibitorCollector(prepared, catalog) {
  const { packetReader, observations } = prepared;
  const { opening, instances } = prepareCurrentInhibitorOpening(
    packetReader,
    catalog,
  );
  if (!Array.isArray(observations.structures))
    throw Error("Expected independently verified structure loss history");
  const losses = observations.structures.filter(
    ({ kind }) => kind === "inhibitor-destruction",
  );
  const { observe, finish } = createCurrentInhibitorLifecycleCollector(
    packetReader,
    opening,
    losses,
    readCurrentInhibitorPacketState,
  );
  return {
    instances,
    observe,
    finish() {
      const { inactivity } = finish();
      const firstLosses = new Map();
      for (const { context, timeSeconds } of losses)
        if (!firstLosses.has(context)) firstLosses.set(context, timeSeconds);
      return {
        inhibitorModels: {
          instances: instances.map((instance) => ({
            ...instance,
            destroyedAtSeconds: firstLosses.get(instance.context) ?? null,
            inactiveRanges: inactivity.get(instance.context),
          })),
        },
        inhibitorLosses: losses.map(({ timeSeconds }) => ({ timeSeconds })),
      };
    },
  };
}
