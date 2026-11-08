// Integrity and closure for a trusted, same-origin prepared static root. This
// capability does not authenticate that root or approve native material behavior.
import { sha256 } from "./structural-comparison.mjs";
import { ownLatestStaticBytes } from "./latest-static-bytes.mjs";
import { directInitializationViewSpan } from "./latest-direct-initialization-ownership.mjs";
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
export const STATIC_CATALOG_POLICY = "owned-selected-static-content-v1";
export const STATIC_CATALOG_DECODER_IMAGE_SHA256 =
  "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7";
const owned = new WeakSet(),
  profilePath = "decoder-16.21-macos/profile.json",
  bootstrapPath = "latest-static-catalog/bootstrap.json";
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const pathValid = (value) =>
  typeof value === "string" &&
  value.length <= 512 &&
  /^[-A-Za-z0-9_./]+$/.test(value) &&
  !value.startsWith("/") &&
  value.split("/").every((part) => part && part !== "." && part !== "..");
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const clone = (value) => structuredClone(value);
function byteView(value) {
  directInitializationViewSpan(value, { uint8Only: true });
  for (const key of ["slice", "subarray", "set", "length", "toJSON"])
    if (Object.getOwnPropertyDescriptor(value, key))
      throw Error("Unshadowed selected byte view required");
  return value;
}
function ownRecord(value, maxKeys = 8192) {
  if (
    !value ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error("Plain selected own-data record required");
  const keys = Reflect.ownKeys(value);
  if (keys.length > maxKeys)
    throw Error("Bounded selected own-data record required");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      key === "toJSON" ||
      !Object.hasOwn(descriptor, "value")
    )
      throw Error("Own data selected fields required");
  }
  return keys;
}
function byteRecord(value, maxKeys = 8192) {
  for (const path of ownRecord(value, maxKeys)) {
    if (!pathValid(path)) throw Error("Bounded captured static path required");
    byteView(value[path]);
  }
}
function initializationGraph(value) {
  ownRecord(value, 7);
  for (const key of ["bootstrapBytes", "profileBytes", "catalogBytes"])
    byteView(value[key]);
  byteRecord(value.roots, 128);
  assertDirectCompiledDataGraph(value.inventory);
}
const exactKeys = (value, keys) =>
  value &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
export const isLatestStaticCatalogSelection = (value) => owned.has(value);
export function assertLatestStaticCatalogSelection(value) {
  if (!owned.has(value)) throw Error("Owned selected static catalog required");
  return value;
}
export function assertLatestStaticCatalogInitialization(value) {
  initializationGraph(value);
  if (
    !exactKeys(value, [
      "schema",
      "policy",
      "bootstrapBytes",
      "profileBytes",
      "catalogBytes",
      "roots",
      "inventory",
    ]) ||
    value.schema !== 1 ||
    value.policy !== STATIC_CATALOG_POLICY
  )
    throw Error("Captured selected static initialization required");
}

export async function loadLatestStaticCatalogSelection({ load }) {
  if (typeof load !== "function")
    throw Error("Trusted static-root loader required");
  const bootstrapBytes = ownLatestStaticBytes(await load(bootstrapPath)),
    bootstrap = decode(bootstrapBytes),
    reference = bootstrap.catalog;
  if (
    !exactKeys(bootstrap, ["schema", "kind", "profile", "catalog"]) ||
    bootstrap.schema !== 1 ||
    bootstrap.kind !== "trusted-static-content-bootstrap" ||
    !exactKeys(bootstrap.profile, ["path", "sha256"]) ||
    bootstrap.profile.path !== profilePath ||
    !digest(bootstrap.profile.sha256)
  )
    throw Error("Trusted static bootstrap must bind the build profile");
  const profileBytes = ownLatestStaticBytes(await load(profilePath)),
    profile = decode(profileBytes);
  if ((await sha256(profileBytes)) !== bootstrap.profile.sha256)
    throw Error("Bootstrap-selected profile digest differs");
  if (
    profile.clientVersion !== "16.21.829.8620" ||
    profile.protocolDigest !== "20e09df23c66b85e" ||
    profile.decoderImageSha256 !== STATIC_CATALOG_DECODER_IMAGE_SHA256 ||
    !exactKeys(reference, ["path", "sha256"]) ||
    !pathValid(reference.path) ||
    [profilePath, bootstrapPath].includes(reference.path) ||
    !digest(reference.sha256)
  )
    throw Error("Static bootstrap must select a compatible prepared catalog");
  const catalogBytes = ownLatestStaticBytes(await load(reference.path));
  if (
    catalogBytes.length > 16 * 1024 * 1024 ||
    (await sha256(catalogBytes)) !== reference.sha256
  )
    throw Error("Bootstrap-selected static catalog digest differs");
  const catalog = decode(catalogBytes);
  assertDirectCompiledDataGraph(catalog);
  if (
    !exactKeys(catalog, [
      "schema",
      "kind",
      "policy",
      "build",
      "protocol",
      "decoderImageSha256",
      "map",
      "roles",
      "files",
    ]) ||
    catalog.schema !== 1 ||
    catalog.kind !== "prepared-selected-static-content" ||
    catalog.policy !== STATIC_CATALOG_POLICY ||
    catalog.build !== profile.clientVersion ||
    catalog.protocol !== profile.protocolDigest ||
    catalog.decoderImageSha256 !== profile.decoderImageSha256 ||
    !exactKeys(catalog.map, ["id", "presentationVariant"]) ||
    !Number.isInteger(catalog.map.id) ||
    catalog.map.id < 0 ||
    catalog.map.id > 0xffffffff ||
    typeof catalog.map.presentationVariant !== "string" ||
    !catalog.map.presentationVariant.length ||
    catalog.map.presentationVariant.length > 128 ||
    !catalog.roles ||
    !catalog.files ||
    Array.isArray(catalog.roles) ||
    Array.isArray(catalog.files)
  )
    throw Error("Unsupported selected static catalog contract");
  const paths = Object.keys(catalog.files),
    roles = Object.keys(catalog.roles);
  if (
    !paths.length ||
    paths.length > 65536 ||
    roles.length < 4 ||
    roles.length > 128
  )
    throw Error("Bounded selected static inventory required");
  for (const path of paths) {
    const entry = catalog.files[path];
    if (
      !pathValid(path) ||
      path === profilePath ||
      path === bootstrapPath ||
      path === reference.path ||
      !exactKeys(entry, ["sha256", "bytes"]) ||
      !digest(entry.sha256) ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes < 0 ||
      entry.bytes > 512 * 1024 * 1024
    )
      throw Error("Invalid selected static file identity");
  }
  if (new Set(Object.values(catalog.roles)).size !== roles.length)
    throw Error("Selected static roles must have distinct files");
  for (const role of roles)
    if (
      !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(role) ||
      !Object.hasOwn(catalog.files, catalog.roles[role])
    )
      throw Error("Selected static role is absent from its inventory");
  for (const role of ["scene", "effects", "effectContexts", "viewerPoses"])
    if (!Object.hasOwn(catalog.roles, role))
      throw Error("Complete scene/effect/context/pose roots required");
  const captured = new Map();
  const imagePath = "decoder-16.21-macos/image.bin",
    imageMetrics = {
      bytes: 0,
      captureCopyBytes: 0,
      captureCopyCpuMs: 0,
      readCopies: 0,
      readCopyBytes: 0,
      readCopyCpuMs: 0,
      loadAndVerifyMs: 0,
      blockVerificationMs: 0,
    };
  const capturing = new Map();
  let imageApproval = null;
  async function capture(path) {
    if (!pathValid(path)) throw Error("Bounded selected static path required");
    if (!Object.hasOwn(catalog.files, path))
      throw Error("File outside selected static catalog: " + path);
    if (!captured.has(path)) {
      if (!capturing.has(path))
        capturing.set(
          path,
          (async () => {
            const started = performance.now(),
              source = await load(path),
              copyStarted = performance.now(),
              bytes = ownLatestStaticBytes(source),
              copied = performance.now(),
              entry = catalog.files[path];
            if (
              bytes.length !== entry.bytes ||
              (await sha256(bytes)) !== entry.sha256
            )
              throw Error("Selected static file differs: " + path);
            captured.set(path, bytes);
            if (path === imagePath)
              Object.assign(imageMetrics, {
                bytes: bytes.length,
                captureCopyBytes: bytes.length,
                captureCopyCpuMs: copied - copyStarted,
                loadAndVerifyMs: performance.now() - started,
              });
          })(),
        );
      await capturing.get(path);
    }
    return captured.get(path);
  }
  async function read(path) {
    const bytes = await capture(path),
      started = performance.now(),
      copy = bytes.slice();
    if (path === imagePath) {
      imageMetrics.readCopies++;
      imageMetrics.readCopyBytes += copy.length;
      imageMetrics.readCopyCpuMs += performance.now() - started;
    }
    return copy;
  }
  const roots = {};
  for (const role of roles)
    roots[role] = decode(await read(catalog.roles[role]));
  const scene = roots.scene,
    effects = roots.effects,
    contexts = roots.effectContexts,
    poses = roots.viewerPoses;
  for (const data of [scene, effects, contexts, poses])
    if (data.build !== catalog.build || data.protocol !== catalog.protocol)
      throw Error("Selected root build differs");
  if (
    scene.map?.id !== catalog.map.id ||
    scene.map.variant !== catalog.map.presentationVariant ||
    contexts.kind !== "prepared-character-effect-contexts" ||
    poses.kind !== "pinned-static-viewer-pose-assets" ||
    effects.sceneManifestSha256 !== catalog.files[catalog.roles.scene].sha256 ||
    contexts.effectsManifestSha256 !==
      catalog.files[catalog.roles.effects].sha256 ||
    poses.sceneManifestSha256 !== catalog.files[catalog.roles.scene].sha256 ||
    contexts.decoderImageSha256 !== catalog.decoderImageSha256 ||
    poses.decoderImageSha256 !== catalog.decoderImageSha256
  )
    throw Error("Selected static root closure differs");
  if (
    roots.effectsSource &&
    (roots.effectsSource.build !== catalog.build ||
      roots.effectsSource.protocol !== catalog.protocol ||
      roots.effectsSource.sceneManifestSha256 !==
        catalog.files[catalog.roles.scene].sha256)
  )
    throw Error("Selected effect source package scene/build closure differs");
  const inventory = {
    policy: STATIC_CATALOG_POLICY,
    profileSha256: await sha256(profileBytes),
    bootstrapSha256: await sha256(bootstrapBytes),
    catalogPath: reference.path,
    catalogSha256: reference.sha256,
    build: catalog.build,
    protocol: catalog.protocol,
    decoderImageSha256: catalog.decoderImageSha256,
    map: clone(catalog.map),
    roles: clone(catalog.roles),
    files: clone(catalog.files),
  };
  const selection = Object.freeze({
    describe: () => clone(inventory),
    profile: () => clone(profile),
    readProfile: () => profileBytes.slice(),
    read,
    async verifyNativeImageBlocks(blocks) {
      assertDirectCompiledDataGraph(blocks);
      if (!Array.isArray(blocks) || !blocks.length || blocks.length > 16384)
        throw Error("Bounded native instruction block inventory required");
      const started = performance.now(),
        image = await capture(imagePath);
      if (!imageApproval)
        imageApproval = (async () => {
          if ((await sha256(image)) !== STATIC_CATALOG_DECODER_IMAGE_SHA256)
            throw Error("Fixed original native image required");
        })();
      await imageApproval;
      const seen = new Set();
      for (const block of blocks) {
        if (
          !Number.isSafeInteger(block.rva) ||
          !Number.isSafeInteger(block.size) ||
          block.rva < 0 ||
          block.size <= 0 ||
          block.rva + block.size > image.length ||
          seen.has(block.rva) ||
          !digest(block.sha256) ||
          (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
            block.sha256
        )
          throw Error("Selected original native instruction block differs");
        seen.add(block.rva);
      }
      imageMetrics.blockVerificationMs += performance.now() - started;
      return {
        imageSha256: STATIC_CATALOG_DECODER_IMAGE_SHA256,
        imageBytes: image.length,
        blocks: blocks.length,
      };
    },
    initializationMetrics: () => clone({ nativeImage: imageMetrics }),
    readRole(role) {
      if (typeof role !== "string")
        throw Error("Typed selected static role required");
      if (!Object.hasOwn(catalog.roles, role))
        throw Error("Selected static role required: " + role);
      return read(catalog.roles[role]);
    },
    async assertRole(role, bytes) {
      if (typeof role !== "string")
        throw Error("Typed selected static role required");
      byteView(bytes);
      if (!Object.hasOwn(catalog.roles, role))
        throw Error("Selected static role required: " + role);
      const entry = catalog.files[catalog.roles[role]],
        data = ownLatestStaticBytes(bytes);
      if (data.length !== entry.bytes || (await sha256(data)) !== entry.sha256)
        throw Error("Consumer bytes differ from selected static role: " + role);
    },
    serializeForWorker() {
      return {
        schema: 1,
        policy: STATIC_CATALOG_POLICY,
        bootstrapBytes: bootstrapBytes.slice(),
        profileBytes: profileBytes.slice(),
        catalogBytes: catalogBytes.slice(),
        roots: Object.fromEntries(
          roles.map((role) => [
            catalog.roles[role],
            captured.get(catalog.roles[role]).slice(),
          ]),
        ),
        inventory: clone(inventory),
      };
    },
    async bindWorkerInitialization(packages) {
      byteRecord(packages);
      const identities = {
        [bootstrapPath]: inventory.bootstrapSha256,
        [profilePath]: inventory.profileSha256,
        [reference.path]: inventory.catalogSha256,
        ...Object.fromEntries(
          roles.map((role) => {
            const path = catalog.roles[role];
            return [path, catalog.files[path].sha256];
          }),
        ),
      };
      for (const [path, expected] of Object.entries(identities)) {
        if (
          !Object.hasOwn(packages, path) ||
          !(packages[path] instanceof Uint8Array) ||
          (await sha256(packages[path])) !== expected
        )
          throw Error(
            "Owned initialization differs from selected root: " + path,
          );
      }
      return {
        schema: 1,
        policy: STATIC_CATALOG_POLICY,
        bootstrapBytes: packages[bootstrapPath],
        profileBytes: packages[profilePath],
        catalogBytes: packages[reference.path],
        roots: Object.fromEntries(
          roles.map((role) => [
            catalog.roles[role],
            packages[catalog.roles[role]],
          ]),
        ),
        inventory: clone(inventory),
      };
    },
    scope: Object.freeze({
      trustedStaticRootAuthenticityAssumed: true,
      integrityAndClosureVerified: true,
      nativeMaterialAdmissionEstablished: false,
      nativeWorldAcceptanceEstablished: false,
    }),
  });
  owned.add(selection);
  return selection;
}

export async function restoreLatestStaticCatalogSelection({
  initialization,
  load,
}) {
  assertLatestStaticCatalogInitialization(initialization);
  if (
    !exactKeys(initialization, [
      "schema",
      "policy",
      "bootstrapBytes",
      "profileBytes",
      "catalogBytes",
      "roots",
      "inventory",
    ]) ||
    initialization.schema !== 1 ||
    initialization.policy !== STATIC_CATALOG_POLICY ||
    typeof load !== "function"
  )
    throw Error("Captured selected static initialization required");
  const snapshot = clone(initialization),
    bootstrap = decode(ownLatestStaticBytes(snapshot.bootstrapBytes));
  const reference = bootstrap.catalog;
  const selection = await loadLatestStaticCatalogSelection({
    load: async (path) => {
      if (path === bootstrapPath) return snapshot.bootstrapBytes;
      if (path === profilePath) return snapshot.profileBytes;
      if (path === reference?.path) return snapshot.catalogBytes;
      if (Object.hasOwn(snapshot.roots, path)) return snapshot.roots[path];
      return load(path);
    },
  });
  if (
    !sameDirectCompiledData(selection.describe(), snapshot.inventory) ||
    !sameDirectCompiledData(
      Object.keys(snapshot.roots).sort(),
      Object.values(selection.describe().roles).sort(),
    )
  )
    throw Error(
      "Transferred selected inventory differs from reconstructed content",
    );
  return selection;
}
