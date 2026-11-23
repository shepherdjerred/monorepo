import { NEUTRAL_CREATION_PACKAGE_SHA } from "./latest-neutral-creation.mjs";

const uint32 = (value) =>
  Number.isInteger(value) && value > 0 && value <= 0xffffffff;
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

// This joins original745 gameplay requests to independently prepared assets.
// Stream2 snapshots never create another entity. Native factory completion and
// network-registry publication remain separate from this logical replay lookup.
export function bindLatestNeutralMinions(report, manifest, catalog) {
  const policy = catalog.neutralCreation;
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    manifest.build !== report.build ||
    manifest.protocol !== report.protocol ||
    manifest.map?.id !== 11 ||
    manifest.map.recordedMapSkin !== "Default" ||
    catalog.mapId !== 11 ||
    catalog.build !== report.build ||
    catalog.protocol !== report.protocol ||
    report.neutralCreationPackageSha256 !== NEUTRAL_CREATION_PACKAGE_SHA ||
    !Array.isArray(report.neutralCreations) ||
    !Array.isArray(report.neutralSnapshots) ||
    policy?.schema !== 1 ||
    policy.kind !== "original-default-map11-neutral-candidates" ||
    policy.argumentProgramSha256 !== NEUTRAL_CREATION_PACKAGE_SHA ||
    policy.nativeClass !== "AIMinionClient" ||
    policy.nativeVtableRva !== 0x23013b8 ||
    policy.positionArgument !== "firstVectorArgument" ||
    policy.resourceSkinPolicy !== "original-empty-meta-default-map" ||
    !digest(policy.resourceSkinProofSha256) ||
    !digest(policy.placementProofSha256) ||
    policy.scope?.nativeFactoryAccepted !== false ||
    policy.scope?.snapshotsCreateEntities !== false
  )
    throw Error("Exact Default Map11 neutral candidate policy required");
  const ids = new Set((report.heroes ?? []).map((hero) => hero.entityId));
  for (const event of report.worldEvents ?? [])
    if (
      event.kind === "building-identity-candidate" ||
      event.kind === "lane-minion-creation-candidate" ||
      event.kind === "npc-creation-candidate"
    )
      ids.add(event.entityId);
  const minions = [],
    byId = new Map();
  let previousOrder = -1;
  for (const request of report.neutralCreations) {
    if (
      request.kind !== "neutral-creation-candidate" ||
      request.stream !== 1 ||
      !uint32(request.entityId) ||
      ids.has(request.entityId) ||
      !Number.isFinite(request.time) ||
      request.time < 0 ||
      request.time > report.endTime ||
      !Number.isSafeInteger(request.transportSequence) ||
      request.transportSequence <= previousOrder ||
      request.entryOrder !== 0 ||
      !/^[a-z0-9_]+$/i.test(request.character) ||
      !Number.isInteger(request.requestedSkinId) ||
      request.requestedSkinId < 0 ||
      request.requestedSkinId > 0xffffffff ||
      !Number.isInteger(request.nativeTeamEnum) ||
      request.nativeTeamEnum < 0 ||
      request.nativeTeamEnum > 255 ||
      !Array.isArray(request.firstVectorArgument) ||
      request.firstVectorArgument.length !== 3 ||
      !request.firstVectorArgument.every(Number.isFinite) ||
      request.nativeWorldAcceptance !== false
    )
      throw Error("Unbound or repeated original neutral gameplay identity");
    previousOrder = request.transportSequence;
    const key = `${request.character.toLowerCase()}/${request.requestedSkinId}`,
      selected = policy.bindings[key],
      asset = catalog.assets[selected?.asset];
    if (
      !selected ||
      selected.character.toLowerCase() !== request.character.toLowerCase() ||
      selected.requestedSkinId !== request.requestedSkinId ||
      selected.resourceSkinId !== request.requestedSkinId ||
      !asset ||
      asset.character.toLowerCase() !== request.character.toLowerCase() ||
      asset.skinId !== selected.resourceSkinId ||
      !Array.isArray(selected.characterRecords) ||
      !selected.characterRecords.length ||
      new Set(selected.characterRecords).size !==
        selected.characterRecords.length ||
      selected.characterRecords.some(
        (path) => !asset.characterRecords.includes(path),
      ) ||
      !Number.isFinite(asset.scale) ||
      asset.scale <= 0
    )
      throw Error(`Unprepared original neutral character/resource skin ${key}`);
    const event = {
        ...request,
        kind: "neutral-minion-creation-candidate",
        resourceSkinId: selected.resourceSkinId,
        team: null,
      },
      binding = {
        event,
        asset,
        unit: {
          asset: selected.asset,
          records: selected.characterRecords.map((characterRecord) => ({
            characterRecord,
          })),
        },
        creationPosition: [...request.firstVectorArgument],
        nativeClass: policy.nativeClass,
        entityClass: "neutral-minion",
      };
    ids.add(request.entityId);
    minions.push(binding);
    byId.set(request.entityId, binding);
  }
  return Object.freeze({
    minions,
    get: (entityId) => byId.get(entityId) ?? null,
    scope: Object.freeze({
      logicalRecordedNetworkIdentityLookup: true,
      snapshotsCreateEntities: false,
      nativeFactoryAccepted: false,
      teamMappingRecovered: false,
    }),
  });
}
