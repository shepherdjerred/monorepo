const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const assetKey = (character, skinId) => `${character.toLowerCase()}/${skinId}`;

// Coverage describes decoded creation candidates; it never accepts an NPC into
// the world registry or infers a missing spawn from an archived static model.
export function inspectMap11WorldCoverage(report, world) {
  if (
    report?.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    report.startup?.configuredMapId !== 11 ||
    report.startup.mode !== "CLASSIC" ||
    !/^[a-f0-9]{64}$/.test(report.replaySha256 ?? "") ||
    !Number.isFinite(report.duration) ||
    !Number.isFinite(report.endTime) ||
    report.duration <= 0 ||
    report.endTime <= 0 ||
    report.endTime > report.duration + 0.001 ||
    !Array.isArray(report.worldEvents) ||
    !Array.isArray(report.movement) ||
    !Array.isArray(report.heroes) ||
    !world?.assets
  )
    throw Error(
      "Exact decoded standard Map11 world report and static catalog required",
    );
  const prepared = new Set(
    Object.keys(world.assets).map((key) => key.toLowerCase()),
  );
  const known = new Set(report.heroes.map((hero) => hero.entityId));
  const accepted = new Set(
    (report.worldEntities ?? []).map((entity) => entity.entityId),
  );
  for (const id of accepted) known.add(id);
  for (const missile of report.missiles ?? []) {
    if (!uint(missile.entityId))
      throw Error("Original missile entity identity required");
    known.add(missile.entityId);
  }
  const npcSkins = new Map(),
    entityDeclarations = new Map(),
    eventKinds = {};
  for (const event of report.worldEvents) {
    if (typeof event.kind !== "string" || !uint(event.entityId))
      throw Error("Bounded decoded world event identity required");
    eventKinds[event.kind] = (eventKinds[event.kind] ?? 0) + 1;
    known.add(event.entityId);
    if (event.kind !== "npc-creation-candidate") continue;
    if (
      !/^[a-z0-9_]+$/i.test(event.character ?? "") ||
      !Number.isInteger(event.skinId) ||
      event.skinId < 0 ||
      event.skinId > 10000 ||
      !Number.isFinite(event.time)
    )
      throw Error("Original NPC character, skin and replay time required");
    const key = assetKey(event.character, event.skinId);
    const row = npcSkins.get(key) ?? {
      key,
      character: event.character,
      skinId: event.skinId,
      creationRecords: 0,
      firstTime: event.time,
      lastTime: event.time,
      entityIds: new Set(),
      preparedStaticAsset: prepared.has(key),
      acceptedWorldEntities: 0,
    };
    row.creationRecords++;
    row.firstTime = Math.min(row.firstTime, event.time);
    row.lastTime = Math.max(row.lastTime, event.time);
    row.entityIds.add(event.entityId);
    npcSkins.set(key, row);
    const identities = entityDeclarations.get(event.entityId) ?? new Set();
    identities.add(key);
    entityDeclarations.set(event.entityId, identities);
  }
  const unknownMovement = new Map();
  for (const movement of report.movement) {
    if (!uint(movement.entityId))
      throw Error("Original movement entity identity required");
    if (known.has(movement.entityId)) continue;
    unknownMovement.set(
      movement.entityId,
      (unknownMovement.get(movement.entityId) ?? 0) + 1,
    );
  }
  const skins = [...npcSkins.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((row) => ({
      ...row,
      entityIds: [...row.entityIds].sort((a, b) => a - b),
      acceptedWorldEntities: [...row.entityIds].filter((id) => accepted.has(id))
        .length,
    }));
  return {
    schema: 1,
    kind: "decoded-map11-world-coverage",
    build: report.build,
    protocol: report.protocol,
    replaySha256: report.replaySha256,
    duration: report.duration,
    endTime: report.endTime,
    decodedWholeWindow: Math.abs(report.duration - report.endTime) <= 0.001,
    eventKinds,
    npcSkins: skins,
    conflictingNpcIdentities: [...entityDeclarations]
      .filter(([, ids]) => ids.size > 1)
      .map(([entityId, identities]) => ({
        entityId,
        identities: [...identities].sort(),
      })),
    movementWithoutKnownCreation: [...unknownMovement]
      .sort(([a], [b]) => a - b)
      .map(([entityId, records]) => ({ entityId, records })),
    actorRequests: skins
      .filter((row) => !row.preparedStaticAsset)
      .map((row) => ({
        character: row.character,
        skinId: row.skinId,
        role: "world",
        characterRecords: [`Characters/${row.character}/CharacterRecords/Root`],
      })),
    scope: {
      originalDecodedNpcCandidates: true,
      characterRootMustExistInExactArchive: true,
      archivedAssetsEstablishEntityExistence: false,
      npcFactoryAcceptance: false,
      completeSpawnOpcodeCoverage: false,
      nativeSpectatorEquivalent: false,
    },
  };
}
