// Initial resource decisions only. Later resource changes and pose/owner binding
// require separate lifecycle evidence; external SCB acquisition is not replaced.
import { sha256 } from "./structural-comparison.mjs";
import { ATTACHED_MESH_SHA } from "./latest-attached-mesh.mjs";
export const ATTACHED_RESOURCES_SHA =
  "eec666630065c6576ed8825bd18daefd0946b74f57bab0eee2f7df73b504a571";
const ENV = [
  "pass",
  "featuresEnabled",
  "resourceMask",
  "systemFogMode",
  "graphics34b",
  "graphics29c",
];
export async function createLatestInitialAttachedResources(
  profile,
  attachedBytes,
  effectsBytes,
  bytes,
) {
  if (
    (await sha256(bytes)) !== ATTACHED_RESOURCES_SHA ||
    (await sha256(attachedBytes)) !== ATTACHED_MESH_SHA
  )
    throw Error("Pinned initial attached resource package required");
  const parse = (b) =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)),
    meta = parse(bytes),
    attached = parse(attachedBytes);
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-initial-attached-mesh-resources" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !== profile.sliceSha256 ||
    meta.attachedMeshPackageSha256 !== ATTACHED_MESH_SHA ||
    meta.effectsManifestSha256 !== (await sha256(effectsBytes)) ||
    Object.keys(meta.entries).length !== 181 ||
    meta.scope.initialResourcePrefixOnly !== true ||
    meta.scope.nativeInitializerExecuted !== true ||
    meta.scope.nativePathRoutingExecuted !== true ||
    meta.scope.assetBytesUnchanged !== true ||
    meta.scope.resourceAbsenceDerivedFromAsset !== true ||
    meta.scope.externalFactoryExecuted !== false ||
    meta.scope.laterResourceMutationVerified !== false ||
    meta.scope.meshPoseBindingExecuted !== false ||
    meta.scope.mainViewerIntegrated !== false
  )
    throw Error("Unsupported initial attached resource package");
  for (const [key, entry] of Object.entries(meta.entries)) {
    const ref = attached.entries[key];
    if (
      !ref ||
      ref.effectId !== entry.effectId ||
      ref.emitterIndex !== entry.emitterIndex ||
      ref.actor !== entry.actor ||
      ref.postloadGraphSha256 !== entry.postloadGraphSha256 ||
      ref.sourceDefinitionSha256 !== entry.sourceDefinitionSha256 ||
      !["no-authored-mesh-resource", "external-mesh-factory-required"].includes(
        entry.status,
      ) ||
      (entry.status === "no-authored-mesh-resource"
        ? entry.externalMeshPath !== null
        : typeof entry.externalMeshPath !== "string")
    )
      throw Error("Initial resource asset identity differs");
  }
  function entry(effectId, emitterIndex) {
    const row = meta.entries[`${effectId}:${emitterIndex}`];
    if (!row) throw Error("Unprepared initial attached resource");
    return row;
  }
  return {
    describe(effectId, emitterIndex) {
      return structuredClone(entry(effectId, emitterIndex));
    },
    materialInput(effectId, emitterIndex, input) {
      const row = entry(effectId, emitterIndex);
      if (row.status !== "no-authored-mesh-resource")
        throw Error(
          `Original external mesh factory required: ${row.externalMeshPath}`,
        );
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length !== ENV.length ||
        ENV.some((k) => !Object.hasOwn(input, k)) ||
        typeof input.featuresEnabled !== "boolean" ||
        typeof input.graphics34b !== "boolean"
      )
        throw Error("Explicit initial material environment required");
      for (const [name, max] of [
        ["pass", 6],
        ["resourceMask", 7],
        ["systemFogMode", 1],
        ["graphics29c", 2],
      ])
        if (
          !Number.isInteger(input[name]) ||
          input[name] < 0 ||
          input[name] > max
        )
          throw Error(`Invalid initial material environment: ${name}`);
      return { ...input, resolvedResourceFlag95: null };
    },
  };
}
