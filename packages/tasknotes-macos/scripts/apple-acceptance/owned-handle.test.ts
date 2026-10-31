import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { readExactHandle } from "./owned-handle.ts";

test("measured handle reads remain bounded and reject truncated extents", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "facet-owned-handle-"),
  );
  const file = path.join(directory, "synthetic.bin");
  await writeFile(file, new Uint8Array([0, 255, 10]));
  const handle = await open(file, "r");
  try {
    expect(await readExactHandle(handle, 3, 3)).toEqual(
      new Uint8Array([0, 255, 10]),
    );
    expect(await readExactHandle(handle, 0, 3)).toEqual(new Uint8Array());
    await expect(readExactHandle(handle, 4, 4)).rejects.toThrow("truncated");
    await expect(readExactHandle(handle, 4, 3)).rejects.toThrow();
    await expect(readExactHandle(handle, -1, 3)).rejects.toThrow();
  } finally {
    await handle.close();
    await rm(directory, { recursive: true });
  }
});
