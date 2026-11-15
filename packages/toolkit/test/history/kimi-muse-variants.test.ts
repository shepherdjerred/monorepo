import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { HistoryPaths } from "#lib/history/paths.ts";
import type { HistoryDocument } from "#lib/history/types.ts";
import {
  KIMI_CREATED_MS,
  KIMI_SESSION_ID,
  KIMI_WORKDIR,
  kimiMainWire,
  writeKimiFixture,
} from "./history-fixtures/kimi.ts";
import {
  MUSE_SESSION_ID,
  addMuseFork,
  museRootLog,
  setMuseTitle,
  writeMuseFixture,
} from "./history-fixtures/muse.ts";
import {
  historyPathsUnder,
  historySourceNamed,
} from "./history-fixtures/sources.ts";

/**
 * Format variants seen in real Kimi Code and Meta Muse data that the first
 * readers rejected, failing the whole source.
 */

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "history-kimi-muse-variants-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function pathsFor(overrides: Partial<HistoryPaths>): HistoryPaths {
  return historyPathsUnder(root, overrides);
}

async function scanDocuments(
  name: "kimi" | "muse",
  paths: HistoryPaths,
): Promise<readonly HistoryDocument[]> {
  const result = await historySourceNamed(name).scan(paths);
  expect(result.error).toBeNull();
  return result.documents;
}

function documentAt(
  documents: readonly HistoryDocument[],
  sourceId: string,
): HistoryDocument {
  const document = documents.find((entry) => entry.sourceId === sourceId);
  if (document === undefined) {
    throw new Error(`missing document ${sourceId}`);
  }
  return document;
}

const KIMI_MAIN = path.join(
  KIMI_WORKDIR,
  KIMI_SESSION_ID,
  "agents/main/wire.jsonl",
);

/** Rewrites the fixture's state.json the way Kimi writes an untitled one. */
async function untitle(sessionDir: string): Promise<void> {
  const statePath = path.join(sessionDir, "state.json");
  const state = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(await readFile(statePath, "utf8")));
  const {
    title: _title,
    titleKind: _kind,
    lastPrompt: _prompt,
    ...untitled
  } = state;
  await writeFile(
    statePath,
    JSON.stringify({ ...untitled, lastTurnReason: "completed" }),
  );
}

function taskPrompt(offsetMs: number): Record<string, unknown> {
  return {
    type: "turn.prompt",
    agentId: "main",
    input: [
      {
        type: "text",
        text: "<notification>kimi-task-marker finished</notification>",
      },
    ],
    origin: {
      kind: "task",
      taskId: "task-1",
      notificationId: "n-1",
      status: "completed",
    },
    time: KIMI_CREATED_MS + offsetMs,
  };
}

describe("kimi variants", () => {
  test("an untitled session is titled from its first user prompt", async () => {
    const { sessionDir, sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-untitled"),
    );
    await untitle(sessionDir);
    const documents = await scanDocuments(
      "kimi",
      pathsFor({ kimiSessionsDir: sessionsDir }),
    );
    expect(documentAt(documents, KIMI_MAIN).title).toBe(
      "Fix the flaky kimi-prompt-marker test",
    );
  });

  test("an untitled session with no user prompt is 'Untitled Kimi session'", async () => {
    const wire = kimiMainWire().filter(
      (record) =>
        record["type"] !== "turn.prompt" && record["type"] !== "turn.steer",
    );
    const { sessionDir, sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-untitled-empty"),
      [taskPrompt(500), ...wire],
    );
    await untitle(sessionDir);
    const documents = await scanDocuments(
      "kimi",
      pathsFor({ kimiSessionsDir: sessionsDir }),
    );
    expect(documentAt(documents, KIMI_MAIN).title).toBe(
      "Untitled Kimi session",
    );
  });

  test("a task notification prompt is tool output, not dialogue", async () => {
    const { sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-task-prompt"),
      [taskPrompt(0), ...kimiMainWire()],
    );
    const main = documentAt(
      await scanDocuments("kimi", pathsFor({ kimiSessionsDir: sessionsDir })),
      KIMI_MAIN,
    );
    expect(main.toolOutputText).toContain("kimi-task-marker");
    expect(main.dialogueText).not.toContain("kimi-task-marker");
    expect(main.openingPromptHash).not.toBeNull();
  });

  test("a prompt with an unclassified origin fails the scan", async () => {
    const { sessionsDir } = await writeKimiFixture(
      path.join(root, "kimi-unknown-origin"),
      [{ ...taskPrompt(0), origin: { kind: "webhook" } }, ...kimiMainWire()],
    );
    const result = await historySourceNamed("kimi").scan(
      pathsFor({ kimiSessionsDir: sessionsDir }),
    );
    expect(result.error).toContain('unknown origin "webhook"');
  });
});

describe("muse variants", () => {
  test("a forked session indexes past its untimestamped fork records and names its source", async () => {
    const fixture = await writeMuseFixture(path.join(root, "muse-fork"));
    const forkId = await addMuseFork(fixture);
    const paths = pathsFor({ museRoot: fixture.museRoot });
    const fork = documentAt(await scanDocuments("muse", paths), forkId);
    expect(fork.title).toBe("[fork of Muse fixture title] Muse fork title");
    // The copied turns belong to the source session's own document.
    expect(fork.dialogueText).toContain("muse-fork-marker");
    expect(fork.dialogueText).not.toContain("muse-copied-prompt-marker");
    expect(fork.usageEvents).toMatchObject([{ inputTokens: 500 }]);
  });

  test("a fork that keeps its source's title is marked as a fork", async () => {
    const fixture = await writeMuseFixture(path.join(root, "muse-fork-same"));
    const forkId = await addMuseFork(fixture, "Muse fixture title");
    const documents = await scanDocuments(
      "muse",
      pathsFor({ museRoot: fixture.museRoot }),
    );
    expect(documentAt(documents, forkId).title).toBe(
      "[fork] Muse fixture title",
    );
  });

  test("retitling the source re-parses the fork", async () => {
    const fixture = await writeMuseFixture(
      path.join(root, "muse-fork-retitle"),
    );
    const forkId = await addMuseFork(fixture);
    const paths = pathsFor({ museRoot: fixture.museRoot });
    const muse = historySourceNamed("muse");
    const first = await muse.scan(paths);
    expect(first.error).toBeNull();
    muse.commitScan?.();
    // setMuseTitle retitles every row, the fork included.
    setMuseTitle(fixture.dbPath, "Renamed");
    const rescanned = await muse.scan(paths);
    expect(documentAt(rescanned.documents, forkId).title).toBe(
      "[fork] Renamed",
    );
  });

  test("a used record without a timestamp still fails the scan", async () => {
    const log = museRootLog().map((record) => {
      if (!JSON.stringify(record).includes('"kind":"model_completed"')) {
        return record;
      }
      const { recorded_at: _recordedAt, ...untimed } = record;
      return untimed;
    });
    const fixture = await writeMuseFixture(
      path.join(root, "muse-untimed-usage"),
      log,
    );
    const result = await historySourceNamed("muse").scan(
      pathsFor({ museRoot: fixture.museRoot }),
    );
    expect(result.error).toContain("missing or invalid timestamp");
  });

  test("the source session still indexes beside its fork", async () => {
    const fixture = await writeMuseFixture(path.join(root, "muse-fork-source"));
    await addMuseFork(fixture);
    const documents = await scanDocuments(
      "muse",
      pathsFor({ museRoot: fixture.museRoot }),
    );
    expect(
      documents.filter((document) => document.runtimeId === MUSE_SESSION_ID),
    ).toHaveLength(1);
  });
});
