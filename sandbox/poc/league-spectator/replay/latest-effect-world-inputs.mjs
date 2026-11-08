// The next stage after canonical effect requests: retain every entity input.
// These records describe required world bindings; they never invent unit stacks.
import { sha256 } from "./structural-comparison.mjs";
import { EFFECT_DESCRIPTOR_PACKAGE_SHA } from "./latest-effect-descriptor.mjs";
export const EFFECT_WORLD_INPUTS_SHA =
  "7648ee52b7c455f84012ec216d10906c57ce970ed9a49bd86437c9074f79b35d";
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff,
  freeze = (v) => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  },
  offsets = {
    resourceContextEntityId: [0x24, 0x10],
    lookup14EntityId: [0x14, 0x18],
    attachmentEntityId: [0x48, 0x20],
    lookupA8EntityId: [0xa8, 0x28],
  };

export async function createLatestEffectWorldInputs({
  profile,
  image,
  packageBytes,
}) {
  if ((await sha256(packageBytes)) !== EFFECT_WORLD_INPUTS_SHA)
    throw Error("Pinned original effect world-input package required");
  const metadata = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    metadata.schema !== 1 ||
    metadata.kind !== "prepared-original-effect-world-inputs" ||
    metadata.build !== profile.clientVersion ||
    metadata.protocol !== profile.protocolDigest ||
    metadata.decoderImageSha256 !== profile.decoderImageSha256 ||
    metadata.descriptorPackageSha256 !== EFFECT_DESCRIPTOR_PACKAGE_SHA ||
    !metadata.scope.staticBuildDataOnly ||
    metadata.scope.containsReplayEvents ||
    !metadata.scope.originalWorldLookupAndPointerPrefixExecuted ||
    metadata.scope.liveUnitStateReconstructed ||
    metadata.scope.liveOverlayStateReconstructed ||
    metadata.scope.factoryExecuted ||
    JSON.stringify(metadata.factoryUnitOrder) !==
      JSON.stringify(["resourceContextEntityId", "lookupA8EntityId"]) ||
    metadata.factoryUnitOrderScope.field8c !== 0
  )
    throw Error("Unsupported effect world-input contract");
  for (const [name, [entry, descriptor]] of Object.entries(offsets))
    if (
      metadata.fields[name]?.entryOffset !== entry ||
      metadata.fields[name]?.descriptorOffset !== descriptor
    )
      throw Error("Original entity pointer routing differs");
  if (image !== undefined) {
    if ((await sha256(image)) !== profile.decoderImageSha256)
      throw Error("Effect world-input image differs");
    for (const b of metadata.sourceBlocks)
      if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
        throw Error("Original effect world-input instructions changed");
  }
  freeze(metadata);
  function describe(creation) {
    const d = creation?.descriptor;
    if (
      !d ||
      creation.creationSequence !== d.creationSequence ||
      creation.entityId !== d.entityId ||
      creation.time !== d.time ||
      creation.transportSequence !== d.transportSequence
    )
      throw Error("Matching canonical creation and descriptor required");
    const references = Object.entries(offsets).map(
      ([field, [entryOffset, descriptorOffset]]) => {
        const entityId = d[field];
        if (!uint(entityId))
          throw Error(`Unsigned effect world entity required: ${field}`);
        return {
          field,
          entityId,
          entryOffset,
          descriptorOffset,
          status:
            entityId === 0
              ? "native-null-entity-input"
              : "requires-live-world-entity",
        };
      },
    );
    return freeze({
      creationSequence: d.creationSequence,
      entityId: d.entityId,
      references,
      nonzeroEntityInputs: references.filter((r) => r.entityId !== 0).length,
      entityPointerInputsAreNull: references.every((r) => r.entityId === 0),
      ordinaryFactoryUnitOrder: metadata.factoryUnitOrder.map((field) => ({
        field,
        entityId: d[field],
      })),
      ordinaryFactoryUnitOrderApplies: d.field8c === 0,
      auxiliaryContextIds: d.unresolvedAuxiliaryContextIds.slice(),
      worldRegistryReconstructed: false,
      unitResourceStacksReconstructed: false,
      factoryReady: false,
    });
  }
  function requireNullEntityInputs(creation) {
    const input = describe(creation),
      missing = input.references.filter((r) => r.entityId !== 0);
    if (missing.length)
      throw Error(
        `Live effect entity bindings required: ${missing.map((r) => `${r.field}=${r.entityId}`).join(", ")}`,
      );
    return input;
  }
  return Object.freeze({
    metadata,
    describe,
    requireNullEntityInputs,
    bindTimeline(pipeline) {
      if (
        !pipeline?.scope.requestLifecycleOnly ||
        pipeline.scope.nativeFactorySucceededInferred ||
        !Array.isArray(pipeline.events)
      )
        throw Error("Canonical effect request timeline required");
      const records = new Map(),
        counts = {
          creationRequests: 0,
          requestsWithEntityReferences: 0,
          requestsWithoutEntityReferences: 0,
          nonzeroFields: Object.fromEntries(
            Object.keys(offsets).map((k) => [k, 0]),
          ),
        };
      for (const e of pipeline.events)
        if (e.kind === "create-request") {
          const input = describe(pipeline.creation(e.creationSequence));
          records.set(e.creationSequence, input);
          counts.creationRequests++;
          counts[
            input.entityPointerInputsAreNull
              ? "requestsWithoutEntityReferences"
              : "requestsWithEntityReferences"
          ]++;
          for (const r of input.references)
            if (r.entityId !== 0) counts.nonzeroFields[r.field]++;
        }
      const creation = (index) => {
        const original = pipeline.creation(index),
          input = records.get(index);
        if (!input) throw Error("Unowned effect world input sequence");
        return freeze({ ...original, worldInputs: input });
      };
      return Object.freeze({
        ...pipeline,
        worldInputSummary: freeze(counts),
        creation,
        scope: freeze({
          ...pipeline.scope,
          allFourEntityInputsPreserved: true,
          worldRegistryReconstructed: false,
          unitResourceStacksReconstructed: false,
        }),
        sampleEntity(entityId, time) {
          const sample = pipeline.sampleEntity(entityId, time);
          return sample
            ? freeze({
                ...sample,
                creation:
                  sample.creation === null
                    ? null
                    : creation(sample.state.creationSequence),
              })
            : null;
        },
      });
    },
  });
}
