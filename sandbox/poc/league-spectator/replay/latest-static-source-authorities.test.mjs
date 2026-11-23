import { expect, test } from "bun:test";
import { assertSelectedStaticSourceAuthorities } from "./latest-static-source-authorities.mjs";
import { validateSelectedStaticSourcePlan } from "./tools/selected-static-sources.mjs";

const hash = "1".repeat(64),
  image = "2".repeat(64);
const entry = (authority, file, sha256 = hash) => ({
  sha256,
  bytes: 10,
  source: { authority, file },
});
function fixture() {
  return {
    decoderImageSha256: image,
    sourceAuthorities: {
      build: {
        kind: "approved-exact-build-public",
        identity: {
          file: "decoder-16.21-macos/profile.json",
          sha256: hash,
          bytes: 10,
        },
      },
      scene: {
        kind: "prepared-scene-public",
        identity: {
          file: "latest-scene/manifest.json",
          sha256: hash,
          bytes: 10,
        },
      },
      animation: {
        kind: "prepared-scene-animation",
        identity: { file: "manifest.json", sha256: hash, bytes: 10 },
      },
    },
    roles: {
      scene: "latest-scene/manifest.json",
      sceneAnimationAuthority: "scene-animation/manifest.json",
      sceneAnimationClock: "scene-animation/clock.json",
      sceneAnimationRig: "scene-animation/rig.json",
      sceneAnimationEventInventory: "scene-animation/events.json",
      sceneAnimationLeafPoses: "scene-animation/leaves.json",
    },
    files: {
      "decoder-16.21-macos/image.bin": entry(
        "build",
        "decoder-16.21-macos/image.bin",
        image,
      ),
      "latest-scene/manifest.json": entry(
        "scene",
        "latest-scene/manifest.json",
      ),
      "scene-animation/manifest.json": entry("animation", "manifest.json"),
      "scene-animation/clock.json": entry("animation", "clock.json"),
      "scene-animation/rig.json": entry("animation", "rig.json"),
      "scene-animation/events.json": entry("animation", "events.json"),
      "scene-animation/leaves.json": entry("animation", "leaves.json"),
    },
  };
}
test("binds every selected file and scene role to explicit logical authorities", () => {
  expect(() =>
    assertSelectedStaticSourceAuthorities(fixture(), hash),
  ).not.toThrow();
});
test("same digest cannot reassign scene metadata or native image to another authority", () => {
  for (const file of [
    "latest-scene/manifest.json",
    "decoder-16.21-macos/image.bin",
    "scene-animation/clock.json",
  ]) {
    const value = fixture();
    value.files[file].source.authority = "build";
    if (file.includes("image.bin"))
      value.files[file].source.authority = "scene";
    expect(() => assertSelectedStaticSourceAuthorities(value, hash)).toThrow();
  }
});
test("cannot rebind immutable profile or reuse historical scene animation metadata", () => {
  expect(() =>
    assertSelectedStaticSourceAuthorities(fixture(), "3".repeat(64)),
  ).toThrow("immutable bootstrap profile");
  for (const file of [
    "animation-clock.json",
    "animation-rigs.json",
    "animation-events.json",
    "animation-poses.json",
  ]) {
    const value = fixture();
    value.files["decoder-16.21-macos/" + file] = entry(
      "build",
      "decoder-16.21-macos/" + file,
    );
    expect(() => assertSelectedStaticSourceAuthorities(value, hash)).toThrow(
      "historical decoder metadata",
    );
  }
});
test("source files and source kinds remain canonical and reject undeclared identities", () => {
  for (const mutate of [
    (value) => {
      value.files["scene-animation/clock.json"].source.file = "../clock.json";
    },
    (value) => {
      value.sourceAuthorities.scene.kind = "approved-exact-build-public";
    },
    (value) => {
      value.files["scene-animation/clock.json"].source.authority = "missing";
    },
    (value) => {
      delete value.files["scene-animation/clock.json"].source;
    },
  ]) {
    const value = fixture();
    mutate(value);
    expect(() => assertSelectedStaticSourceAuthorities(value, hash)).toThrow();
  }
});

test("composed package identities have a shared bounded32MiB quota while native identities retain16MiB", () => {
  const value = fixture(),
    limit = 32 * 1024 * 1024;
  value.sourceAuthorities.material = {
    kind: "prepared-scene-package",
    identity: { file: "manifest.json", bytes: limit, sha256: hash },
  };
  value.files["scene-materials/manifest.json"] = {
    ...entry("material", "manifest.json"),
    bytes: limit,
  };
  value.files["decoder-16.21-macos/profile.json"] = entry(
    "build",
    "decoder-16.21-macos/profile.json",
  );
  const plan = () => ({
    schema: 1,
    kind: "selected-static-source-plan",
    sources: value.sourceAuthorities,
    files: value.files,
  });
  expect(() =>
    assertSelectedStaticSourceAuthorities(value, hash),
  ).not.toThrow();
  expect(() => validateSelectedStaticSourcePlan(plan())).not.toThrow();
  value.sourceAuthorities.material.identity.bytes++;
  expect(() => assertSelectedStaticSourceAuthorities(value, hash)).toThrow(
    "identity",
  );
  expect(() => validateSelectedStaticSourcePlan(plan())).toThrow("identity");
  value.sourceAuthorities.material.identity.bytes = limit;
  for (const authority of ["build", "scene", "animation"]) {
    const identity = value.sourceAuthorities[authority].identity,
      bytes = identity.bytes;
    identity.bytes = 16 * 1024 * 1024 + 1;
    expect(() => assertSelectedStaticSourceAuthorities(value, hash)).toThrow(
      "identity",
    );
    expect(() => validateSelectedStaticSourcePlan(plan())).toThrow("identity");
    identity.bytes = bytes;
  }
});
