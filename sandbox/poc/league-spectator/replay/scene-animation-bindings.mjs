import { sha256 } from "./structural-comparison.mjs";
import {
  assertSceneAnimationAuthorityIdentity,
  sceneAnimationFilePath,
} from "./scene-animation-authority.mjs";
import { createSceneAnimationPoses } from "./latest-animation-poses.mjs";
import { createSceneAnimationRigBindings } from "./latest-animation-rigs.mjs";
import { readAnimationAsset } from "./latest-animation.mjs";

const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
// Explicit scene authority, independent of the preserved legacy hashes in the
// approved profile. No selected animation state or controller is supplied here.
export async function createSceneAnimationBindings({
  baseProfileBytes,
  imageBytes,
  sceneBytes,
  authorityBytes,
  readResource,
  signal,
}) {
  for (const bytes of [
    baseProfileBytes,
    imageBytes,
    sceneBytes,
    authorityBytes,
  ])
    if (!(bytes instanceof Uint8Array))
      throw Error("Owned scene animation authority bytes required");
  if (typeof readResource !== "function")
    throw Error("Explicit scene animation resource reader required");
  function active() {
    if (signal?.aborted)
      throw signal.reason ?? Error("Scene animation binding aborted");
  }
  active();
  const profile = decode(baseProfileBytes),
    scene = decode(sceneBytes),
    authority = decode(authorityBytes);
  assertSceneAnimationAuthorityIdentity(authority, {
    build: profile.clientVersion,
    protocol: profile.protocolDigest,
    baseProfileSha256: await sha256(baseProfileBytes),
    imageSha256: await sha256(imageBytes),
    sceneManifestSha256: await sha256(sceneBytes),
  });
  if (
    authority.imageSha256 !== profile.decoderImageSha256 ||
    scene.kind !== "archived-map11-common-runtime-scene" ||
    scene.schema !== 1 ||
    scene.map?.id !== 11 ||
    scene.build !== authority.build ||
    scene.protocol !== authority.protocol ||
    !Array.isArray(scene.files)
  )
    throw Error("Unsupported exact scene animation authority");
  const descriptors = new Map(),
    selected = new Map();
  for (const file of scene.files) {
    sceneAnimationFilePath(file.path);
    if (selected.has(file.path))
      throw Error("Duplicate selected scene resource");
    selected.set(file.path, file);
  }
  function register(origin, entry) {
    sceneAnimationFilePath(entry.file);
    const key = `${origin}:${entry.file}`,
      old = descriptors.get(key);
    if (old && (old.sha256 !== entry.sha256 || old.bytes !== entry.bytes))
      throw Error("Contradictory scene animation dependency");
    if (origin === "scene") {
      const source = selected.get(entry.file);
      if (
        !source ||
        source.sha256 !== entry.sha256 ||
        source.bytes !== entry.bytes
      )
        throw Error(
          "Animation role dependency differs from selected static scene",
        );
    }
    descriptors.set(key, { authority: origin, ...entry });
  }
  for (const role of Object.values(authority.roles)) {
    register("derived", role);
    for (const dependency of role.dependsOn)
      register(dependency.authority, dependency);
  }
  for (const [file, bytes] of [
    ["profile.json", baseProfileBytes],
    ["image.bin", imageBytes],
  ]) {
    const entry = descriptors.get(`native:${file}`);
    if (
      !entry ||
      entry.bytes !== bytes.length ||
      entry.sha256 !== (await sha256(bytes))
    )
      throw Error("Original native authority dependency differs");
  }
  async function read(origin, file, provided) {
    active();
    sceneAnimationFilePath(file);
    const entry = descriptors.get(`${origin}:${file}`);
    if (!entry)
      throw Error(`Unselected scene animation resource: ${origin}:${file}`);
    const bytes =
      provided ?? (await readResource({ authority: origin, file, signal }));
    active();
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length !== entry.bytes ||
      (await sha256(bytes)) !== entry.sha256
    )
      throw Error(
        `Scene animation resource integrity mismatch: ${origin}:${file}`,
      );
    return bytes;
  }
  const clockBytes = await read("derived", authority.roles.clock.file),
    rigBytes = await read("derived", authority.roles.rig.file),
    poseBytes = await read("derived", authority.roles.leafPoses.file),
    eventBytes = await read("derived", authority.roles.eventInventory.file);
  const clockDefinition = decode(clockBytes),
    rigDefinition = decode(rigBytes),
    poseDefinition = decode(poseBytes),
    eventInventory = decode(eventBytes),
    expectedGraphs = authority.roles.clock.identities
      .map((identity) => identity.graph)
      .sort();
  for (const definition of [clockDefinition, rigDefinition, poseDefinition])
    if (
      Object.keys(definition.graphs).sort().join("\n") !==
      expectedGraphs.join("\n")
    )
      throw Error("Derived graph identities differ from scene roles");
  if (
    eventInventory.kind !== "original-scene-animation-event-inventory" ||
    eventInventory.capabilities?.eventSchedulingAdmitted !== false ||
    eventInventory.capabilities?.effectBindingsAdmitted !== false ||
    eventInventory.maps.length !==
      authority.roles.eventInventory.identities.length
  )
    throw Error("Unsupported scene event inventory capability");
  for (let index = 0; index < eventInventory.maps.length; index++) {
    const { entries, ...map } = eventInventory.maps[index],
      identity = { ...map, eventIds: entries.map((entry) => entry.id) };
    if (
      JSON.stringify(identity) !==
      JSON.stringify(authority.roles.eventInventory.identities[index])
    )
      throw Error("Scene event inventory changed original row identities");
  }
  // Original instruction identities are verified against the unchanged image,
  // rather than trusting a definition's self-reported range/hash labels.
  for (const definition of [clockDefinition, rigDefinition])
    for (const block of definition.sourceBlocks ?? []) {
      if (
        !Number.isSafeInteger(block.startRva) ||
        !Number.isSafeInteger(block.endRva) ||
        block.startRva < 0 ||
        block.endRva <= block.startRva ||
        block.endRva > imageBytes.length ||
        (await sha256(imageBytes.subarray(block.startRva, block.endRva))) !==
          block.sha256
      )
        throw Error("Scene animation original instruction identity differs");
    }
  const poses = await createSceneAnimationPoses(
      profile,
      clockBytes,
      poseBytes,
      authority,
    ),
    rigs = await createSceneAnimationRigBindings(profile, rigBytes, authority),
    identities = new Map(
      authority.roles.clock.identities.map((identity) => [
        identity.graph,
        identity,
      ]),
    );
  active();
  return {
    authority: structuredClone(authority),
    eventInventory: structuredClone(eventInventory),
    async bind({ graphFile, graphBytes, catalogBytes, rigBytes: providedRig }) {
      active();
      const identity = identities.get(graphFile);
      if (!identity)
        throw Error(
          `Animation graph is outside explicit scene authority: ${graphFile}`,
        );
      const graph = await read("scene", graphFile, graphBytes),
        catalog = await read("scene", identity.catalog, catalogBytes),
        rig = await read("scene", identity.rig, providedRig);
      const bound = await poses.bind(graphFile, graph, catalog),
        rigBindings = await rigs.bind(graphFile, rig, catalog),
        leafRoot = authority.roles.leafPoses.file.slice(
          0,
          authority.roles.leafPoses.file.lastIndexOf("/") + 1,
        );
      if (
        Object.keys(bound.catalog.clips).sort().join("\n") !==
        [...identity.leafIds].sort().join("\n")
      )
        throw Error("Bound original leaf identities differ");
      active();
      return {
        clock: bound.clock,
        // Resource validation keeps its own catalog. A consumer may annotate
        // its returned view without changing the authority used by readLeaf.
        catalog: structuredClone(bound.catalog),
        directory: bound.directory,
        rigBindings,
        expectedFileHash: bound.expectedFileHash,
        async readLeaf(file) {
          if (!/^clips\/\d+\.clip$/.test(file))
            throw Error("Explicit numeric leaf resource identity required");
          const expected = bound.expectedFileHash(file),
            relative = `${leafRoot}${bound.directory}/${file}`,
            bytes = await read("derived", relative);
          if ((await sha256(bytes)) !== expected)
            throw Error("Leaf pose differs from bound graph");
          const parsed = readAnimationAsset(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
          );
          const clips = Object.values(bound.catalog.clips).filter(
            (clip) => clip.file === file,
          );
          if (
            !clips.length ||
            clips.some(
              (clip) =>
                clip.frames !== parsed.frames ||
                clip.fps !== parsed.fps ||
                clip.duration !== parsed.duration,
            ) ||
            parsed.tracks.some(
              (track) => bound.catalog.joints[track.jointId] !== track.bone,
            )
          )
            throw Error("Leaf frame or constructed rig coverage differs");
          return bytes;
        },
      };
    },
  };
}
