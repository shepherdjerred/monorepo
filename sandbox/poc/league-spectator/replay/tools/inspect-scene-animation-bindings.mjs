import path from "node:path";
import { createSceneAnimationBindings } from "../scene-animation-bindings.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
const [nativeArg, sceneArg, derivedArg, expectedSha] = process.argv.slice(2);
if (!expectedSha)
  throw Error(
    "Usage: bun inspect-scene-animation-bindings.mjs <approved-native-package> <closed-scene> <derived-authority> <expected-authority-sha256>",
  );
const roots = {
  native: path.resolve(nativeArg),
  scene: path.resolve(sceneArg),
  derived: path.resolve(derivedArg),
};
const raw = async (authority, file) =>
  await Bun.file(path.join(roots[authority], file)).bytes();
const inputs = {
  baseProfileBytes: await raw("native", "profile.json"),
  imageBytes: await raw("native", "image.bin"),
  sceneBytes: await raw("scene", "manifest.json"),
  authorityBytes: await raw("derived", "manifest.json"),
  readResource: ({ authority, file }) => raw(authority, file),
};
if (sha(inputs.authorityBytes) !== expectedSha)
  throw Error("Expected scene authority digest differs");
const baseline = sha(inputs.baseProfileBytes),
  bindings = await createSceneAnimationBindings(inputs);
let graphs = 0,
  leaves = 0,
  files = 0,
  rigNames = 0,
  isolatedCatalogs = 0;
for (const identity of bindings.authority.roles.clock.identities) {
  const bound = await bindings.bind({ graphFile: identity.graph }),
    seen = new Set();
  for (const name of identity.leafIds) {
    const sample = bound.clock.evaluate(name, 0);
    if (!Number.isFinite(sample.duration) || !Number.isFinite(sample.poseTime))
      throw Error("Nonfinite bound native clock");
    const clip = bound.catalog.clips[name];
    if (!seen.has(clip.file)) {
      await bound.readLeaf(clip.file);
      seen.add(clip.file);
      files++;
    }
    leaves++;
  }
  for (const name of new Set(bound.catalog.joints)) {
    if (bound.rigBindings.resolve(name).status !== "rig-joint")
      throw Error("Original constructed rig name failed to resolve");
    rigNames++;
  }
  const first = Object.values(bound.catalog.clips)[0],
    firstFile = first.file;
  first.frames = -1;
  bound.catalog.joints.fill("caller-owned-annotation");
  await bound.readLeaf(firstFile);
  isolatedCatalogs++;
  graphs++;
}
if (
  sha(inputs.baseProfileBytes) !== baseline ||
  sha(await raw("native", "profile.json")) !== baseline
)
  throw Error("Adapter mutated approved profile");
let rejected = 0;
for (const change of [
  (value) => (value.sceneBytes = new TextEncoder().encode("{}")),
  (value) =>
    (value.authorityBytes = new TextEncoder().encode(
      JSON.stringify({
        ...bindings.authority,
        sceneManifestSha256: "b".repeat(64),
      }),
    )),
  (value) =>
    (value.readResource = async (request) =>
      request.authority === "derived" &&
      request.file === bindings.authority.roles.clock.file
        ? new Uint8Array([0])
        : raw(request.authority, request.file)),
]) {
  const attempt = { ...inputs };
  change(attempt);
  try {
    await createSceneAnimationBindings(attempt);
  } catch {
    rejected++;
  }
}
if (rejected !== 3)
  throw Error("Adapter accepted a mismatched scene/authority/role");
console.log(
  JSON.stringify({
    graphs,
    leafIdentities: leaves,
    leafFiles: files,
    rigNames,
    isolatedCatalogs,
    rejectedMismatches: rejected,
    profileUnchanged: true,
    selectedDynamicState: false,
    nativeSpectatorAdmitted: false,
  }),
);
