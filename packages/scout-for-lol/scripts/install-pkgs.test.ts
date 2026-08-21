import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { filesEqual, requireCliValue } from "./migration-core.ts";

test("requires a value after a CLI flag", () => {
  expect(requireCliValue(["--web-port", "4321"], 0, "--web-port")).toBe("4321");
  expect(() => requireCliValue(["--web-port"], 0, "--web-port")).toThrow(
    "--web-port requires a value",
  );
});

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
