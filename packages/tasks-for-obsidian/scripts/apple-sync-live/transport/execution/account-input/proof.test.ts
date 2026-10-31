import { expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { retainMacRawStreams } from "./proof";

test("a failed stdout retention still independently retains stderr and never overwrites evidence", async () => {
  const directory = await mkdtemp("/tmp/facet-mac-raw-retention-");
  try {
    await writeFile(
      path.join(directory, "native.stdout"),
      "first-public-evidence",
      { flag: "wx", mode: 0o600 },
    );
    const retained = await retainMacRawStreams(directory, {
      stdout: new TextEncoder().encode("second-public-evidence"),
      stderr: new TextEncoder().encode("public-diagnostic-evidence"),
    });
    expect(retained).toBe(false);
    expect(await readFile(path.join(directory, "native.stdout"), "utf8")).toBe(
      "first-public-evidence",
    );
    expect(await readFile(path.join(directory, "native.stderr"), "utf8")).toBe(
      "public-diagnostic-evidence",
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});
