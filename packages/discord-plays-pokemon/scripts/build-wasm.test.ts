import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parsePokemonUpstream } from "./lib/upstream.ts";
import { writeWasmArtifact } from "./lib/wasm-artifact.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

test("requires an immutable upstream commit", () => {
  expect(() =>
    parsePokemonUpstream({
      repository: "https://example.com",
      branch: "main",
      commit: "main",
    }),
  ).toThrow("Invalid");
});

test("accepts a complete immutable upstream pin", () => {
  const upstream = {
    repository: "https://example.com/pokeemerald.git",
    branch: "master",
    commit: "0123456789abcdef0123456789abcdef01234567",
  };
  expect(parsePokemonUpstream(upstream)).toEqual(upstream);
});

test("creates the ignored WASM asset directory before writing", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "pokemon-wasm-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  const source = `${temporaryDirectory}/pokeemerald.wasm`;
  const output = `${temporaryDirectory}/packages/backend/assets/pokeemerald.wasm`;
  await Bun.write(source, "wasm artifact");

  await writeWasmArtifact(source, output);

  expect(await Bun.file(output).text()).toBe("wasm artifact");
});

test("keeps the observation bridge closing brace inside its new-file hunk", async () => {
  const patch = await Bun.file(
    `${import.meta.dir}/../wasm-src/patches/0001-extra-exports.patch`,
  ).text();

  expect(patch).toContain("@@ -0,0 +1,595 @@");
  expect(patch.trimEnd().endsWith("+}")).toBe(true);
});
