import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openColdStartRecord } from "#lib/backup/cold-start-record.ts";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "cold-start-record-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("openColdStartRecord", () => {
  it("creates an owner-only file holding one JSON line per entry", async () => {
    const file = path.join(directory, "record.jsonl");
    const record = await openColdStartRecord(file, { type: "header" });
    await record.append({ type: "object", key: "a" });
    await record.close();
    const { mode } = await stat(file);
    expect(mode % 0o1000).toBe(0o600);
    const contents = await readFile(file, "utf8");
    expect(contents.trim().split("\n")).toEqual([
      '{"type":"header"}',
      '{"type":"object","key":"a"}',
    ]);
  });

  it("never replaces an existing record", async () => {
    const file = path.join(directory, "record.jsonl");
    await writeFile(file, "earlier run\n");
    await expect(openColdStartRecord(file, { type: "header" })).rejects.toThrow(
      "EEXIST",
    );
    expect(await readFile(file, "utf8")).toBe("earlier run\n");
  });
});
