import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

export function indexChampionAnimationActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0)
    throw Error("Expected authored champion animation actions.");
  const byName = new Map();
  const { rig: actorRig, bindings: actorBindings } = actions[0] ?? {};
  for (const action of actions) {
    const { name, durationSeconds, rig, clip, bindings } = action ?? {};
    if (
      typeof name !== "string" ||
      name.length >= 256 ||
      !/^[A-Za-z0-9_]+$/u.test(name) ||
      byName.has(name) ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      typeof rig !== "string" ||
      !/^\/champion-animations\/[a-f0-9]{64}\.skl$/u.test(rig) ||
      rig !== actorRig ||
      typeof clip !== "string" ||
      !/^\/champion-animations\/[a-f0-9]{64}\.clip$/u.test(clip) ||
      typeof bindings !== "string" ||
      !/^\/champion-animations\/[a-f0-9]{64}\.json$/u.test(bindings) ||
      bindings !== actorBindings
    )
      throw Error("Invalid authored champion animation action.");
    byName.set(name, { durationSeconds, rig, clip, bindings });
  }
  return byName;
}

/** Join the authored, digest-addressed model table to the observed roster. */
export function selectChampionAnimations(replay, catalog, championModels) {
  if (
    replay.build !== currentTerrainPositionBuild ||
    replay.protocol !== terrainPositionProtocol ||
    catalog?.build !== replay.build ||
    catalog.protocol !== replay.protocol ||
    Object.hasOwn(catalog, "replaySha256") ||
    !Array.isArray(catalog.models) ||
    !Array.isArray(championModels?.bindings) ||
    championModels.bindings.length !== 10
  )
    throw Error(
      "Build-scoped champion animations require exact selected models.",
    );
  const models = new Map();
  for (const row of catalog.models) {
    const { model, actions } = row ?? {};
    if (
      typeof model !== "string" ||
      !/^\/champion-models\/[a-f0-9]{64}\.glb$/u.test(model) ||
      models.has(model)
    )
      throw Error("Build-scoped champion animation models must be distinct.");
    models.set(model, indexChampionAnimationActions(actions));
  }
  const actors = new Map();
  const missingModel = [];
  const participants = new Set();
  for (const { participantId, url: model } of championModels.bindings) {
    if (
      !Number.isSafeInteger(participantId) ||
      participantId <= 0 ||
      participants.has(participantId)
    )
      throw Error("Build-scoped animations require distinct selected actors.");
    participants.add(participantId);
    const actions = models.get(model);
    if (actions === undefined) missingModel.push(participantId);
    else actors.set(participantId, { model, actions });
  }
  return { actors, omissions: { missingModel } };
}
