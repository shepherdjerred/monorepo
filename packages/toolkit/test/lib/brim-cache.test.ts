import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  cocoaToMs,
  COCOA_EPOCH_OFFSET_SECONDS,
  defaultSnapshotsPath,
  loadSnapshots,
} from "#lib/brim/cache.ts";

const dir = await mkdtemp(path.join(tmpdir(), "brim-cache-"));

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cocoaToMs", () => {
  it("converts Apple reference timestamps to Unix millis", () => {
    expect(cocoaToMs(0)).toBe(COCOA_EPOCH_OFFSET_SECONDS * 1000);
  });
});

describe("defaultSnapshotsPath", () => {
  it("points at Brim's QuotaBar cache", () => {
    expect(defaultSnapshotsPath("/home/test")).toBe(
      "/home/test/Library/Application Support/QuotaBar/snapshots.json",
    );
  });
});

describe("loadSnapshots", () => {
  it("loads a valid cache file", async () => {
    const file = path.join(dir, "snapshots.json");
    await writeFile(
      file,
      JSON.stringify([
        {
          provider: "grok",
          windows: [],
          sourceTimestamp: 1,
          freshness: { current: {} },
        },
      ]),
    );
    const snapshots = await loadSnapshots(file);
    expect(snapshots.map((snapshot) => snapshot.provider)).toEqual(["grok"]);
  });

  it("fails loudly on a missing file instead of reporting zero usage", async () => {
    await expect(loadSnapshots(path.join(dir, "missing.json"))).rejects.toThrow(
      "not found",
    );
  });

  it("fails loudly on invalid JSON", async () => {
    const file = path.join(dir, "bad.json");
    await writeFile(file, "not json");
    await expect(loadSnapshots(file)).rejects.toThrow("not valid JSON");
  });

  it("fails loudly on an unexpected shape", async () => {
    const file = path.join(dir, "shape.json");
    await writeFile(file, JSON.stringify([{ provider: 42 }]));
    await expect(loadSnapshots(file)).rejects.toThrow("unexpected shape");
  });
});
