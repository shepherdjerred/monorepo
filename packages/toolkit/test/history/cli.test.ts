import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { HistoryIndex } from "#lib/history/index.ts";
import {
  defaultHistoryPaths,
  defaultHistoryRuntimePaths,
} from "#lib/history/paths.ts";
import { createHistorySources } from "#lib/history/sources.ts";
import type { HistorySourceResult } from "#lib/history/types.ts";

let fixtureHome = "";
let recordId = 0;
const fixtureUpdatedAt = new Date().toISOString();
const fixtureCreatedAt = new Date(Date.now() - 60_000).toISOString();

function unavailable(
  source: "cursor" | "claude",
  error: string | null,
): HistorySourceResult {
  return {
    source,
    available: false,
    documents: [],
    fingerprint: "missing",
    error,
  };
}

beforeAll(async () => {
  fixtureHome = await mkdtemp(path.join(os.tmpdir(), "toolkit-history-cli-"));
  const paths = defaultHistoryPaths(fixtureHome);
  await mkdir(path.dirname(paths.conductorDb), { recursive: true });
  const database = new Database(paths.conductorDb);
  database.run(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, title TEXT, created_at TEXT, updated_at TEXT,
      model TEXT, agent_type TEXT, workspace_id TEXT
    );
    CREATE TABLE session_messages (
      id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
      full_message TEXT, created_at TEXT
    );
  `);
  database.run("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)", [
    "current-session",
    "Synthetic history",
    fixtureCreatedAt,
    fixtureUpdatedAt,
    "model",
    "agent",
    "/fixture",
  ]);
  database.run("INSERT INTO session_messages VALUES (?, ?, ?, ?, ?, ?)", [
    "m1",
    "current-session",
    "user",
    "Investigate synthetic history ranking",
    null,
    fixtureCreatedAt,
  ]);
  database.run("INSERT INTO session_messages VALUES (?, ?, ?, ?, ?, ?)", [
    "m2",
    "current-session",
    "assistant",
    "Synthetic history answer",
    null,
    fixtureUpdatedAt,
  ]);
  database.close();

  const conductor = createHistorySources().find(
    (source) => source.name === "conductor",
  );
  if (conductor === undefined) {
    throw new Error("Conductor history adapter is missing");
  }
  const scanned = await conductor.scan(paths);
  const index = await HistoryIndex.open(
    defaultHistoryRuntimePaths(fixtureHome),
  );
  await index.ingest([
    scanned,
    {
      source: "codex",
      available: true,
      documents: [
        {
          source: "codex",
          sourceId: "codex-collision",
          title: "Runtime collision fixture",
          path: "/fixture/codex-collision",
          workspace: "/fixture",
          agent: "fixture",
          createdAt: fixtureCreatedAt,
          updatedAt: fixtureUpdatedAt,
          runtimeId: "current-session",
          openingPromptHash: null,
          dialogueText: "Unique collisionterm dialogue",
          toolOutputText: "",
        },
      ],
      fingerprint: "codex-collision-fixture",
      error: null,
    },
    unavailable("cursor", "fixture cursor warning"),
    unavailable("claude", null),
  ]);
  const match = index.search("synthetic", { since: null, source: null })[0];
  if (match === undefined) {
    throw new Error("Synthetic history record was not indexed");
  }
  recordId = match.id;
  index.close();
});

afterAll(async () => {
  if (fixtureHome.length > 0) {
    await rm(fixtureHome, { recursive: true, force: true });
  }
});

async function runHistory(
  args: readonly string[],
  conductorSessionId = "different-session",
  codexThreadId = "different-thread",
): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const child = Bun.spawn(
    [process.execPath, "run", "src/index.ts", "history", ...args],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: {
        ...Bun.env,
        HOME: fixtureHome,
        CONDUCTOR_SESSION_ID: conductorSessionId,
        CODEX_THREAD_ID: codexThreadId,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("history JSON interfaces", () => {
  test("returns search and recent envelopes with warnings", async () => {
    const search = await runHistory([
      "search",
      "synthetic",
      "--since",
      "7d",
      "--json",
    ]);
    expect(search).toEqual(expect.objectContaining({ exitCode: 0 }));
    const searchBody = z
      .object({
        query: z.string(),
        results: z.array(
          z.object({ id: z.number(), members: z.array(z.unknown()) }),
        ),
        warnings: z.array(
          z.object({ source: z.string(), message: z.string() }),
        ),
      })
      .parse(JSON.parse(search.stdout));
    expect(Object.keys(searchBody).sort()).toEqual([
      "query",
      "results",
      "warnings",
    ]);
    expect(searchBody.results).toHaveLength(1);
    expect(searchBody.warnings).toContainEqual({
      source: "cursor",
      message: "fixture cursor warning",
    });

    const recent = await runHistory(["recent", "--since", "7d", "--json"]);
    expect(recent.exitCode).toBe(0);
    const recentBody = z
      .object({ results: z.array(z.unknown()), warnings: z.array(z.unknown()) })
      .parse(JSON.parse(recent.stdout));
    expect(Object.keys(recentBody).sort()).toEqual(["results", "warnings"]);
  });

  test("hides the current session unless --include-current is supplied", async () => {
    const hidden = await runHistory(
      ["search", "synthetic", "--since", "7d", "--json"],
      "current-session",
    );
    const hiddenBody = z
      .object({ results: z.array(z.unknown()) })
      .parse(JSON.parse(hidden.stdout));
    expect(hiddenBody.results).toHaveLength(0);

    const included = await runHistory(
      ["search", "synthetic", "--since", "7d", "--include-current", "--json"],
      "current-session",
    );
    const includedBody = z
      .object({ results: z.array(z.unknown()) })
      .parse(JSON.parse(included.stdout));
    expect(includedBody.results).toHaveLength(1);
  });

  test("scopes current runtime IDs to their source", async () => {
    const conductorCollision = await runHistory(
      ["search", "collisionterm", "--since", "7d", "--json"],
      "current-session",
    );
    const conductorBody = z
      .object({ results: z.array(z.object({ source: z.string() })) })
      .parse(JSON.parse(conductorCollision.stdout));
    expect(conductorBody.results).toEqual([{ source: "codex" }]);

    const codexCurrent = await runHistory(
      ["search", "collisionterm", "--since", "7d", "--json"],
      "different-session",
      "current-session",
    );
    const codexBody = z
      .object({ results: z.array(z.unknown()) })
      .parse(JSON.parse(codexCurrent.stdout));
    expect(codexBody.results).toHaveLength(0);
  });

  test("returns bounded show context and an actionable missing-ID error", async () => {
    const shown = await runHistory([
      "show",
      String(recordId),
      "--query",
      "synthetic",
      "--json",
    ]);
    expect(shown.exitCode).toBe(0);
    const body = z
      .object({
        record: z.object({ id: z.number() }),
        messages: z.array(z.object({ role: z.string(), text: z.string() })),
        truncated: z.boolean(),
      })
      .parse(JSON.parse(shown.stdout));
    expect(Object.keys(body).sort()).toEqual([
      "messages",
      "record",
      "truncated",
    ]);
    expect(body.record.id).toBe(recordId);
    expect(body.messages.length).toBeLessThanOrEqual(8);

    const missing = await runHistory(["show", "999999", "--json"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("rerun 'toolkit history search'");

    const malformed = await runHistory(["show", `${String(recordId)}junk`]);
    expect(malformed.exitCode).toBe(1);
    expect(malformed.stderr).toContain("positive local index ID");

    const malformedMessages = await runHistory([
      "show",
      String(recordId),
      "--messages",
      "8junk",
    ]);
    expect(malformedMessages.exitCode).toBe(1);
    expect(malformedMessages.stderr).toContain("Messages must be an integer");

    const malformedLimit = await runHistory([
      "search",
      "synthetic",
      "--limit",
      "2junk",
    ]);
    expect(malformedLimit.exitCode).toBe(1);
    expect(malformedLimit.stderr).toContain("Limit must be an integer");

    const tokenlessQuery = await runHistory([
      "show",
      String(recordId),
      "--query",
      "!!!",
    ]);
    expect(tokenlessQuery.exitCode).toBe(1);
    expect(tokenlessQuery.stderr).toContain(
      "Search query must contain at least one letter or number",
    );
  });

  test("writes human warnings to stderr", async () => {
    const result = await runHistory(["search", "synthetic", "--since", "7d"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Synthetic history");
    expect(result.stderr).toContain("Warning [cursor]: fixture cursor warning");
  });

  test("reports an indexed record that disappeared from its source", async () => {
    const database = new Database(defaultHistoryPaths(fixtureHome).conductorDb);
    database.run("DELETE FROM sessions WHERE id = ?", ["current-session"]);
    database.close();

    const shown = await runHistory(["show", String(recordId), "--json"]);
    expect(shown.exitCode).toBe(1);
    expect(shown.stderr).toContain("no longer available");
    expect(shown.stderr).toContain("rerun 'toolkit history search'");

    const searched = await runHistory([
      "search",
      "synthetic",
      "--since",
      "7d",
      "--include-excerpts",
      "--json",
    ]);
    expect(searched.exitCode).toBe(0);
    const body = z
      .object({
        warnings: z.array(
          z.object({ source: z.string(), message: z.string() }),
        ),
      })
      .parse(JSON.parse(searched.stdout));
    expect(body.warnings).toContainEqual({
      source: "conductor",
      message: expect.stringContaining("no longer available"),
    });
  });
});
