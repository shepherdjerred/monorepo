import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
} from "./latest-lifecycle.mjs";
import { CHAMPION_STATE_FIELDS } from "./latest-champion-state.mjs";
import { EXPERIENCE_SHA } from "./latest-experience.mjs";
import { createLatestInventory } from "./latest-inventory.mjs";
import {
  COMBAT_STATS_SHA,
  COMBAT_STAT_FIELDS,
} from "./latest-combat-stats.mjs";

// Sparse field observations carry forward independently. Sampling is absolute
// and never depends on the direction of the viewer's previous seek.
export function createLatestReplayState(report, worldState = null) {
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    !Array.isArray(report.championStateUpdates) ||
    !Array.isArray(report.playerIdentities)
  )
    throw Error("Latest champion state input required");
  const hasExperience = Object.hasOwn(report, "experienceUpdates");
  if (
    hasExperience !== Object.hasOwn(report, "experiencePackageSha256") ||
    (hasExperience &&
      (!Array.isArray(report.experienceUpdates) ||
        report.experiencePackageSha256 !== EXPERIENCE_SHA))
  )
    throw Error("Invalid experience state extension");
  const hasCombatStats = Object.hasOwn(report, "combatStatUpdates");
  if (
    hasCombatStats !== Object.hasOwn(report, "combatStatPackageSha256") ||
    (hasCombatStats &&
      (!Array.isArray(report.combatStatUpdates) ||
        report.combatStatPackageSha256 !== COMBAT_STATS_SHA))
  )
    throw Error("Invalid combat stat state extension");
  const fields = [
    ...CHAMPION_STATE_FIELDS,
    ...(hasExperience ? ["experience"] : []),
    ...(hasCombatStats ? COMBAT_STAT_FIELDS : []),
  ];
  const hasInventory = Object.hasOwn(report, "inventoryEvents");
  if (hasInventory !== Object.hasOwn(report, "inventoryPackageSha256"))
    throw Error("Incomplete inventory state extension");
  const inventory = hasInventory ? createLatestInventory(report) : null;
  const lifecycle = prepareLatestLifecycle(report),
    tracks = new Map(),
    championIds = new Set(report.heroes.map((h) => h.entityId)),
    entities = new Map(
      report.heroes.map((h) => [
        h.entityId,
        {
          entityId: h.entityId,
          entityClass: "champion",
          creationTime: 0,
          team: h.team,
        },
      ]),
    ),
    identities = new Map();
  if (worldState !== null) {
    if (
      !Array.isArray(worldState.entities) ||
      !Array.isArray(worldState.updates)
    )
      throw Error("World state requires admitted entities and updates");
    for (const entity of worldState.entities) {
      if (
        entities.has(entity.entityId) ||
        !Number.isInteger(entity.entityId) ||
        !["lane-minion", "turret"].includes(entity.entityClass) ||
        !Number.isFinite(entity.creationTime) ||
        entity.creationTime < 0 ||
        entity.creationTime > report.endTime
      )
        throw Error("Invalid world state identity/lifetime");
      entities.set(entity.entityId, structuredClone(entity));
    }
  }
  for (const entry of report.playerIdentities) {
    if (!championIds.has(entry.entityId) || identities.has(entry.entityId))
      throw Error("Invalid champion player identity binding");
    identities.set(entry.entityId, structuredClone(entry));
  }
  if (identities.size !== championIds.size)
    throw Error("Incomplete champion player identity binding");
  if (hasExperience)
    for (const update of report.experienceUpdates)
      if (!championIds.has(update.entityId))
        throw Error("Experience belongs to an unadmitted champion");
  if (hasCombatStats)
    for (const update of report.combatStatUpdates)
      if (!championIds.has(update.entityId))
        throw Error("Combat stats belong to an unadmitted champion");
  if (worldState !== null) {
    for (const update of worldState.updates)
      if (championIds.has(update.entityId) || !entities.has(update.entityId))
        throw Error("World update does not belong to an admitted world entity");
  }
  for (const update of [
    ...report.championStateUpdates,
    ...(hasExperience ? report.experienceUpdates : []),
    ...(hasCombatStats ? report.combatStatUpdates : []),
    ...(worldState?.updates ?? []),
  ].sort(
    (a, b) =>
      a.time - b.time ||
      a.transportSequence - b.transportSequence ||
      a.recordIndex - b.recordIndex,
  )) {
    if (
      !entities.has(update.entityId) ||
      !Number.isFinite(update.time) ||
      update.time < 0 ||
      update.time > report.endTime ||
      !Number.isSafeInteger(update.transportSequence) ||
      !Number.isSafeInteger(update.recordIndex)
    )
      throw Error("Invalid champion state provenance");
    if (update.time < entities.get(update.entityId).creationTime)
      throw Error("State observation predates entity creation");
    if (!tracks.has(update.entityId)) tracks.set(update.entityId, []);
    const track = tracks.get(update.entityId),
      previous = track.at(-1),
      values = { ...(previous?.values ?? {}) },
      sources = { ...(previous?.sources ?? {}) };
    for (const name of fields)
      if (Object.hasOwn(update, name)) {
        if (!Number.isFinite(update[name]))
          throw Error("Nonfinite champion state");
        if (
          name === "level" &&
          (!Number.isInteger(update[name]) ||
            update[name] < 0 ||
            update[name] > 0xffffffff)
        )
          throw Error("Invalid native champion level");
        values[name] = update[name];
        sources[name] = {
          time: update.time,
          transportSequence: update.transportSequence,
          recordIndex: update.recordIndex,
          stateSequence: update.stateSequence,
        };
      }
    track.push({ time: update.time, values, sources });
  }
  function sampleEntity(entityId, time) {
    if (
      !entities.has(entityId) ||
      !Number.isFinite(time) ||
      time < 0 ||
      time > report.endTime
    )
      throw Error("Champion state query outside decoded replay");
    const track = tracks.get(entityId) ?? [];
    let lo = 0,
      hi = track.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (track[mid].time <= time) lo = mid + 1;
      else hi = mid;
    }
    const entity = entities.get(entityId),
      point = lo ? track[lo - 1] : null,
      life = sampleLatestLifecycle(lifecycle.tracks.get(entityId), time);
    return {
      entityId,
      time,
      entityClass: entity.entityClass,
      team: entity.team,
      present: time >= entity.creationTime,
      dead: life.dead,
      currentHealth: point?.values.currentHealth ?? null,
      maxHealth: point?.values.maxHealth ?? null,
      healthSources: structuredClone(
        Object.fromEntries(
          Object.entries(point?.sources ?? {}).filter(([name]) =>
            ["currentHealth", "maxHealth"].includes(name),
          ),
        ),
      ),
      shieldStatus: "unavailable",
      level: point?.values.level ?? null,
      resourceValue: point?.values.resourceValue ?? null,
      resourceMax: point?.values.resourceMax ?? null,
      currentGold: point?.values.currentGold ?? null,
      experience: point?.values.experience ?? null,
      combatStats: {
        status:
          championIds.has(entityId) &&
          hasCombatStats &&
          COMBAT_STAT_FIELDS.some((name) =>
            Object.hasOwn(point?.values ?? {}, name),
          )
            ? "observed"
            : "unavailable",
        values: Object.fromEntries(
          COMBAT_STAT_FIELDS.map((name) => [
            name,
            championIds.has(entityId) ? (point?.values[name] ?? null) : null,
          ]),
        ),
        sources: structuredClone(
          Object.fromEntries(
            Object.entries(point?.sources ?? {}).filter(([name]) =>
              COMBAT_STAT_FIELDS.includes(name),
            ),
          ),
        ),
      },
      inventory:
        championIds.has(entityId) && inventory
          ? inventory.sample(entityId, time)
          : { status: "unavailable", slots: [] },
      playerName: identities.get(entityId)?.identity?.gameName ?? null,
      playerIdentity: identities.has(entityId)
        ? structuredClone(identities.get(entityId))
        : null,
      fieldSources: structuredClone(point?.sources ?? {}),
    };
  }
  return {
    sampleEntity,
    sampleReplay(time) {
      return {
        time,
        entities: new Map(
          [...entities.keys()].map((id) => [id, sampleEntity(id, time)]),
        ),
      };
    },
    metadata: {
      supportedFields: fields,
      championEntities: championIds.size,
      worldEntities: entities.size - championIds.size,
      timelineMode: "absolute sparse field tracks",
      checkpointsRequiredForStatefulPresentation: true,
    },
  };
}
