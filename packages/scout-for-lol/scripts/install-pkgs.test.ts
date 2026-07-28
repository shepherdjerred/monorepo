import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { filesEqual } from "./migration-core.ts";

test("compares generated schemas byte-for-byte", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "scout-schema-"));
  try {
    await Bun.write(`${directory}/left`, "same");
    await Bun.write(`${directory}/right`, "same");
    expect(await filesEqual(`${directory}/left`, `${directory}/right`)).toBe(
      true,
    );
    await Bun.write(`${directory}/right`, "different");
    expect(await filesEqual(`${directory}/left`, `${directory}/right`)).toBe(
      false,
    );
    expect(await filesEqual(`${directory}/left`, `${directory}/missing`)).toBe(
      false,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
