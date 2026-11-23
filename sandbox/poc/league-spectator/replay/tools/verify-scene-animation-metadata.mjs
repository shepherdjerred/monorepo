import path from "node:path";
import { readAnimationAsset } from "../latest-animation.mjs";
import {
  assertSceneAnimationAuthorityIdentity,
  sceneAnimationFilePath,
} from "../scene-animation-authority.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
const [nativeArg, sceneArg, metadataArg, expectedSha] = process.argv.slice(2);
if (!expectedSha || !/^[a-f\d]{64}$/.test(expectedSha))
  throw Error(
    "Usage: bun verify-scene-animation-metadata.mjs <approved-native-package> <closed-scene> <metadata-package> <expected-authority-sha256>",
  );
const roots = {
    native: path.resolve(nativeArg),
    scene: path.resolve(sceneArg),
    derived: path.resolve(metadataArg),
  },
  checked = new Map();
async function raw(authority, file) {
  sceneAnimationFilePath(file);
  return await Bun.file(path.join(roots[authority], file)).bytes();
}
const authorityBytes = await raw("derived", "manifest.json");
if (sha(authorityBytes) !== expectedSha)
  throw Error("Scene authority digest differs from expected producer result");
const authority = JSON.parse(new TextDecoder().decode(authorityBytes)),
  profileBytes = await raw("native", "profile.json"),
  profile = JSON.parse(new TextDecoder().decode(profileBytes)),
  image = await raw("native", "image.bin"),
  sceneBytes = await raw("scene", "manifest.json"),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  inventory = new Map(scene.files.map((file) => [file.path, file]));
assertSceneAnimationAuthorityIdentity(authority, {
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  baseProfileSha256: sha(profileBytes),
  imageSha256: sha(image),
  sceneManifestSha256: sha(sceneBytes),
});
async function check(entry, defaultAuthority) {
  const source = entry.authority ?? defaultAuthority,
    key = `${source}:${entry.file}`;
  if (checked.has(key)) {
    const old = checked.get(key);
    if (old.sha256 !== entry.sha256 || old.bytes !== entry.bytes)
      throw Error("Contradictory dependency identity");
    return;
  }
  if (source === "scene") {
    const selected = inventory.get(entry.file);
    if (
      !selected ||
      selected.sha256 !== entry.sha256 ||
      selected.bytes !== entry.bytes
    )
      throw Error("Dependency outside exact selected scene");
  }
  const bytes = await raw(source, entry.file);
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
    throw Error(`Scene role/dependency readback differs: ${key}`);
  checked.set(key, { bytes: bytes.length, sha256: entry.sha256 });
}
for (const role of Object.values(authority.roles)) {
  await check(role, "derived");
  for (const dependency of role.dependsOn) await check(dependency);
}
const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  clock = decode(await raw("derived", authority.roles.clock.file)),
  rigs = decode(await raw("derived", authority.roles.rig.file)),
  poses = decode(await raw("derived", authority.roles.leafPoses.file)),
  events = decode(await raw("derived", authority.roles.eventInventory.file));
const expectedGraphs = authority.roles.clock.identities
  .map((identity) => identity.graph)
  .sort();
for (const data of [clock, rigs, poses])
  if (Object.keys(data.graphs).sort().join("\n") !== expectedGraphs.join("\n"))
    throw Error("Definition graph set differs from explicit role identities");
if (
  poses.kind !== "original-scene-leaf-poses" ||
  poses.animationClockSha256 !== authority.roles.clock.sha256 ||
  poses.sceneManifestSha256 !== authority.sceneManifestSha256 ||
  events.capabilities.eventSchedulingAdmitted !== false ||
  events.maps.length !== authority.roles.eventInventory.identities.length
)
  throw Error("Definition authority or capability differs");
let leaves = 0;
const parsedFiles = new Map();
for (const identity of authority.roles.clock.identities) {
  const time = clock.graphs[identity.graph],
    rig = rigs.graphs[identity.graph],
    pose = poses.graphs[identity.graph],
    catalog = decode(await raw("scene", identity.catalog));
  if (
    time.graphSha256 !== identity.graphSha256 ||
    time.catalogSha256 !== identity.catalogSha256 ||
    rig.rigSha256 !== identity.rigSha256 ||
    pose.graphSha256 !== identity.graphSha256 ||
    pose.sourceCatalogSha256 !== identity.catalogSha256 ||
    JSON.stringify(pose.catalog.joints) !== JSON.stringify(catalog.joints) ||
    JSON.stringify(rig.joints.map((joint) => joint.name)) !==
      JSON.stringify(catalog.joints)
  )
    throw Error("Clock/rig/pose source identity differs");
  if (
    Object.keys(time.clips).sort().join("\n") !==
      [...identity.leafIds].sort().join("\n") ||
    Object.keys(pose.catalog.clips).sort().join("\n") !==
      [...identity.leafIds].sort().join("\n")
  )
    throw Error("Actual leaf set differs from explicit authority");
  for (const name of identity.leafIds) {
    const clip = pose.catalog.clips[name],
      native = time.clips[name],
      file = path.posix.join(
        path.posix.dirname(authority.roles.leafPoses.file),
        pose.directory,
        clip.file,
      );
    if (!parsedFiles.has(file)) {
      const bytes = await raw("derived", file),
        parsed = readAnimationAsset(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        );
      if (sha(bytes) !== clip.sha256) throw Error("Leaf bytes differ");
      parsedFiles.set(file, {
        frames: parsed.frames,
        fps: parsed.fps,
        duration: parsed.duration,
        joints: parsed.tracks.map((track) => [track.jointId, track.bone]),
      });
    }
    const parsed = parsedFiles.get(file);
    if (
      parsed.frames !== native.clock.resourceFrames ||
      parsed.frames !== clip.frames ||
      parsed.fps !== clip.fps ||
      parsed.duration !== clip.duration ||
      parsed.joints.some(([index, bone]) => pose.catalog.joints[index] !== bone)
    )
      throw Error("Leaf frame/finiteness/rig coverage differs");
    leaves++;
  }
}
for (let index = 0; index < events.maps.length; index++) {
  const { entries, ...map } = events.maps[index],
    expected = authority.roles.eventInventory.identities[index];
  if (
    JSON.stringify({ ...map, eventIds: entries.map((entry) => entry.id) }) !==
    JSON.stringify(expected)
  )
    throw Error("Event inventory dropped or changed original row identity");
}
const preparation = decode(await raw("derived", "preparation.json"));
for (const [file, digest] of Object.entries(preparation.sources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error(`Metadata producer source readback differs: ${file}`);
console.log(
  JSON.stringify({
    authoritySha256: expectedSha,
    graphs: expectedGraphs.length,
    leafIdentities: leaves,
    uniqueLeafFiles: parsedFiles.size,
    eventMaps: events.maps.length,
    resourcesVerified: checked.size,
    approvedProfileUnchanged: true,
    approvedImageUnchanged: true,
    nativeSpectatorAdmitted: false,
  }),
);
