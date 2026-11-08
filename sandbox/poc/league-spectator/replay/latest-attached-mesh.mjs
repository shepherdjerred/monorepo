import { sha256 } from "./structural-comparison.mjs";
import {
  createLatestSubmeshVisibility,
  SUBMESH_VISIBILITY_SHA,
} from "./latest-submesh-visibility.mjs";
export const ATTACHED_MESH_SHA =
  "cb8d9ae2eb157b497231812abc24f54deba55483c725bf8aa6a04d0524b3697d";
const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const pools = new WeakSet();

// Opaque identities model the native resolved-resource pointer. Equal asset
// content does not, by itself, establish equal native resource identity.
export function createAttachedMeshResources() {
  const owned = new WeakMap();
  const pool = {
    create(ranges) {
      if (
        !Array.isArray(ranges) ||
        !ranges.length ||
        ranges.length > 32 ||
        ranges.some(
          (r, i) => !r || r.index !== i || !uint(r.hash) || !uint(r.mask),
        )
      )
        throw Error("Invalid attached-mesh resource ranges");
      const mapping = new Map();
      ranges.forEach((r, i) =>
        mapping.set(r.hash, ((mapping.get(r.hash) ?? 0) | (1 << i)) >>> 0),
      );
      if (ranges.some((r) => r.mask !== mapping.get(r.hash)))
        throw Error("Attached-mesh range masks disagree with native order");
      const handle = Object.freeze({});
      owned.set(handle, { mapping, ranges: structuredClone(ranges) });
      return handle;
    },
    resolve(handle, hashes) {
      const resource = owned.get(handle);
      if (!resource) throw Error("Unowned attached-mesh resource");
      let mask = 0;
      const unresolved = [];
      for (const hash of hashes) {
        if (resource.mapping.has(hash))
          mask = (mask | resource.mapping.get(hash)) >>> 0;
        else unresolved.push(hash);
      }
      return { mask, unresolved };
    },
    ranges(handle) {
      const resource = owned.get(handle);
      if (!resource) throw Error("Unowned attached-mesh resource");
      return structuredClone(resource.ranges);
    },
  };
  pools.add(pool);
  return Object.freeze(pool);
}

export function createAttachedMeshMaskCache(spec, pool) {
  if (
    !pools.has(pool) ||
    !spec ||
    Object.keys(spec).some(
      (k) => !["drawHashes", "alwaysHashes", "useAvatarMask"].includes(k),
    ) ||
    ![spec.drawHashes, spec.alwaysHashes].every(
      (v) => Array.isArray(v) && v.length <= 1024 && v.every(uint),
    ) ||
    typeof spec.useAvatarMask !== "boolean"
  )
    throw Error("Invalid attached-mesh selection specification");
  spec = structuredClone(spec);
  let resource = null,
    selectedMask = 0xffffffff,
    alwaysMask = 0,
    unresolvedDrawHashes = [],
    unresolvedAlwaysHashes = [];
  const checkpoints = new WeakMap(),
    snapshot = () => ({
      resource,
      selectedMask,
      alwaysMask,
      unresolvedDrawHashes: [...unresolvedDrawHashes],
      unresolvedAlwaysHashes: [...unresolvedAlwaysHashes],
    });
  return {
    resolve(next) {
      if (next !== null) pool.ranges(next);
      if (next !== resource) {
        selectedMask = 0xffffffff;
        alwaysMask = 0;
        unresolvedDrawHashes = [];
        unresolvedAlwaysHashes = [];
        if (next !== null) {
          const selected = pool.resolve(next, spec.drawHashes),
            always = pool.resolve(next, spec.alwaysHashes);
          // Original cache keeps all selected bits when the OR of lookups is
          // zero, even for an authored list whose hashes are all absent.
          if (selected.mask !== 0) selectedMask = selected.mask;
          alwaysMask = always.mask;
          unresolvedDrawHashes = selected.unresolved;
          unresolvedAlwaysHashes = always.unresolved;
        }
        resource = next;
      }
      return {
        hasResource: resource !== null,
        selectedMask,
        alwaysMask,
        unresolvedDrawHashes: [...unresolvedDrawHashes],
        unresolvedAlwaysHashes: [...unresolvedAlwaysHashes],
      };
    },
    drawMask(generalMask, avatarMask) {
      if (!uint(generalMask) || !uint(avatarMask))
        throw Error("Resolved owner visibility masks required");
      const ownerMask = spec.useAvatarMask ? avatarMask : generalMask;
      return ((ownerMask & selectedMask) | alwaysMask) >>> 0;
    },
    checkpoint() {
      const handle = Object.freeze({});
      checkpoints.set(handle, snapshot());
      return handle;
    },
    restore(handle) {
      const p = checkpoints.get(handle);
      if (!p) throw Error("Unowned attached-mesh checkpoint");
      ({
        resource,
        selectedMask,
        alwaysMask,
        unresolvedDrawHashes,
        unresolvedAlwaysHashes,
      } = snapshotFrom(p));
    },
    releaseCheckpoint(handle) {
      if (!checkpoints.delete(handle))
        throw Error("Unowned attached-mesh checkpoint");
    },
  };
}
function snapshotFrom(p) {
  return {
    ...p,
    unresolvedDrawHashes: [...p.unresolvedDrawHashes],
    unresolvedAlwaysHashes: [...p.unresolvedAlwaysHashes],
  };
}

export async function createLatestAttachedMeshBindings(
  profile,
  sceneBytes,
  submeshBytes,
  effectsBytes,
  bytes,
) {
  if (
    (await sha256(bytes)) !== ATTACHED_MESH_SHA ||
    (await sha256(submeshBytes)) !== SUBMESH_VISIBILITY_SHA
  )
    throw Error("Pinned attached-mesh packages required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-attached-mesh-selection" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    profile.sliceSha256 !== meta.sliceSha256 ||
    profile.vfxPostloadSha256 !== meta.postloadPackageSha256 ||
    meta.submeshVisibilityPackageSha256 !== SUBMESH_VISIBILITY_SHA ||
    (await sha256(effectsBytes)) !== meta.effectsManifestSha256
  )
    throw Error("Unsupported attached-mesh build/assets");
  const submesh = await createLatestSubmeshVisibility(
      profile,
      sceneBytes,
      submeshBytes,
    ),
    pool = createAttachedMeshResources();
  return {
    metadata: structuredClone(meta),
    async createResource(asset, modelBytes, graphBytes) {
      const binding = await submesh.bind(asset, modelBytes, graphBytes);
      return pool.create(binding.ranges);
    },
    ranges(resource) {
      return pool.ranges(resource);
    },
    createCache(effectId, emitterIndex) {
      if (
        typeof effectId !== "string" ||
        !Number.isSafeInteger(emitterIndex) ||
        emitterIndex < 0
      )
        throw Error("Invalid attached emitter identity");
      const ref = meta.entries[`${effectId}:${emitterIndex}`];
      if (!ref) throw Error("Attached emitter not prepared");
      return createAttachedMeshMaskCache(
        {
          drawHashes: ref.drawHashes,
          alwaysHashes: ref.alwaysHashes,
          useAvatarMask: ref.useAvatarMask,
        },
        pool,
      );
    },
  };
}
