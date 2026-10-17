import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { EvidenceQuerySchema } from "@shepherdjerred/mc-harness/protocol/evidence.ts";
import { exportEvidence } from "#lib/mc/evidence.ts";
import { runMcCommand } from "./command.ts";

const query = EvidenceQuerySchema.parse({
  action: "export",
  player: "Alice",
  text: "private filter",
  surface: "message",
  since: "1970-01-01T00:00:00Z",
  until: "2026-10-16T00:00:00Z",
  after: 0,
  limit: 100,
  id: "",
});

describe("private evidence", () => {
  test("exports every page without terminal contents and refuses overwrite", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mc-evidence-"));
    try {
      const output = path.join(directory, "private.jsonl");
      const fetchPage = vi.fn(async (request: typeof query) => ({
        version: 1 as const,
        rows: [
          { sequence: request.after + 1, original_text: "private message" },
        ],
        events: [{ submission_id: "id", outcome: "delivered" }],
        next: request.after + 1,
        hasMore: request.after === 0,
      }));
      const stdout = vi.spyOn(console, "log");
      expect(
        await exportEvidence(query, output, fetchPage, "sbx-fixture"),
      ).toBe(2);
      expect(stdout).not.toHaveBeenCalled();
      stdout.mockRestore();
      expect(fetchPage.mock.calls.map(([request]) => request.after)).toEqual([
        0, 1,
      ]);
      expect(
        fetchPage.mock.calls.every(
          ([request]) =>
            request.until === query.until && request.text === query.text,
        ),
      ).toBe(true);
      const metadata = await stat(output);
      const content = await readFile(output, "utf8");
      expect(metadata.mode & 0o777).toBe(0o600);
      expect(content.trim().split("\n")).toHaveLength(5);
      expect(content.split("\n")[0]).toContain('"target":"sbx-fixture"');
      expect(content.split("\n")[0]).not.toContain("private filter");
      await expect(
        exportEvidence(query, output, fetchPage, "sbx-fixture"),
      ).rejects.toMatchObject({ code: "EEXIST" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects a nonadvancing cursor without exposing returned rows", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mc-evidence-"));
    try {
      await expect(
        exportEvidence(
          query,
          path.join(directory, "private.jsonl"),
          async () => ({
            version: 1,
            rows: [{ original_text: "private message" }],
            events: [],
            next: 0,
            hasMore: true,
          }),
          "sbx-fixture",
        ),
      ).rejects.toThrow("Evidence export cursor did not advance");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("shows help without contacting a daemon", async () => {
    const result = await runMcCommand(["evidence", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mc evidence export");
  });

  test.each([
    ["export", "--target", "live"],
    ["search", "--output", "private.jsonl"],
    ["show", "not-a-uuid"],
    [
      "search",
      "--since",
      "2027-01-01T00:00:00Z",
      "--until",
      "2026-01-01T00:00:00Z",
    ],
  ])("rejects invalid arguments before daemon access: %j", async (...args) => {
    const result = await runMcCommand(["evidence", ...args]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("daemon is not running");
  });
});
