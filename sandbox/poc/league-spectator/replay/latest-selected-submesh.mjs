import { sha256 } from "./structural-comparison.mjs";
import { animationHash } from "./latest-animation.mjs";
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
import {
  assertLatestStaticCatalogSelection,
  STATIC_CATALOG_DECODER_IMAGE_SHA256,
} from "./latest-static-catalog.mjs";
import { SUBMESH_VISIBILITY_SHA } from "./latest-submesh-visibility-contract.mjs";
const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
  nameHash = (name) => parseInt(animationHash(name).slice(1, -1), 16),
  PREPARER_SHA =
    "1833655b64e690ef210b0a8f1be614543fa870946f68a6aded623b7806bc9e69",
  SOURCES_SHA =
    "3abad34f478b3e0c2f70f02482af7f22f62361f9e828dcee1e60da062638f0dd",
  CONTROLLED_SEQUENCES_SHA =
    "5bb4b6e6806ff5b10844d79d87057f20a93f66ed86608e932daf58b81fdbd844";
// Native maps are unordered; Python's set traversal changes only key insertion
// order between processes. Keep all array order, scalar values and signed zero.
const canonicalControlJson = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonicalControlJson).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${canonicalControlJson(value[key])}`,
          )
          .join(",")}}`
      : Object.is(value, -0)
        ? "-0.0"
        : JSON.stringify(value);

export function assertSelectedSubmeshProgram(reference, metadata, sceneSha256) {
  assertDirectCompiledDataGraph(reference);
  assertDirectCompiledDataGraph(metadata);
  if (
    !reference ||
    !metadata ||
    Array.isArray(reference) ||
    Array.isArray(metadata) ||
    !digest(sceneSha256) ||
    metadata.sceneManifestSha256 !== sceneSha256 ||
    !sameDirectCompiledData(
      {
        ...reference,
        sceneManifestSha256: sceneSha256,
        assets: metadata.assets,
      },
      metadata,
    )
  )
    throw Error(
      "Selected submesh data must retain the fixed original program/layout/scope",
    );
}

// Derive the complete component's authored rows from selected installed data.
// Unrelated animation event classes remain outside this visibility component.
export async function deriveSelectedSubmeshAsset(
  actor,
  asset,
  modelBytes,
  graphBytes,
  sknBytes,
) {
  const graph = decode(graphBytes),
    roots = Object.values(graph).filter(
      (value) => value?.__type === "AnimationGraphData",
    );
  if (roots.length !== 1 || !Array.isArray(asset.hidden))
    throw Error("Ambiguous selected visibility graph/hidden ranges");
  const view = new DataView(
      sknBytes.buffer,
      sknBytes.byteOffset,
      sknBytes.byteLength,
    ),
    magic = view.getUint32(0, true),
    major = view.getUint16(4, true),
    minor = view.getUint16(6, true),
    count = view.getUint32(8, true);
  if (
    magic !== 0x112233 ||
    ![
      [2, 1],
      [4, 1],
    ].some(([a, b]) => a === major && b === minor) ||
    count < 1 ||
    count > 32 ||
    sknBytes.length < 12 + count * 80
  )
    throw Error("Unsupported selected SKN range container");
  const names = Array.from({ length: count }, (_, i) => {
      const raw = sknBytes.subarray(12 + i * 80, 12 + i * 80 + 64),
        end = raw.indexOf(0),
        bytes = raw.subarray(0, end < 0 ? raw.length : end);
      if (!bytes.length || bytes.some((value) => value < 32 || value > 126))
        throw Error("Typed printable SKN range name required");
      return new TextDecoder().decode(bytes);
    }),
    modelView = new DataView(
      modelBytes.buffer,
      modelBytes.byteOffset,
      modelBytes.byteLength,
    ),
    jsonLength = modelView.getUint32(12, true);
  if (
    modelView.getUint32(0, true) !== 0x46546c67 ||
    modelView.getUint32(16, true) !== 0x4e4f534a ||
    20 + jsonLength > modelBytes.length
  )
    throw Error("Unsupported selected GLB range projection");
  const gltf = decode(modelBytes.subarray(20, 20 + jsonLength)),
    actual = gltf.meshes.flatMap((mesh) =>
      mesh.primitives.map(
        (primitive) => gltf.materials[primitive.material].name,
      ),
    );
  if (!sameDirectCompiledData(actual, names))
    throw Error("Selected GLB primitives differ from original SKN order");
  const mapping = new Map();
  names.forEach((name, i) =>
    mapping.set(
      nameHash(name),
      ((mapping.get(nameHash(name)) ?? 0) | (1 << i)) >>> 0,
    ),
  );
  const ranges = names.map((name, i) => ({
      name,
      hash: nameHash(name),
      mask: mapping.get(nameHash(name)),
      index: i,
    })),
    clips = {},
    allClips = Object.keys(roots[0].mClipDataMap),
    allowed = new Set([
      "__type",
      "mName",
      "mStartFrame",
      "mEndFrame",
      "mFireIfAnimationEndsEarly",
      "mShowSubmeshList",
      "mHideSubmeshList",
      "ApplyOnlyToAvatarMeshes",
    ]),
    mask = (names) =>
      names.reduce(
        (value, name) => (value | (mapping.get(nameHash(name)) ?? 0)) >>> 0,
        0,
      );
  for (const [name, clip] of Object.entries(roots[0].mClipDataMap)) {
    const events = [];
    for (const [id, event] of Object.entries(clip.mEventDataMap ?? {})) {
      if (event.__type !== "SubmeshVisibilityEventData") continue;
      if (Object.keys(event).some((key) => !allowed.has(key)))
        throw Error("Unknown authored selected submesh event field");
      const field = (name, initial) =>
          Object.hasOwn(event, name) ? event[name] : initial,
        normalized = {
          id,
          startFrame: field("mStartFrame", 0),
          endFrame: field("mEndFrame", -1),
          fireIfEarly: field("mFireIfAnimationEndsEarly", false),
          avatarOnly: field("ApplyOnlyToAvatarMeshes", false),
          show: field("mShowSubmeshList", []),
          hide: field("mHideSubmeshList", []),
        };
      if (
        ![normalized.startFrame, normalized.endFrame].every(
          (n) => typeof n === "number" && Number.isFinite(Math.fround(n)),
        ) ||
        typeof normalized.fireIfEarly !== "boolean" ||
        typeof normalized.avatarOnly !== "boolean" ||
        ![normalized.show, normalized.hide].every(
          (rows) =>
            Array.isArray(rows) && rows.every((n) => typeof n === "string"),
        )
      )
        throw Error("Typed selected submesh event fields required");
      events.push({
        ...normalized,
        showMask: mask(normalized.show),
        hideMask: mask(normalized.hide),
      });
    }
    if (events.length) clips[name] = { type: clip.__type, events };
  }
  return {
    actor,
    graphSha256: await sha256(graphBytes),
    model: asset.model,
    modelSha256: await sha256(modelBytes),
    skn: asset.model.replace(/\.[^.]+$/, ".skn"),
    sknSha256: await sha256(sknBytes),
    ranges,
    allClips,
    clips,
    hidden: asset.hidden,
  };
}

export async function assertLatestSelectedSubmesh({
  selection,
  profile,
  packageBytes,
  sceneBytes,
}) {
  assertLatestStaticCatalogSelection(selection);
  await selection.assertRole("submeshVisibility", packageBytes);
  await selection.assertRole("scene", sceneBytes);
  if (!sameDirectCompiledData(profile, selection.profile()))
    throw Error("Submesh profile differs from selected root");
  const referenceBytes = await selection.readRole("submeshVisibilityReference");
  if ((await sha256(referenceBytes)) !== SUBMESH_VISIBILITY_SHA)
    throw Error("Fixed original submesh program reference required");
  const metadata = decode(packageBytes),
    reference = decode(referenceBytes),
    proofBytes = await selection.readRole("submeshVisibilityProof"),
    proof = decode(proofBytes),
    image = await selection.read("decoder-16.21-macos/image.bin"),
    scene = decode(sceneBytes),
    worldBytes = await selection.read(`latest-scene/${scene.world}`),
    world = decode(worldBytes);
  assertDirectCompiledDataGraph(proof);
  assertSelectedSubmeshProgram(reference, metadata, await sha256(sceneBytes));
  if (
    (await sha256(image)) !== STATIC_CATALOG_DECODER_IMAGE_SHA256 ||
    proof.schema !== 1 ||
    proof.kind !== "native-submesh-visibility-observations" ||
    proof.packageSha256 !== (await sha256(packageBytes)) ||
    proof.preparerSha256 !== PREPARER_SHA ||
    !sameDirectCompiledData(proof.scope, reference.scope) ||
    (await sha256(
      new TextEncoder().encode(
        JSON.stringify(
          Object.entries(proof.sources).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        ),
      ),
    )) !== SOURCES_SHA
  )
    throw Error(
      "Selected submesh original producer/native observation differs",
    );
  const blocks = proof.originalBlocks,
    seen = new Set();
  if (!Array.isArray(blocks) || !blocks.length)
    throw Error("Original submesh instruction inventory required");
  for (const block of blocks) {
    if (
      !Number.isSafeInteger(block.rva) ||
      !Number.isSafeInteger(block.size) ||
      block.rva < 0 ||
      block.size <= 0 ||
      block.rva + block.size > image.length ||
      seen.has(block.rva) ||
      (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
        block.sha256
    )
      throw Error("Selected submesh original instruction block differs");
    seen.add(block.rva);
  }
  for (const rva of [
    0x18539f0, 0x184a7e0, 0x15dc8e0, 0x1595870, 0x1589270, 0x368ed0, 0x368f70,
  ])
    if (
      !blocks.some((block) => block.rva <= rva && rva < block.rva + block.size)
    )
      throw Error("Selected submesh original entry not observed");
  const input = (file, digest) => {
    const entries = Object.entries(proof.inputs).filter(([path]) =>
      path.replaceAll("\\", "/").endsWith(`/public/latest-scene/${file}`),
    );
    if (entries.length !== 1 || entries[0][1] !== digest)
      throw Error("Selected submesh observed source input differs");
  };
  input("manifest.json", await sha256(sceneBytes));
  input(scene.world, await sha256(worldBytes));
  const expected = {},
    authoredSequenceNames = new Set();
  for (const [actor, asset] of [
    ...Object.entries(scene.champions).map(([key, value]) => [
      `champions/${key}`,
      value,
    ]),
    ...Object.entries(world.assets)
      .filter(([, value]) => value.animationGraph)
      .map(([key, value]) => [`world/${key}`, value]),
  ]) {
    const graphBytes = await selection.read(
        `latest-scene/${asset.animationGraph}`,
      ),
      modelBytes = await selection.read(`latest-scene/${asset.model}`),
      skn = asset.model.replace(/\.[^.]+$/, ".skn"),
      sknBytes = await selection.read(`latest-scene/${skn}`),
      derived = await deriveSelectedSubmeshAsset(
        actor,
        asset,
        modelBytes,
        graphBytes,
        sknBytes,
      );
    if (Object.hasOwn(expected, asset.animationGraph))
      throw Error("Duplicate selected submesh graph identity");
    expected[asset.animationGraph] = derived;
    input(asset.animationGraph, derived.graphSha256);
    input(asset.model, derived.modelSha256);
    input(skn, derived.sknSha256);
    for (const [name, clip] of Object.entries(derived.clips)) {
      const id = `${actor}:${name}`,
        observations = proof.sequences.filter((row) => row.name === id);
      if (authoredSequenceNames.has(id) || observations.length !== 1)
        throw Error("Complete authored submesh sequence inventory required");
      authoredSequenceNames.add(id);
      const sequence = observations[0],
        events = clip.events.map(({ showMask, hideMask, ...event }) => event);
      const boundaries = [
          ...new Set([
            -2,
            -1,
            0,
            1000,
            ...events.flatMap((event) =>
              ["startFrame", "endFrame"].flatMap((key) =>
                [-0.001, 0, 0.001].map((delta) => event[key] + delta),
              ),
            ),
          ]),
        ].sort((a, b) => a - b),
        clocks = [
          ...boundaries.map((frame) => ({ frame, resync: false })),
          ...[...boundaries]
            .reverse()
            .map((frame) => ({ frame, resync: true })),
        ],
        mapping = Object.fromEntries(
          derived.ranges.map((row) => [row.name, row.mask]),
        );
      if (
        !sameDirectCompiledData(
          sequence.names,
          derived.ranges.map((row) => row.name),
        ) ||
        !sameDirectCompiledData(sequence.events, events) ||
        sequence.initial !== 0xffffffff ||
        sequence.avatar !== 0xffffffff
      )
        throw Error(
          "Selected submesh sequence does not match authored asset events",
        );
      if (
        !sameDirectCompiledData(sequence.beginning, {
          mapping,
          masks: [0xffffffff, 0xffffffff],
        }) ||
        !sameDirectCompiledData(
          sequence.frames.map(({ frame, resync }) => ({ frame, resync })),
          clocks,
        )
      )
        throw Error(
          "Selected submesh original constructor/boundary-clock inventory differs",
        );
    }
  }
  if (!sameDirectCompiledData(expected, metadata.assets))
    throw Error("Selected submesh complete asset/source inventory differs");
  const controlled = proof.sequences.filter(
    (row) =>
      !row.name.startsWith("champions/") && !row.name.startsWith("world/"),
  );
  if (
    controlled.length !== 105 ||
    (await sha256(
      new TextEncoder().encode(canonicalControlJson(controlled)),
    )) !== CONTROLLED_SEQUENCES_SHA ||
    proof.sequences.length !== authoredSequenceNames.size + controlled.length ||
    proof.counts.assets !== Object.keys(expected).length ||
    proof.counts.groups !== authoredSequenceNames.size ||
    proof.counts.ranges !==
      Object.values(expected).reduce((n, row) => n + row.ranges.length, 0) ||
    proof.counts.events !==
      Object.values(expected).reduce(
        (n, row) =>
          n +
          Object.values(row.clips).reduce(
            (m, clip) => m + clip.events.length,
            0,
          ),
        0,
      ) ||
    proof.counts.sequences !== proof.sequences.length ||
    proof.counts.frames !==
      proof.sequences.reduce((n, row) => n + row.frames.length, 0)
  )
    throw Error("Selected submesh native control/cohort inventory differs");
}
