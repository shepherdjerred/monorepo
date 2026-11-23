import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  realpath,
  readdir,
  rm,
  symlink,
  unlink,
  rmdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createMapSceneOutput } from "./map-scene-output.mjs";

test("rejects canonical cache overlap and isolates each preparation attempt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "scout-map-output-"));
  const source = path.join(root, "source"),
    cache = path.join(root, "output"),
    alias = path.join(root, "source-alias");
  await mkdir(source);
  let linked = false;
  try {
    await expect(
      createMapSceneOutput(source, path.join(source, "child")),
    ).rejects.toThrow("canonically disjoint");
    await expect(createMapSceneOutput(source, root)).rejects.toThrow(
      "canonically disjoint",
    );
    await symlink(
      source,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    linked = true;
    await expect(createMapSceneOutput(source, alias)).rejects.toThrow(
      "canonically disjoint",
    );
    await expect(
      createMapSceneOutput(source, path.join(alias, "missing-child")),
    ).rejects.toThrow("canonically disjoint");
    const first = await createMapSceneOutput(source, cache);
    await writeFile(path.join(first.out, "old-texture.png"), "old");
    await writeFile(path.join(first.out, "manifest.json"), "previous");
    const second = await createMapSceneOutput(source, cache);
    expect(second.out).not.toBe(first.out);
    expect(await readdir(second.out)).toEqual([]);
    expect(await readdir(source)).toEqual([]);
  } finally {
    if (linked) {
      if (process.platform === "win32") await rmdir(alias);
      else await unlink(alias);
    }
    const target = await realpath(root),
      parent = await realpath(tmpdir());
    if (
      path.dirname(target) !== parent ||
      !path.basename(target).startsWith("scout-map-output-")
    )
      throw Error("Refusing cleanup outside the owned temporary fixture");
    await rm(target, { recursive: true, force: true });
  }
});
