import { expect, test } from "bun:test";
import {
  validateSceneAnimationAuthority,
  assertSceneAnimationAuthorityIdentity,
  sceneAnimationFilePath,
} from "./scene-animation-authority.mjs";
const hash = "a".repeat(64);
function fixture() {
  const role = (file) => ({
    file,
    bytes: 1,
    sha256: hash,
    dependsOn: [
      { authority: "scene", file: "graph.json", bytes: 1, sha256: hash },
      { authority: "scene", file: "catalog.json", bytes: 1, sha256: hash },
      { authority: "scene", file: "model.skl", bytes: 1, sha256: hash },
    ],
    identities: [
      {
        actor: "champions/test/0",
        graph: "graph.json",
        graphSha256: hash,
        catalog: "catalog.json",
        catalogSha256: hash,
        rig: "model.skl",
        rigSha256: hash,
        leafIds: ["{actual}"],
      },
    ],
  });
  return {
    schema: 1,
    kind: "scene-animation-authority",
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    baseProfileSha256: hash,
    imageSha256: hash,
    sceneManifestSha256: hash,
    roles: {
      clock: role("clock.json"),
      rig: role("rig.json"),
      eventInventory: { ...role("events.json"), identities: [] },
      leafPoses: role("poses/manifest.json"),
    },
    capabilities: {
      dynamicStateProgram: "unadmitted",
      eventScheduling: "unsupported-matching-effects-required",
    },
    nativeSpectatorAdmitted: false,
  };
}
test("new scenes require all matching scene roles and retain original image/profile identity", () => {
  const authority = fixture();
  expect(validateSceneAnimationAuthority(authority)).toBe(authority);
  expect(assertSceneAnimationAuthorityIdentity(authority, authority)).toBe(
    authority,
  );
  expect(() =>
    assertSceneAnimationAuthorityIdentity(authority, {
      ...authority,
      sceneManifestSha256: "b".repeat(64),
    }),
  ).toThrow("sceneManifestSha256");
  delete authority.roles.clock;
  expect(() => validateSceneAnimationAuthority(authority)).toThrow();
});
test("scene role resources reject traversal, malformed digests and invented admission", () => {
  for (const path of [
    "../clock.json",
    "/clock.json",
    "a//clock.json",
    "a/./clock.json",
    "a/%2e%2e/clock.json",
    "a\\clock.json",
  ])
    expect(() => sceneAnimationFilePath(path)).toThrow();
  const authority = fixture();
  authority.roles.rig.sha256 = "partial";
  expect(() => validateSceneAnimationAuthority(authority)).toThrow();
  authority.roles.rig.sha256 = hash;
  authority.nativeSpectatorAdmitted = true;
  expect(() => validateSceneAnimationAuthority(authority)).toThrow();
});

test("identities require selected dependencies, unique leaves/graphs and equal clock/rig/pose sets", () => {
  const duplicateLeaf = fixture();
  duplicateLeaf.roles.clock.identities[0].leafIds.push("{actual}");
  expect(() => validateSceneAnimationAuthority(duplicateLeaf)).toThrow(
    "Duplicate",
  );
  const duplicateDependency = fixture();
  duplicateDependency.roles.rig.dependsOn.push(
    duplicateDependency.roles.rig.dependsOn[0],
  );
  expect(() => validateSceneAnimationAuthority(duplicateDependency)).toThrow(
    "Duplicate",
  );
  const absentDependency = fixture();
  absentDependency.roles.clock.identities[0].graphSha256 = "b".repeat(64);
  expect(() => validateSceneAnimationAuthority(absentDependency)).toThrow(
    "selected scene dependency",
  );
  const mismatchedSet = fixture();
  mismatchedSet.roles.rig.identities[0].leafIds = ["{other}"];
  expect(() => validateSceneAnimationAuthority(mismatchedSet)).toThrow(
    "identities differ",
  );
  const extra = fixture();
  extra.roles.clock.identities[0].fakeProgram = true;
  expect(() => validateSceneAnimationAuthority(extra)).toThrow("fields");
});
