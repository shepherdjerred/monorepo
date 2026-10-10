import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allOf, appendLog, lastOf, readLog } from "#build/build-log.ts";

describe("build log", () => {
  it("appends stamped entries and counts iterations by renders", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "build-log-"));
    expect(await readLog(dir)).toEqual([]);
    await appendLog(dir, { kind: "note", text: "start with massing" });
    const first = await appendLog(dir, {
      kind: "render",
      name: "iter-1",
      source: "compiled",
      files: ["renders/iter-1.png"],
    });
    expect(first.iteration).toBe(1);
    await appendLog(dir, {
      kind: "lint",
      source: "compiled",
      errors: 0,
      warnings: 2,
    });
    const second = await appendLog(dir, {
      kind: "render",
      name: "iter-2",
      source: "compiled",
      files: [],
    });
    expect(second.iteration).toBe(2);
    const entries = await readLog(dir);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "note",
      "render",
      "lint",
      "render",
    ]);
    expect(entries[0]?.iteration).toBe(0);
    expect(entries[2]?.iteration).toBe(1);
    const last = lastOf(entries, "render");
    expect(last?.kind === "render" ? last.name : null).toBe("iter-2");
    expect(allOf(entries, "render")).toHaveLength(2);
    expect(lastOf(entries, "promote")).toBeNull();
    for (const entry of entries) {
      expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
    }
  });
});
