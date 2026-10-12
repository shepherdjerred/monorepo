import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFileAtomic } from "@shepherdjerred/discord-stream-lifecycle/persistence/atomic-write";

describe("writeFileAtomic", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "dsl-atomic-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates and replaces the target without leaving temp files", async () => {
    const target = path.join(dir, "game.sav");
    await writeFileAtomic(target, new Uint8Array([1, 2, 3]));
    await writeFileAtomic(target, "second");

    expect(await readFile(target, "utf8")).toBe("second");
    expect(await readdir(dir)).toEqual(["game.sav"]);
  });

  it("cleans up and leaves the existing target when the rename fails", async () => {
    // Renaming a file over a non-empty directory fails after the temp file is
    // fully written, exercising the cleanup path.
    const target = path.join(dir, "slot");
    await mkdir(target);
    await writeFile(path.join(target, "inner.sav"), "previous save");

    await expect(writeFileAtomic(target, "replacement")).rejects.toThrow();

    expect(await readFile(path.join(target, "inner.sav"), "utf8")).toBe(
      "previous save",
    );
    expect(await readdir(dir)).toEqual(["slot"]);
  });

  it("serializes concurrent writers to complete files", async () => {
    const target = path.join(dir, "game.sav");
    const payloads = Array.from({ length: 8 }, (_, i) =>
      String(i).repeat(64 * 1024),
    );
    await Promise.all(payloads.map((p) => writeFileAtomic(target, p)));

    expect(payloads).toContain(await readFile(target, "utf8"));
    expect(await readdir(dir)).toEqual(["game.sav"]);
  });
});
