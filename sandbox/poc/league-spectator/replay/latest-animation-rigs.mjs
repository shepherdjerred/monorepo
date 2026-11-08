import { sha256 } from "./structural-comparison.mjs";

const blocks = [
    [0x15b3cc0, 0x15b4130],
    [0x15b4130, 0x15b4330],
    [0x15b4330, 0x15b4750],
    [0x14be1d0, 0x14be1e0],
    [0x144b4e0, 0x144b580],
    [0x157fe60, 0x1580010],
    [0x157f940, 0x157fb80],
    [0x157f5d0, 0x157f7f0],
  ],
  uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
function boneHash(value) {
  if (uint(value)) return value;
  if (typeof value !== "string" || !value.length || value.length > 1024)
    throw Error("Invalid rig bone identity");
  if (/^\{[a-f0-9]{8}\}$/i.test(value)) return parseInt(value.slice(1, -1), 16);
  let hash = 2166136261;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code > 127) throw Error("Unprepared non-ASCII rig name");
    hash =
      Math.imul(
        hash ^ (code >= 65 && code <= 90 ? code + 32 : code),
        16777619,
      ) >>> 0;
  }
  return hash;
}
function transformHex(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{80}$/.test(value))
    throw Error("Invalid supplied rig pose transform");
  const raw = Uint8Array.from(value.match(/../g), (s) => parseInt(s, 16)),
    view = new DataView(raw.buffer);
  for (let i = 0; i < 40; i += 4)
    if (!Number.isFinite(view.getFloat32(i, true)))
      throw Error("Non-finite supplied rig transform");
}

// Match-independent results of original rig construction. This static package
// does not produce world poses; callers supply transforms in catalog order.
export async function createLatestAnimationRigBindings(
  profile,
  definitionBytes,
) {
  if ((await sha256(definitionBytes)) !== profile.animationRigsSha256)
    throw Error("Rig package hash mismatch");
  const meta = JSON.parse(new TextDecoder().decode(definitionBytes));
  if (
    meta.schema !== 1 ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.constructorRva !== 0x15b3cc0 ||
    meta.jointConstructorRva !== 0x15b4130 ||
    meta.mapBuilderRva !== 0x15b4330 ||
    meta.nameLookupRva !== 0x157fe60 ||
    meta.fnvPoseLookupRva !== 0x157f940 ||
    meta.keyPoseLookupRva !== 0x157f5d0 ||
    meta.nextPrimeBoundary.symbol !== "__ZNSt3__112__next_primeEm" ||
    meta.nextPrimeBoundary.rva !== 0x1fee34e ||
    meta.nextPrimeBoundary.maximumInput !== 65536 ||
    JSON.stringify(meta.sourceBlocks.map((b) => [b.startRva, b.endRva])) !==
      JSON.stringify(blocks)
  )
    throw Error("Unsupported constructed rig package");
  return {
    async bind(graphFile, rigBytes, catalogBytes) {
      const source = meta.graphs[graphFile];
      if (
        !source ||
        (await sha256(rigBytes)) !== source.rigSha256 ||
        (await sha256(catalogBytes)) !== source.catalogSha256
      )
        throw Error("Rig/catalog package mismatch");
      const catalog = JSON.parse(new TextDecoder().decode(catalogBytes)),
        lookups = new Map();
      if (
        catalog.schema !== 1 ||
        JSON.stringify(catalog.joints) !==
          JSON.stringify(source.joints.map((j) => j.name))
      )
        throw Error("Rig/catalog joint order mismatch");
      for (const binding of source.bindings) {
        if (
          !uint(binding.fnvHash) ||
          !uint(binding.resolvedBoneKey) ||
          lookups.has(binding.fnvHash) ||
          boneHash(binding.name) !== binding.fnvHash ||
          catalog.joints[binding.poseJointIndex] !== binding.name ||
          source.joints[binding.poseJointIndex].nativePoseIndex !==
            binding.nativePoseIndex ||
          source.joints[binding.poseJointIndex].resolvedBoneKey !==
            binding.resolvedBoneKey ||
          !Array.isArray(binding.sourceJointIndices) ||
          !binding.sourceJointIndices.includes(binding.poseJointIndex) ||
          binding.sourceJointIndices.some(
            (i) => source.joints[i]?.fnvHash !== binding.fnvHash,
          )
        )
          throw Error("Invalid constructed rig binding");
        lookups.set(binding.fnvHash, binding);
      }
      return {
        resolve(value) {
          const hash = boneHash(value),
            binding = lookups.get(hash);
          return binding
            ? { status: "rig-joint", ...structuredClone(binding) }
            : { status: "unresolved-static-name", fnvHash: hash };
        },
        attachmentJoints(transforms) {
          if (
            !Array.isArray(transforms) ||
            transforms.length !== catalog.joints.length
          )
            throw Error("Supplied pose buffer does not match rig");
          transforms.forEach(transformHex);
          return [...lookups.values()].map((binding) => {
            if (binding.keyPoseIndex !== binding.nativePoseIndex)
              throw Error(
                "Distinct name/key pose selection requires separate attachment handling",
              );
            return {
              hash: binding.fnvHash,
              resolvedBoneKey: binding.resolvedBoneKey,
              transformHex: transforms[binding.poseJointIndex],
            };
          });
        },
      };
    },
  };
}
