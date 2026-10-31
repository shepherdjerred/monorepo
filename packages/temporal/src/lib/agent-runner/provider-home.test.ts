import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  prepareProviderHomeParent,
  restoreProviderHomeParentMode,
} from "./provider-home.ts";

test("prepareProviderHomeParent traverses parents but stops at temp root without chmodding os.tmpdir()", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "provider-home-parent-test-"),
  );
  try {
    const home = path.join(dir, "sub", "home");
    // Use a distinct UID to trigger the other-execute bit check on parent directories
    const foreignUid = 99_999;
    const result = await prepareProviderHomeParent(home, foreignUid);
    expect(result).toBeDefined();
    expect(result?.directories.length).toBeGreaterThanOrEqual(1);

    // Verify sub and dir are marked executable
    const subStat = await stat(path.join(dir, "sub"));
    expect(subStat.mode & 0o001).toBe(0o001);

    // Ensure none of the modified directories is the system temp directory
    const tempDirResolved = path.resolve(os.tmpdir());
    for (const record of result?.directories ?? []) {
      expect(path.resolve(record.directory)).not.toBe(tempDirResolved);
    }

    // Restore modes
    await restoreProviderHomeParentMode(result);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
