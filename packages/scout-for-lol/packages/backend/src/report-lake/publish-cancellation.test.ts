import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { publishBuild } from "#src/report-lake/paths.ts";

test("a canceled attempt cannot replace the last published lake", async () => {
  const lakeDir = await mkdtemp(path.join(tmpdir(), "lake-publish-cancel-"));
  try {
    await mkdir(path.join(lakeDir, "builds", "accepted"), { recursive: true });
    await publishBuild(lakeDir, "accepted");
    const signal = AbortSignal.abort(new Error("stale attempt"));
    await expect(publishBuild(lakeDir, "stale", signal)).rejects.toThrow(
      "stale attempt",
    );
    expect(await readFile(path.join(lakeDir, "CURRENT"), "utf8")).toBe(
      "accepted\n",
    );
  } finally {
    await rm(lakeDir, { recursive: true, force: true });
  }
});

test("cancellation during pointer staging prevents publication and removes the staged pointer", async () => {
  const lakeDir = await mkdtemp(path.join(tmpdir(), "lake-publish-race-"));
  const controller = new AbortController();
  const write = Bun.write.bind(Bun);
  try {
    await publishBuild(lakeDir, "accepted");
    vi.spyOn(Bun, "write").mockImplementation(async (...args) => {
      const result = await write(...args);
      controller.abort(new Error("attempt canceled during staging"));
      return result;
    });
    await expect(
      publishBuild(lakeDir, "stale", controller.signal),
    ).rejects.toThrow("attempt canceled during staging");
    expect(await readFile(path.join(lakeDir, "CURRENT"), "utf8")).toBe(
      "accepted\n",
    );
    expect(
      await Bun.file(path.join(lakeDir, "CURRENT.stale.tmp")).exists(),
    ).toBe(false);
  } finally {
    vi.restoreAllMocks();
    await rm(lakeDir, { recursive: true, force: true });
  }
});
