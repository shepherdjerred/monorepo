import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { localFileCount } from "./dev-lake-pull.ts";

describe("dev lake pull", () => {
  test("counts directory trees, lone files, and missing paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lake-pull-count-"));
    const table = path.join(root, "matches");
    await mkdir(path.join(table, "month=2026-08"), { recursive: true });
    await writeFile(path.join(table, "month=2026-08", "data_0.parquet"), "a");
    await writeFile(path.join(table, "month=2026-08", "data_1.parquet"), "b");
    const manifest = path.join(root, "manifest.json");
    await writeFile(manifest, "{}");
    expect(await localFileCount(table)).toBe(2);
    expect(await localFileCount(manifest)).toBe(1);
    expect(await localFileCount(path.join(root, "missing"))).toBe(0);
  });
});
