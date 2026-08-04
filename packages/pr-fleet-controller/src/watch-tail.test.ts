import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  resolveLatestRunDirectory,
  selectLatestRunId,
  splitAppendedLines,
} from "./watch-tail.ts";

describe("splitAppendedLines", () => {
  test("returns complete lines and empty remainder for newline-terminated input", () => {
    const { lines, remainder } = splitAppendedLines(
      Buffer.alloc(0),
      Buffer.from('{"a":1}\n{"b":2}\n'),
    );
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(remainder.length).toBe(0);
  });

  test("holds a trailing partial line in the remainder", () => {
    const first = splitAppendedLines(
      Buffer.alloc(0),
      Buffer.from('{"a":1}\n{"b'),
    );
    expect(first.lines).toEqual(['{"a":1}']);
    expect(first.remainder.toString("utf8")).toBe('{"b');

    const second = splitAppendedLines(first.remainder, Buffer.from('":2}\n'));
    expect(second.lines).toEqual(['{"b":2}']);
    expect(second.remainder.length).toBe(0);
  });

  test("preserves a multi-byte character split across a chunk boundary", () => {
    // "café\n" — the é (0xC3 0xA9) is split between the two chunks.
    const full = Buffer.from("café\n", "utf8");
    const boundary = full.length - 2; // between 0xC3 and 0xA9
    const first = splitAppendedLines(
      Buffer.alloc(0),
      full.subarray(0, boundary),
    );
    expect(first.lines).toEqual([]);
    const second = splitAppendedLines(first.remainder, full.subarray(boundary));
    expect(second.lines).toEqual(["café"]);
  });

  test("drops blank lines", () => {
    const { lines } = splitAppendedLines(
      Buffer.alloc(0),
      Buffer.from("a\n\nb\n"),
    );
    expect(lines).toEqual(["a", "b"]);
  });
});

describe("selectLatestRunId", () => {
  test("returns null for no runs", () => {
    expect(selectLatestRunId([])).toBeNull();
  });

  test("picks the lexicographically greatest (chronologically newest) id", () => {
    const ids = [
      "2026-08-03T19-47-22.874Z-aaaa",
      "2026-08-03T23-23-53.638Z-bbbb",
      "2026-08-03T20-01-59.825Z-cccc",
    ];
    expect(selectLatestRunId(ids)).toBe("2026-08-03T23-23-53.638Z-bbbb");
  });
});

describe("resolveLatestRunDirectory", () => {
  test("returns null when the state root does not exist", async () => {
    expect(
      await resolveLatestRunDirectory(
        path.join(tmpdir(), "pr-fleet-nonexistent-xyz"),
      ),
    ).toBeNull();
  });

  test("returns the newest run directory, ignoring files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pr-fleet-watch-"));
    try {
      await mkdir(path.join(root, "2026-08-03T19-47-22.874Z-aaaa"));
      await mkdir(path.join(root, "2026-08-03T23-23-53.638Z-bbbb"));
      await Bun.write(path.join(root, "not-a-run.txt"), "x");
      expect(await resolveLatestRunDirectory(root)).toBe(
        path.join(root, "2026-08-03T23-23-53.638Z-bbbb"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
