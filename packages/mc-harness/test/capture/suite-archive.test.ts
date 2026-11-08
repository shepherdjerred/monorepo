import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SuiteRunSchema,
  retainSuiteRun,
  readSuiteRun,
  retainedSuiteFile,
  relativeSuiteFile,
} from "#src/capture/suite/archive.ts";

it("retains and resolves a custom suite path instead of selecting TSMC", async () => {
  const objects = new Map<string, Uint8Array>();
  const store = {
    write: (key: string, bytes: Uint8Array) => {
      objects.set(key, bytes);
      return Promise.resolve();
    },
    read: (key: string) => {
      const bytes = objects.get(key);
      if (bytes === undefined) throw new Error("Missing retained object");
      return Promise.resolve(bytes);
    },
  };
  const cache = await mkdtemp(path.join(os.tmpdir(), "suite-archive-"));
  try {
    const run = SuiteRunSchema.parse({
      schema: 1,
      id: "00000000-0000-4000-8000-000000000001",
      suite: "custom-town",
      suiteFile: relativeSuiteFile(
        "/repo",
        "/repo/packages/the-storm/tools/captures/custom.ts",
      ),
      fixture: "a".repeat(64),
      runtime: "b".repeat(64),
      rollout: null,
      selection: { scenario: "town" },
      scenarios: [{ id: "town", archive: "c".repeat(64) }],
    });
    await retainSuiteRun(store, run);
    const restored = await readSuiteRun(store, cache, run.id);
    expect(restored).toEqual(run);
    expect(retainedSuiteFile("/another-checkout", restored)).toBe(
      "/another-checkout/packages/the-storm/tools/captures/custom.ts",
    );
    for (const suiteFile of [
      "../custom.ts",
      "/private/custom.ts",
      "packages/../custom.ts",
      String.raw`packages\custom.ts`,
    ])
      expect(() =>
        retainedSuiteFile("/repo", { ...restored, suiteFile }),
      ).toThrow("repository-relative");
    expect(() => relativeSuiteFile("/repo", "/private/custom.ts")).toThrow(
      "repository-relative",
    );
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});
