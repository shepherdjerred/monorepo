import { sha256 } from "./structural-comparison.mjs";
import { copyDirectViewerPoseInitialization } from "./latest-direct-initialization-ownership.mjs";
import {
  assertLatestStaticCatalogSelection,
  loadLatestStaticCatalogSelection,
} from "./latest-static-catalog.mjs";
import {
  sameDirectCompiledData,
  assertDirectCompiledDataGraph,
} from "./latest-direct-compiled-restore.mjs";
import { createLatestAnimationPoses } from "./latest-animation-poses.mjs";
import { createLatestAnimationRigBindings } from "./latest-animation-rigs.mjs";
import {
  createAnimationGraph,
  readAnimationAsset,
} from "./latest-animation.mjs";
import { resolveCombatPresentation } from "./latest-combat.mjs";
import { VIEWER_POSE_POLICY } from "./latest-viewer-pose-sampler.mjs";
import { createLatestViewerBoundSizeResources } from "./latest-viewer-bound-size.mjs";

export const VIEWER_POSE_MATH_SHA256 =
  "3718df126d69c125362a03340913204470d8c50238605150e57f808840fb7759";
export const VIEWER_POSE_ASSET_PACKAGE_SHA =
  "6582ff2db8585a8d7fa672509ba154f5181ebe624494f74bedb83419f323198e";
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const exact = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function math(bytes) {
  if ((await sha256(bytes)) !== VIEWER_POSE_MATH_SHA256)
    throw Error("Pinned viewer pose math differs");
  // three.core.js is the self-contained math/Object3D module re-exported by the
  // viewer's three.module.js. A verified module Blob works in browser workers
  // and Bun without a browser import map or host filesystem import.
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "text/javascript" }),
  );
  try {
    return await import(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function createLatestViewerPoseHierarchy(THREE, bytes, asset, catalog) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    view.getUint32(12, true) > bytes.length - 20
  )
    throw Error("Exact GLB2 viewer pose hierarchy required");
  const model = decode(bytes.subarray(20, 20 + view.getUint32(12, true)));
  if (
    !Array.isArray(model.nodes) ||
    model.nodes.length > 4096 ||
    !model.scenes?.[model.scene ?? 0]?.nodes
  )
    throw Error("Bounded GLB hierarchy required");
  const dense = (values, size) =>
    Array.isArray(values) &&
    values.length === size &&
    Array.from(values).every(Number.isFinite);
  const nodes = model.nodes.map((source, index) => {
    const node = new THREE.Object3D();
    node.name = THREE.PropertyBinding.sanitizeNodeName(
      source.name ?? `node_${index}`,
    );
    if (source.matrix) {
      if (!dense(source.matrix, 16)) throw Error("Invalid GLB node matrix");
      node.matrix.fromArray(source.matrix);
      node.matrix.decompose(node.position, node.quaternion, node.scale);
    } else {
      for (const [key, size, target] of [
        ["translation", 3, node.position],
        ["rotation", 4, node.quaternion],
        ["scale", 3, node.scale],
      ])
        if (source[key] !== undefined) {
          if (!dense(source[key], size))
            throw Error("Invalid GLB node transform");
          target.fromArray(source[key]);
        }
    }
    return node;
  });
  const parents = new Set();
  for (const [index, source] of model.nodes.entries())
    for (const child of source.children ?? []) {
      if (
        !Number.isInteger(child) ||
        !nodes[child] ||
        parents.has(child) ||
        child === index
      )
        throw Error("Instanced/invalid GLB pose hierarchy");
      parents.add(child);
      nodes[index].add(nodes[child]);
    }
  // Reject cycles before Object3D.updateWorldMatrix can recurse indefinitely.
  const visited = new Set(),
    walk = (index, active = new Set()) => {
      if (active.has(index)) throw Error("Cyclic GLB pose hierarchy");
      if (visited.has(index)) return;
      active.add(index);
      for (const child of model.nodes[index].children ?? [])
        walk(child, active);
      active.delete(index);
      visited.add(index);
    };
  for (let index = 0; index < nodes.length; index++) walk(index);
  const mirror = new THREE.Group(),
    group = new THREE.Group(),
    modelScene = new THREE.Group();
  mirror.scale.z = -1;
  mirror.add(group);
  group.add(modelScene);
  modelScene.scale.setScalar(asset.scale);
  for (const index of model.scenes[model.scene ?? 0].nodes) {
    if (!nodes[index] || parents.has(index))
      throw Error("Invalid GLB pose scene root");
    modelScene.add(nodes[index]);
  }
  const jointMap = new Map();
  for (const name of catalog.joints) {
    const matches = nodes.filter(
      (node) => node.name === THREE.PropertyBinding.sanitizeNodeName(name),
    );
    if (matches.length !== 1)
      throw Error(`Unbound or ambiguous viewer skeleton joint ${name}`);
    const node = matches[0];
    jointMap.set(name, {
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
  }
  return { group, jointMap, nodes, mirror };
}

export async function loadLatestViewerPoseAssets({
  profile,
  report,
  scene,
  load,
  THREE = null,
  staticCatalog = null,
}) {
  if (
    profile.clientVersion !== "16.21.829.8620" ||
    profile.protocolDigest !== "20e09df23c66b85e" ||
    report.build !== profile.clientVersion ||
    report.protocol !== profile.protocolDigest
  )
    throw Error("Exact viewer-pose build required");
  const packages = {},
    hashes = {};
  if (staticCatalog !== null) {
    assertLatestStaticCatalogSelection(staticCatalog);
    assertDirectCompiledDataGraph(profile);
    if (!sameDirectCompiledData(staticCatalog.profile(), profile))
      throw Error("Selected viewer pose profile differs");
    const snapshot = staticCatalog.serializeForWorker();
    const selectedFiles = {
      "latest-static-catalog/bootstrap.json": snapshot.bootstrapBytes,
      "decoder-16.21-macos/profile.json": snapshot.profileBytes,
      [snapshot.inventory.catalogPath]: snapshot.catalogBytes,
      ...snapshot.roots,
    };
    for (const [path, bytes] of Object.entries(selectedFiles)) {
      packages[path] = bytes;
      hashes[path] = await sha256(bytes);
    }
  }
  async function raw(path) {
    if (!packages[path]) {
      const bytes = await (staticCatalog === null
        ? load(path)
        : staticCatalog.read(path));
      if (!(bytes instanceof Uint8Array))
        throw Error("Viewer pose asset bytes required");
      packages[path] = staticCatalog === null ? new Uint8Array(bytes) : bytes;
      hashes[path] = await sha256(bytes);
    }
    return packages[path];
  }
  // Selected resource restoration verifies original instruction blocks in the
  // same worker; retain that exact image in the owned initialization producer.
  if (staticCatalog !== null) await raw("decoder-16.21-macos/image.bin");
  const sceneBytes = await raw("latest-scene/manifest.json"),
    clockBytes = await raw("decoder-16.21-macos/animation-clock.json"),
    poseBytes = await raw("latest-animation-poses/manifest.json"),
    rigBytes = await raw("decoder-16.21-macos/animation-rigs.json"),
    core = await raw("vendor/three.core.js");
  const poseMeta = decode(poseBytes),
    rigs = decode(rigBytes);
  const packageBytes = await raw("latest-viewer-poses/package.json"),
    pinned = decode(packageBytes);
  if (staticCatalog !== null)
    await staticCatalog.assertRole("viewerPoses", packageBytes);
  if (
    (staticCatalog === null &&
      (await sha256(packageBytes)) !== VIEWER_POSE_ASSET_PACKAGE_SHA) ||
    pinned.schema !== 1 ||
    pinned.kind !== "pinned-static-viewer-pose-assets" ||
    pinned.build !== profile.clientVersion ||
    pinned.protocol !== profile.protocolDigest ||
    pinned.decoderImageSha256 !== profile.decoderImageSha256 ||
    pinned.sceneManifestSha256 !== (await sha256(sceneBytes)) ||
    pinned.mathSha256 !== VIEWER_POSE_MATH_SHA256 ||
    pinned.scope.staticBuildAssetsOnly !== true ||
    pinned.scope.replayEntityIds !== false ||
    pinned.scope.replayEvents !== false
  )
    throw Error("Pinned static viewer pose package differs");
  if (
    !exact(decode(sceneBytes), scene) ||
    (await sha256(sceneBytes)) !== poseMeta.sceneManifestSha256
  )
    throw Error(
      "Viewer pose scene manifest differs from pinned animation package",
    );
  if ((await sha256(core)) !== VIEWER_POSE_MATH_SHA256)
    throw Error("Pinned viewer pose math differs");
  const boundResources =
    staticCatalog === null
      ? null
      : await createLatestViewerBoundSizeResources({
          staticCatalog,
          profile,
          scene,
          image: await raw("decoder-16.21-macos/image.bin"),
          read: raw,
        });
  THREE ??= await math(core);
  if (THREE.REVISION !== "185")
    throw Error("Viewer pose THREE revision differs");
  const poses = await createLatestAnimationPoses(
      profile,
      clockBytes,
      poseBytes,
    ),
    rigFactory = await createLatestAnimationRigBindings(profile, rigBytes),
    actors = new Map();
  for (const hero of report.heroes) {
    const actorKey = `${hero.champion.toLowerCase()}/${hero.skinId}`,
      asset = scene.champions[actorKey];
    if (!asset || actors.has(hero.entityId))
      throw Error("Unique equipped viewer actor asset required");
    const graphBytes = await raw(`latest-scene/${asset.animationGraph}`),
      catalogBytes = await raw(`latest-scene/${asset.animationCatalog}`),
      modelBytes = await raw(`latest-scene/${asset.model}`),
      spellBytes = await raw(`latest-scene/${asset.spellCatalog}`);
    const model = pinned.models[`latest-scene/${asset.model}`];
    if (
      !model ||
      (await sha256(modelBytes)) !== model.sha256 ||
      model.graph !== asset.animationGraph ||
      model.catalog !== asset.animationCatalog ||
      model.scale !== asset.scale
    )
      throw Error("Pinned installed viewer GLB differs");
    const bound = await poses.bind(
        asset.animationGraph,
        graphBytes,
        catalogBytes,
      ),
      graph = createAnimationGraph(
        decode(graphBytes),
        bound.catalog,
        bound.clock,
      ),
      rig = rigs.graphs[asset.animationGraph];
    if (!rig) throw Error("Equipped constructed rig is unprepared");
    const native = await rigFactory.bind(
        asset.animationGraph,
        await raw(`latest-scene/${rig.rigFile}`),
        catalogBytes,
      ),
      bindings = rig.bindings.map((binding) => native.resolve(binding.name));
    const events = [
      ...report.animations
        .filter((event) => event.entityId === hero.entityId)
        .map((event) => ({
          ...event,
          rate: event.scalar20,
          sourceKind: "animation-name",
        })),
      ...resolveCombatPresentation(
        {
          character: hero.champion,
          entityId: hero.entityId,
          characterRecords: asset.characterRecords,
        },
        decode(spellBytes),
        report,
      ).actions,
    ].sort((a, b) => a.time - b.time || a.sequence - b.sequence);
    const files = new Set([
        bound.catalog.clips[asset.previewClips.idle].file,
        bound.catalog.clips[asset.previewClips.run].file,
        ...graph.dependencies("Death"),
        ...events.flatMap((event) => graph.dependencies(event.name)),
      ]),
      poseAssets = new Map();
    for (const file of files) {
      if (!/^clips\/\d+\.clip$/.test(file))
        throw Error("Invalid static pose clip path");
      const bytes = await raw(
        `latest-animation-poses/${bound.directory}/${file}`,
      );
      if ((await sha256(bytes)) !== bound.expectedFileHash(file))
        throw Error("Viewer clip hash differs");
      poseAssets.set(
        file,
        readAnimationAsset(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        ),
      );
    }
    const source = {
      actorKey,
      asset: structuredClone(asset),
      catalog: bound.catalog,
      graph,
      bindings,
      events,
      poseAssets,
      modelBytes,
      modelSha256: model.sha256,
    };
    // Validate the complete hierarchy now, before ordinary Play is available.
    source.defaults = createLatestViewerPoseHierarchy(
      THREE,
      modelBytes,
      asset,
      bound.catalog,
    );
    actors.set(hero.entityId, source);
  }
  const contentHash = await sha256(
    new TextEncoder().encode(
      JSON.stringify(
        Object.entries(hashes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    ),
  );
  function entry(source, hierarchy) {
    return {
      ...hierarchy,
      catalog: structuredClone(source.catalog),
      graph: source.graph,
      events: structuredClone(source.events),
      poseAssets: structuredClone(source.poseAssets),
      previewNames: structuredClone(source.asset.previewClips),
      modelSha256: source.modelSha256,
    };
  }
  return Object.freeze({
    policy: VIEWER_POSE_POLICY,
    contentHash,
    sampleBoundSize(entityId, position) {
      const source = actors.get(entityId);
      if (!source) throw Error("Owned viewer bound actor required");
      return boundResources === null
        ? {
            resolved: false,
            reasons: [
              "bound-size:selected-installed-resource-owner-unavailable",
            ],
          }
        : boundResources.sample(source.actorKey, position);
    },
    serialize() {
      return structuredClone({
        schema: 1,
        policy: VIEWER_POSE_POLICY,
        contentHash,
        hashes,
        packages,
      });
    },
    serializeForWorker() {
      return copyDirectViewerPoseInitialization({
        schema: 1,
        policy: VIEWER_POSE_POLICY,
        contentHash,
        hashes,
        packages,
      });
    },
    actor(entityId) {
      const source = actors.get(entityId);
      if (!source) return null;
      return {
        actorKey: source.actorKey,
        bindings: structuredClone(source.bindings),
        staticHashes: {
          model: hashes[`latest-scene/${source.asset.model}`],
          graph: hashes[`latest-scene/${source.asset.animationGraph}`],
          catalog: hashes[`latest-scene/${source.asset.animationCatalog}`],
          rig: hashes[
            `latest-scene/${rigs.graphs[source.asset.animationGraph].rigFile}`
          ],
          posePackage: hashes["latest-animation-poses/manifest.json"],
          math: VIEWER_POSE_MATH_SHA256,
        },
      };
    },
    createEntry(entityId) {
      const source = actors.get(entityId);
      if (!source) return null;
      return entry(
        source,
        createLatestViewerPoseHierarchy(
          THREE,
          source.modelBytes,
          source.asset,
          source.catalog,
        ),
      );
    },
    bindRenderedEntry(entityId, rendered) {
      const source = actors.get(entityId);
      if (
        !source ||
        rendered.modelSha256 !== source.modelSha256 ||
        !exact(rendered.catalog.joints, source.catalog.joints) ||
        !rendered.group?.children?.[0] ||
        !exact(rendered.group.children[0].scale.toArray(), [
          source.asset.scale,
          source.asset.scale,
          source.asset.scale,
        ])
      )
        throw Error("Rendered viewer actor differs from static pose asset");
      for (const [name, expected] of source.defaults.jointMap) {
        const actual = rendered.jointMap.get(name);
        if (
          !actual ||
          !exact(actual.position.toArray(), expected.position.toArray()) ||
          !exact(actual.quaternion.toArray(), expected.quaternion.toArray()) ||
          !exact(actual.scale.toArray(), expected.scale.toArray())
        )
          throw Error(`Rendered viewer bind pose differs: ${name}`);
      }
      Object.assign(
        rendered,
        entry(source, { group: rendered.group, jointMap: rendered.jointMap }),
      );
      return rendered;
    },
    THREE,
  });
}
export async function restoreLatestViewerPoseAssets({
  bundle,
  profile,
  report,
  scene,
  staticCatalog = undefined,
}) {
  if (
    !bundle ||
    bundle.schema !== 1 ||
    bundle.policy !== VIEWER_POSE_POLICY ||
    typeof bundle.contentHash !== "string" ||
    !bundle.hashes ||
    !bundle.packages ||
    Object.keys(bundle.packages).length > 8192 ||
    !exact(
      Object.keys(bundle.hashes).sort(),
      Object.keys(bundle.packages).sort(),
    )
  )
    throw Error("Serialized static viewer pose assets required");
  for (const [path, bytes] of Object.entries(bundle.packages))
    if (
      !(bytes instanceof Uint8Array) ||
      (await sha256(bytes)) !== bundle.hashes[path]
    )
      throw Error(`Transferred viewer pose asset differs: ${path}`);
  const transferredLoad = (path) => {
    if (!Object.hasOwn(bundle.packages, path))
      throw Error(`Missing transferred static pose asset: ${path}`);
    return bundle.packages[path];
  };
  const selected =
    staticCatalog === undefined
      ? Object.hasOwn(bundle.packages, "latest-static-catalog/bootstrap.json")
        ? await loadLatestStaticCatalogSelection({ load: transferredLoad })
        : null
      : staticCatalog;
  if (selected !== null) assertLatestStaticCatalogSelection(selected);
  const assets = await loadLatestViewerPoseAssets({
    profile,
    report,
    scene,
    load: transferredLoad,
    staticCatalog: selected,
  });
  if (assets.contentHash !== bundle.contentHash)
    throw Error("Viewer pose presentation content hash differs");
  return assets;
}
