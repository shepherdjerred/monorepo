import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  createSelectedStaticSourceReader,
  publishSelectedStaticSources,
} from "./selected-static-sources.mjs";

const temporary = [];
afterEach(async () => {
  for (const root of temporary.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "selected-source-test-"));
  temporary.push(root);
  const roots = {
    build: path.join(root, "build"),
    scene: path.join(root, "scene"),
    animation: path.join(root, "animation"),
  };
  const names = {
    build: "profile.json",
    scene: "manifest.json",
    animation: "manifest.json",
  };
  const kinds = {
    build: "approved-exact-build-public",
    scene: "prepared-scene-public",
    animation: "prepared-scene-animation",
  };
  const plan = {
    schema: 1,
    kind: "selected-static-source-plan",
    sources: {},
    files: {},
  };
  for (const [authority, directory] of Object.entries(roots)) {
    await mkdir(directory);
    const bytes = new TextEncoder().encode(JSON.stringify({ authority }));
    await Bun.write(path.join(directory, names[authority]), bytes);
    const identity = {
      file: names[authority],
      sha256: await sha256(bytes),
      bytes: bytes.length,
    };
    plan.sources[authority] = { kind: kinds[authority], identity };
    const target = authority + "/" + names[authority];
    plan.files[target] = {
      source: { authority, file: identity.file },
      sha256: identity.sha256,
      bytes: identity.bytes,
    };
  }
  return { root, roots, plan };
}

test("publishes only explicit closed files and preserves logical source provenance", async () => {
  const input = await fixture();
  await Bun.write(
    path.join(input.roots.build, "unrelated-old-animation.json"),
    "not selected",
  );
  const result = await publishSelectedStaticSources({
    ...input,
    outputCache: path.join(input.root, "output"),
  });
  expect(result.receipt.files).toEqual(input.plan.files);
  expect(result.receipt.nativeSpectatorAdmitted).toBe(false);
  expect(
    await Bun.file(
      path.join(result.publicRoot, "unrelated-old-animation.json"),
    ).exists(),
  ).toBe(false);
  for (const [target, ref] of Object.entries(input.plan.files))
    expect(
      await sha256(
        await Bun.file(path.join(result.publicRoot, target)).bytes(),
      ),
    ).toBe(ref.sha256);
});

test("publishes long Windows target paths with exact bytes and unchanged logical identities", async () => {
  const input = await fixture(),
    target = `textures/rgba-${"a".repeat(128)}.bin`,
    original = input.plan.files["scene/manifest.json"];
  input.plan.files[target] = structuredClone(original);
  const result = await publishSelectedStaticSources({
    ...input,
    outputCache: path.join(
      input.root,
      "o".repeat(Math.max(4, 190 - input.root.length)),
    ),
  });
  const destination = path.join(result.publicRoot, target);
  expect(destination.length).toBeGreaterThan(260);
  expect(await sha256(await Bun.file(destination).bytes())).toBe(
    original.sha256,
  );
  expect(result.receipt.files[target]).toEqual(original);
  expect(result.receipt.nativeSpectatorAdmitted).toBe(false);
});

test("no fallback between authorities when same-named files differ or are absent", async () => {
  const input = await fixture();
  input.plan.files["wrong.json"] = {
    ...input.plan.files["scene/manifest.json"],
    source: { authority: "build", file: "manifest.json" },
  };
  const reader = await createSelectedStaticSourceReader(input);
  await expect(reader.read("wrong.json")).rejects.toThrow();
  await expect(reader.read("not-declared.json")).rejects.toThrow(
    "outside selected source plan",
  );
  await Bun.write(
    path.join(input.roots.build, "manifest.json"),
    new Uint8Array(input.plan.files["wrong.json"].bytes).fill(65),
  );
  await expect(reader.read("wrong.json")).rejects.toThrow("bytes differ");
});

test("source mutation invalidates completion, including same-length changes", async () => {
  const input = await fixture();
  const reader = await createSelectedStaticSourceReader(input);
  await reader.read("build/profile.json");
  const profile = path.join(input.roots.build, "profile.json");
  const bytes = await Bun.file(profile).bytes();
  bytes[0] ^= 1;
  await Bun.write(profile, bytes);
  await expect(reader.verifyUnchanged()).rejects.toThrow(
    "changed during preparation",
  );
});

test("caller mutations cannot expand the reader inventory or rewrite source identities", async () => {
  const input = await fixture();
  const reader = await createSelectedStaticSourceReader(input);
  const expected = structuredClone(input.plan);
  input.plan.files["injected.json"] = input.plan.files["build/profile.json"];
  input.plan.files["build/profile.json"].source.authority = "scene";
  input.plan.sources.build.identity.sha256 = "f".repeat(64);
  input.roots.build = input.roots.scene;
  await expect(reader.read("injected.json")).rejects.toThrow(
    "outside selected source plan",
  );
  expect(await sha256(await reader.read("build/profile.json"))).toBe(
    expected.files["build/profile.json"].sha256,
  );
  const description = reader.describe();
  description.files["build/profile.json"].source.authority = "scene";
  expect(reader.describe()).toEqual({
    sources: expected.sources,
    files: expected.files,
  });
});

test("rejects output nested inside every source authority before creating a run", async () => {
  const input = await fixture();
  await expect(
    publishSelectedStaticSources({
      ...input,
      outputCache: path.join(input.roots.scene, "nested"),
    }),
  ).rejects.toThrow("canonically disjoint");
});

test("cannot stage a preexisting bootstrap or alias one output path by case", async () => {
  for (const name of [
    "latest-static-catalog/bootstrap.json",
    "latest-static-catalog/catalog.json",
    "latest-static-sources.json",
    "BUILD/PROFILE.JSON",
  ]) {
    const input = await fixture();
    input.plan.files[name] = input.plan.files["build/profile.json"];
    await expect(createSelectedStaticSourceReader(input)).rejects.toThrow();
  }
});

test("rejects a declared file replaced by a symlink to another authority", async () => {
  const input = await fixture();
  const target = path.join(input.roots.scene, "manifest.json");
  await rm(target);
  await symlink(path.join(input.roots.animation, "manifest.json"), target);
  await expect(createSelectedStaticSourceReader(input)).rejects.toThrow(
    "cannot follow links",
  );
});
