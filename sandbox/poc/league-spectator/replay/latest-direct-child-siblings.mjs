import { sha256 } from "./structural-comparison.mjs";
import { DIRECT_CHILD_SIBLING_PACKAGE_SHA } from "./latest-direct-child-siblings-contract.mjs";

export const DIRECT_CHILD_SIBLING_POLICY =
  "native-observed-child-source-independent-siblings-v1";
export const DIRECT_CHILD_SIBLING_OMISSIONS = Object.freeze([
  "child:source-emitter-simulation-and-request-clock-untranslated",
  "child:global-scheduler-activation-and-rendering-untranslated",
  "child:resource-acquisition-provider-and-native-world-acceptance-unknown",
  "child:complete-parent-and-descendant-completion-unresolved",
]);
const owned = new WeakSet();
const ownedPrograms = new WeakSet();
export const isLatestDirectChildSiblingPrograms = (value) => owned.has(value);
export const isLatestDirectChildSiblingProgram = (value) =>
  ownedPrograms.has(value);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export function canonicalChildSource(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nonfinite child source");
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const entries = Array.from({ length: value.length }, (_, index) => {
      if (!Object.hasOwn(value, index)) throw new Error("Sparse child source");
      return canonicalChildSource(value[index]);
    });
    if (Reflect.ownKeys(value).length !== value.length + 1)
      throw new Error("Non-data child source array");
    return `[${entries.join(",")}]`;
  }
  if (
    !object(value) ||
    Reflect.ownKeys(value).some((key) => typeof key !== "string")
  )
    throw new Error("Non-data child source");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalChildSource(value[key])}`)
    .join(",")}}`;
}
const sourceHash = async (value) =>
  sha256(new TextEncoder().encode(canonicalChildSource(value)));
function keyOnlyChild(value) {
  if (
    !exact(value, ["__type", "childrenIdentifiers"]) ||
    value.__type !== "VfxChildParticleSetDefinitionData" ||
    !Array.isArray(value.childrenIdentifiers) ||
    value.childrenIdentifiers.length !== 1 ||
    !Object.hasOwn(value.childrenIdentifiers, 0)
  )
    return null;
  const identifier = value.childrenIdentifiers[0];
  if (
    !exact(identifier, ["__type", "effectKey"]) ||
    identifier.__type !== "VfxChildIdentifier" ||
    typeof identifier.effectKey !== "string"
  )
    return null;
  const hash = /^\{([0-9a-f]{8})\}$/i.exec(identifier.effectKey)?.[1];
  return hash && Number.parseInt(hash, 16) !== 0
    ? Number.parseInt(hash, 16)
    : null;
}
function childPaths(value, prefix = []) {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(key === "childParticleSetDefinition" ? [[...prefix, key]] : []),
    ...childPaths(entry, [...prefix, key]),
  ]);
}
export async function createLatestDirectChildSiblingPrograms({
  profile,
  packageBytes,
}) {
  if (
    profile?.clientVersion !== "16.21.829.8620" ||
    profile.protocolDigest !== "20e09df23c66b85e" ||
    !(packageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== DIRECT_CHILD_SIBLING_PACKAGE_SHA
  )
    throw new Error("Child sibling capability package/build mismatch");
  const data = JSON.parse(new TextDecoder().decode(packageBytes));
  if (
    data.schema !== 1 ||
    data.kind !== "original-child-source-sibling-capabilities" ||
    data.policy !== DIRECT_CHILD_SIBLING_POLICY ||
    data.build !== profile.clientVersion ||
    data.protocol !== profile.protocolDigest ||
    !Array.isArray(data.capabilities) ||
    !data.capabilities.length ||
    data.scope?.fullChildFamilySupport !== false ||
    data.scope.childSchedulerActivationRecovered !== false
  )
    throw new Error("Malformed child sibling capabilities");
  const capabilities = new Map();
  for (const capability of data.capabilities) {
    const hash = await sourceHash(capability.source);
    if (
      hash !== capability.childSourceSha256 ||
      capabilities.has(hash) ||
      keyOnlyChild(capability.source.childParticleSetDefinition) !==
        capability.effectKey ||
      childPaths(capability.source).length !== 1
    )
      throw new Error("Malformed or duplicate child source capability");
    capabilities.set(hash, freeze(structuredClone(capability)));
  }
  const factory = Object.freeze({
    policy: DIRECT_CHILD_SIBLING_POLICY,
    packageSha256: DIRECT_CHILD_SIBLING_PACKAGE_SHA,
    async compile({ id, definition, systemIdentity }) {
      const identity = /(?:^|\/)([0-9a-f]{8})$/i.exec(id)?.[1];
      if (
        !identity ||
        definition?.__type !== "VfxSystemDefinitionData" ||
        systemIdentity?.authored !== true ||
        systemIdentity.objectPathHash !== Number.parseInt(identity, 16) ||
        definition.objectPath?.toLowerCase() !== `{${identity.toLowerCase()}}`
      )
        return null;
      const paths = childPaths(definition);
      if (
        !paths.length ||
        paths.some(
          (parts) =>
            parts.length !== 3 ||
            parts[0] !== "complexEmitterDefinitionData" ||
            parts[2] !== "childParticleSetDefinition",
        )
      )
        return null;
      const children = [];
      for (const parts of paths) {
        const index = Number(parts[1]),
          source = definition.complexEmitterDefinitionData[index];
        const key = keyOnlyChild(source.childParticleSetDefinition);
        const hash = await sourceHash(source),
          capability = capabilities.get(hash);
        if (!capability || key !== capability.effectKey) return null;
        children.push({
          emitterIndex: index,
          childEmitterSourceSha256: hash,
          declaration: structuredClone(source.childParticleSetDefinition),
          requests: [{ identifierIndex: 0, effectKey: key }],
          ancestry: {
            parentObjectPathHash: systemIdentity.objectPathHash,
            selectedParentResourceOwnerRequired: true,
            nativeResourceAcceptance: null,
          },
          status: "omitted-child-source-with-proven-independent-siblings",
        });
      }
      const program = freeze({
        schema: 1,
        policy: DIRECT_CHILD_SIBLING_POLICY,
        packageSha256: DIRECT_CHILD_SIBLING_PACKAGE_SHA,
        parentObjectPathHash: systemIdentity.objectPathHash,
        children,
        eligibleSiblingPrimitiveTypes: [
          "VfxPrimitiveCameraQuad",
          "VfxPrimitiveArbitraryQuad",
        ],
        omissions: [...DIRECT_CHILD_SIBLING_OMISSIONS],
        nativeAcceptance: null,
        childSchedulerActivationRecovered: false,
        nativeParentCompletionRecovered: false,
      });
      ownedPrograms.add(program);
      return program;
    },
  });
  owned.add(factory);
  return factory;
}

export function directChildFreeSiblingEligible(source, program) {
  if (
    !ownedPrograms.has(program) ||
    program?.policy !== DIRECT_CHILD_SIBLING_POLICY ||
    program.packageSha256 !== DIRECT_CHILD_SIBLING_PACKAGE_SHA ||
    childPaths(source).length !== 0
  )
    return false;
  const primitive = source.primitive;
  return (
    primitive === undefined ||
    (exact(primitive, ["__type"]) &&
      ["VfxPrimitiveCameraQuad", "VfxPrimitiveArbitraryQuad"].includes(
        primitive.__type,
      ))
  );
}
