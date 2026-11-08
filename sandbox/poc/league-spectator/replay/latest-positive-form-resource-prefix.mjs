import { sha256 } from "./structural-comparison.mjs";
import { createLatestResourceRequestTrack } from "./latest-resource-requests.mjs";
import { UNIT_GEAR_RESOURCES_SHA } from "./latest-unit-gear-resources.mjs";

export const POSITIVE_FORM_RESOURCE_PREFIX_PACKAGE_SHA =
  "79dc121f4d3df3b63b78bc479d83096aeb81e43251940c784dc2e33e7d52b70e";
export const POSITIVE_FORM_RESOURCE_PREFIX_POLICY =
  "native-positive-form-resource-prefix-v1";
const owners = new WeakSet(),
  tracks = new WeakSet();
export const isLatestPositiveFormResourcePrefix = (value) => owners.has(value);
export const isLatestPositiveFormResourceTrack = (value) => tracks.has(value);
const uint = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const compare = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  a.entryOrder - b.entryOrder;

// This owns a conditional resource-publication prefix, not completed live gear
// acceptance, model updates, or reconstruction of an unknown older stack.
export async function createLatestPositiveFormResourcePrefix({
  profile,
  packageBytes,
  effectsManifestBytes,
  gearPackageBytes,
}) {
  if (
    !(packageBytes instanceof Uint8Array) ||
    !(effectsManifestBytes instanceof Uint8Array) ||
    !(gearPackageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !==
      POSITIVE_FORM_RESOURCE_PREFIX_PACKAGE_SHA ||
    (await sha256(gearPackageBytes)) !== UNIT_GEAR_RESOURCES_SHA
  )
    throw Error(
      "Pinned positive resource-prefix and original gear packages required",
    );
  const parse = (bytes) =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    metadata = parse(packageBytes),
    manifest = parse(effectsManifestBytes),
    gears = parse(gearPackageBytes),
    s = metadata.scope;
  if (
    metadata.schema !== 1 ||
    metadata.kind !== "prepared-positive-form-resource-prefix" ||
    metadata.policy !== POSITIVE_FORM_RESOURCE_PREFIX_POLICY ||
    metadata.build !== "16.21.829.8620" ||
    metadata.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== metadata.build ||
    profile.protocolDigest !== metadata.protocol ||
    profile.decoderImageSha256 !== metadata.decoderImageSha256 ||
    (await sha256(effectsManifestBytes)) !== metadata.effectsManifestSha256 ||
    metadata.unitGearResourcesSha256 !== UNIT_GEAR_RESOURCES_SHA ||
    !s.staticBuildDataOnly ||
    s.containsReplayEvents ||
    s.containsUnitInstances ||
    !s.originalResourcePublicationBeforeModelReadiness ||
    s.completePositiveListener !== false ||
    s.nativeReplayAcceptance !== null ||
    s.snapshotRestorationRecovered ||
    s.nativeSnapshotAcceptance !== null ||
    !s.selectedResourcePrefixOnly ||
    s.olderUnknownStackFallbackAllowed
  )
    throw Error("Unsupported positive resource-prefix build/contract");
  const capabilities = new Map();
  for (const capability of metadata.capabilities) {
    const actor = manifest.actors[capability.actorKey],
      authored = gears.actors[capability.actorKey],
      key = `${capability.character}:${capability.skinId}`;
    if (
      !actor ||
      !authored ||
      actor.character !== capability.character ||
      actor.skinId !== capability.skinId ||
      actor.skinPath !== capability.skinPath ||
      capabilities.has(key) ||
      !capability.negativeRequestPreservesResourceIdentity ||
      capability.originalPublicationBoundaryRva !== 0x30f11a
    )
      throw Error("Positive resource-prefix static actor differs");
    const selections = new Map();
    for (const selection of capability.selections) {
      const entry = authored[selection.index];
      if (
        !entry ||
        selections.has(selection.index) ||
        entry.gearIdentity !== selection.gearIdentity ||
        entry.sourceSha256 !== selection.sourceSha256 ||
        JSON.stringify(entry.rows) !== JSON.stringify(selection.rows)
      )
        throw Error(
          "Positive resource-prefix original gear identity/rows differ",
        );
      selections.set(selection.index, freeze(structuredClone(selection)));
    }
    capabilities.set(key, {
      capability: freeze(structuredClone(capability)),
      selections,
    });
  }
  const owner = Object.freeze({
    metadata: freeze(structuredClone(metadata)),
    createTrack(report) {
      if (
        report?.build !== metadata.build ||
        report.protocol !== metadata.protocol ||
        report.decoderImageSha256 !== metadata.decoderImageSha256 ||
        !Number.isFinite(report.endTime) ||
        report.endTime < 0 ||
        !Array.isArray(report.heroes)
      )
        throw Error("Identified same-build replay and hero inventory required");
      const requests = createLatestResourceRequestTrack(
          report.resourceRequests,
        ).records,
        heroes = new Map();
      for (const hero of report.heroes) {
        if (
          !uint(hero.entityId) ||
          hero.entityId === 0 ||
          heroes.has(hero.entityId) ||
          hero.kind !== "hero-creation-candidate" ||
          !ordinal(hero.provenance?.transportSequence) ||
          hero.provenance.time !== 0 ||
          hero.provenance.stream !== 2
        )
          throw Error("Unique decoded hero creation provenance required");
        heroes.set(hero.entityId, structuredClone(hero));
      }
      const byEntity = new Map();
      for (const request of requests) {
        if (!byEntity.has(request.entityId)) byEntity.set(request.entityId, []);
        byEntity.get(request.entityId).push(request);
      }
      function query(entityId, time, cursor = null) {
        if (
          !uint(entityId) ||
          !Number.isFinite(time) ||
          time < 0 ||
          time > report.endTime ||
          (cursor !== null &&
            (!ordinal(cursor.transportSequence) ||
              !ordinal(cursor.entryOrder) ||
              (cursor.exclusive !== undefined &&
                typeof cursor.exclusive !== "boolean")))
        )
          throw Error(
            "Positive prefix query requires exact entity/time/cursor",
          );
        const hero = heroes.get(entityId),
          binding = capabilities.get(`${hero?.champion}:${hero?.skinId}`),
          unresolved = (reason, details = {}) =>
            freeze({
              policy: POSITIVE_FORM_RESOURCE_PREFIX_POLICY,
              status: "unresolved-positive-resource-prefix",
              reason,
              entityId,
              ...details,
            });
        if (!hero || !binding)
          return unresolved("form:source-actor-positive-prefix-unprepared");
        const before = (event) =>
          event.time < time ||
          (event.time === time &&
            (cursor === null ||
              (cursor.exclusive
                ? compare(event, { time, ...cursor }) < 0
                : compare(event, { time, ...cursor }) <= 0)));
        const creation = {
          time: 0,
          transportSequence: hero.provenance.transportSequence,
          entryOrder: hero.provenance.entryOrder ?? 0,
        };
        if (!before(creation)) return unresolved("form:hero-not-yet-created");
        let selected = null,
          publication = null;
        const observations = [],
          sourceEventIds = [
            `hero-creation:${entityId}:${creation.transportSequence}:${creation.entryOrder}`,
          ];
        for (const request of byEntity.get(entityId) ?? []) {
          if (!before(request)) break;
          if (compare(request, creation) <= 0) continue;
          sourceEventIds.push(request.id);
          if (request.opcode !== 129)
            return unresolved("form:unsupported-intervening-resource-request", {
              blockingRequest: request,
              sourceEventIds,
            });
          if (request.index === 255 && request.nativeFlag === false) {
            observations.push({
              request,
              status: "original-negative-request-preserves-resource-identity",
            });
            continue;
          }
          const next = binding.selections.get(request.signedIndex);
          if (!next || request.index !== request.signedIndex)
            return unresolved("form:positive-request-index-unproven", {
              blockingRequest: request,
              sourceEventIds,
            });
          if (request.stream === 2) {
            if (!selected || selected.index !== next.index)
              return unresolved(
                "form:snapshot-prefix-without-matching-causal-publication",
                { blockingRequest: request, sourceEventIds },
              );
            observations.push({
              request,
              status: "snapshot-observation-consistent-with-published-prefix",
            });
            continue;
          }
          selected = next;
          publication = request;
          observations.push({
            request,
            status: "original-resource-publication-prefix",
          });
        }
        if (!selected)
          return unresolved("form:positive-resource-prefix-not-yet-published", {
            sourceEventIds,
          });
        return freeze({
          policy: POSITIVE_FORM_RESOURCE_PREFIX_POLICY,
          status: "positive-resource-presentation-prefix",
          entityId,
          actorKey: binding.capability.actorKey,
          selectedGearIndex: selected.index,
          gearIdentity: selected.gearIdentity,
          sourceSha256: selected.sourceSha256,
          nativeProofSha256: binding.capability.nativeProofSha256,
          publication,
          sourceEventIds,
          observations,
          originalPublicationBoundaryRva:
            binding.capability.originalPublicationBoundaryRva,
          nativeAcceptance: null,
          nativeSnapshotAcceptance: null,
          nativeSnapshotRestoration: null,
          nativePoseParity: null,
          omissions: [...metadata.omissions],
        });
      }
      const track = Object.freeze({
        query,
        lookup(entityId, time, key, cursor = null) {
          if (!uint(key))
            throw Error("Unsigned positive gear resource key required");
          const state = query(entityId, time, cursor);
          if (state.status !== "positive-resource-presentation-prefix")
            return state;
          if (key === 0)
            return freeze({
              ...state,
              status: "unresolved-positive-resource-prefix",
              reason: "form:alternate-name-resource-path-unrecovered",
              resourceKey: key,
            });
          const binding = capabilities.get(
              `${heroes.get(entityId).champion}:${heroes.get(entityId).skinId}`,
            ),
            selection = binding.selections.get(state.selectedGearIndex),
            row = selection.rows.find((row) => row.key === key);
          if (!row)
            return freeze({
              ...state,
              status: "unresolved-positive-resource-prefix",
              reason: "form:older-stack-unrecovered-for-absent-top-gear-key",
              resourceKey: key,
            });
          return freeze({
            ...state,
            status:
              row.value === 0
                ? "matched-authored-gear-null"
                : "matched-authored-gear-reference",
            resourceKey: key,
            referenceToken: row.value,
          });
        },
      });
      tracks.add(track);
      return track;
    },
  });
  owners.add(owner);
  return owner;
}
