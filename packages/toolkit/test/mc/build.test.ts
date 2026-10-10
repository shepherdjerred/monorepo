import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { readOpLog } from "@shepherdjerred/mc-harness/protocol/build.ts";
import { withRecordedBuild } from "#lib/mc/build.ts";

const temp = await mkdtemp(path.join(os.tmpdir(), "toolkit-mc-build-"));
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

const entry = path.resolve(import.meta.dirname, "../../src/index.ts");

describe("toolkit mc build", () => {
  test("delegates to the mc-harness build CLI", async () => {
    const child = Bun.spawn(
      [process.execPath, "run", entry, "mc", "build", "help"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...Bun.env, HOME: "/nonexistent-toolkit-mc-test" },
      },
    );
    const [stdout, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "toolkit mc build — WorldEdit-first build workflow",
    );
    expect(stdout).toContain(
      "promote <dir> --target <id> [--confirm <planHash>]",
    );
  });

  test("records ops and content-addresses pasted schematics", async () => {
    const dir = path.join(temp, "b");
    await Bun.write(
      path.join(dir, "build.json"),
      JSON.stringify({
        version: 1,
        name: "b",
        world: "world",
        anchor: { x: 0, y: 0, z: 0 },
        seed: 1,
      }),
    );
    await withRecordedBuild(dir, async (record) => {
      if (record === null) throw new Error("missing recorder");
      await record.append({
        kind: "we",
        world: "world",
        command: "//set stone",
        source: "manual",
      });
      const bytes = new Uint8Array([1, 2, 3]);
      const stored = await record.schematic(bytes);
      expect(stored).toMatch(/^schematics\/manual-[0-9a-f]{12}\.schem$/u);
      expect(await record.schematic(bytes)).toBe(stored);
      expect(
        new Uint8Array(await Bun.file(path.join(dir, stored)).arrayBuffer()),
      ).toEqual(new Uint8Array([1, 2, 3]));
      const log = await readOpLog(dir);
      expect(log.ops).toHaveLength(1);
    });
  });

  test("refuses to record into a non-build directory", async () => {
    await expect(
      withRecordedBuild(path.join(temp, "missing"), () => Promise.resolve()),
    ).rejects.toThrow(/not a build directory/u);
  });
});
