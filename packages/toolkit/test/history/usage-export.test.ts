import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HistoryIndex } from "#lib/history/index.ts";
import { defaultHistoryRuntimePaths } from "#lib/history/paths.ts";
import {
  UsageExportLedger,
  usageEventKeys,
  type UsageExportTotals,
} from "#lib/history/usage-export.ts";
import type { ExportableUsageEvent } from "#lib/history/usage-query.ts";
import type {
  HistoryDocument,
  HistorySourceResult,
  UsageEventEntry,
} from "#lib/history/types.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempHome(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "usage-export-"));
  directories.push(directory);
  return directory;
}

const SEED = new Date("2026-09-01T00:00:00.000Z");
const LATER = new Date("2026-09-02T00:00:00.000Z");
const LATEST = new Date("2026-09-03T00:00:00.000Z");

function usageEvent(
  occurredAt: string,
  overrides: Partial<UsageEventEntry> = {},
): UsageEventEntry {
  return {
    occurredAt,
    model: "claude-opus-5-5",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 5,
    cacheCreationTokens: 3,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0.5,
    costComplete: true,
    ...overrides,
  };
}

function document(
  sourceId: string,
  usageEvents: readonly UsageEventEntry[],
): HistoryDocument {
  return {
    source: "claude",
    sourceId,
    title: `session ${sourceId}`,
    path: `/private/${sourceId}.jsonl`,
    workspace: "/private/workspace",
    agent: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    runtimeId: null,
    openingPromptHash: null,
    dialogueText: `dialogue ${sourceId} ${String(usageEvents.length)}`,
    toolOutputText: "",
    usageEvents,
  };
}

function result(documents: readonly HistoryDocument[]): HistorySourceResult {
  return {
    source: "claude",
    available: true,
    documents,
    fingerprint: JSON.stringify(
      documents.map((entry) => [entry.sourceId, entry.usageEvents.length]),
    ),
    error: null,
  };
}

function tokens(totals: UsageExportTotals, type: string): number {
  return totals.tokens
    .filter((entry) => entry.type === type)
    .reduce((sum, entry) => sum + entry.tokens, 0);
}

function events(totals: UsageExportTotals): number {
  return totals.models.reduce((sum, entry) => sum + entry.events, 0);
}

async function openPair(): Promise<{
  index: HistoryIndex;
  ledger: UsageExportLedger;
  ledgerPath: string;
}> {
  const runtimePaths = defaultHistoryRuntimePaths(await tempHome());
  const index = await HistoryIndex.open(runtimePaths);
  const ledger = await UsageExportLedger.open(runtimePaths.usageExportDb);
  return { index, ledger, ledgerPath: runtimePaths.usageExportDb };
}

describe("usage export ledger", () => {
  test("seeds existing events on the first refresh without backfilling", async () => {
    const { index, ledger, ledgerPath } = await openPair();
    await index.ingest([
      result([document("a", [usageEvent("2026-08-31T12:00:00.000Z")])]),
    ]);

    const first = ledger.refresh(index, SEED);
    expect(first).toMatchObject({ seeded: true, newKeys: 1, countedEvents: 0 });
    expect(ledger.totals().tokens).toEqual([]);
    expect(ledger.seededAt()?.toISOString()).toBe(SEED.toISOString());
    const ledgerStat = await stat(ledgerPath);
    expect(ledgerStat.mode & 0o777).toBe(0o600);

    await index.ingest([
      result([
        document("a", [
          usageEvent("2026-08-31T12:00:00.000Z"),
          usageEvent("2026-09-01T06:00:00.000Z"),
        ]),
      ]),
    ]);
    const second = ledger.refresh(index, LATER);
    expect(second).toMatchObject({ seeded: false, countedEvents: 1 });
    const totals = ledger.totals();
    expect(tokens(totals, "input")).toBe(100);
    expect(tokens(totals, "output")).toBe(20);
    expect(tokens(totals, "cache_read")).toBe(5);
    expect(tokens(totals, "cache_write")).toBe(3);
    expect(totals.models).toEqual([
      {
        source: "claude",
        model: "claude-opus-5-5",
        costUsd: 0.5,
        events: 1,
      },
    ]);
    index.close();
    ledger.close();
  });

  test("never backfills events that predate the seed but arrive later", async () => {
    const { index, ledger } = await openPair();
    await index.ingest([result([])]);
    ledger.refresh(index, SEED);
    // A source that was unreadable at seed time shows up with old history.
    await index.ingest([
      result([document("restored", [usageEvent("2026-06-01T00:00:00.000Z")])]),
    ]);
    expect(ledger.refresh(index, LATER)).toMatchObject({
      newKeys: 1,
      countedEvents: 0,
    });
    expect(events(ledger.totals())).toBe(0);
    index.close();
    ledger.close();
  });

  test("re-ingest, forced rebuild, and pruning never lower or double totals", async () => {
    const { index, ledger } = await openPair();
    await index.ingest([result([])]);
    ledger.refresh(index, SEED);
    const docs = [
      document("a", [usageEvent("2026-09-01T01:00:00.000Z")]),
      document("b", [usageEvent("2026-09-01T02:00:00.000Z")]),
    ];
    await index.ingest([result(docs)]);
    ledger.refresh(index, LATER);
    const before = ledger.totals();
    expect(events(before)).toBe(2);

    // Forced reindex drops and rebuilds every index table.
    await index.ingest([result(docs)], true);
    expect(ledger.refresh(index, LATER).countedEvents).toBe(0);
    expect(ledger.totals()).toEqual(before);

    // Transcript "b" disappears: the index deletes its usage rows.
    await index.ingest([result([docs[0] ?? document("a", [])])]);
    expect(index.usage({ since: null, source: null }).total.inputTokens).toBe(
      100,
    );
    ledger.refresh(index, LATER);
    expect(ledger.totals()).toEqual(before);

    // It comes back (restored backup): still no double count.
    await index.ingest([result(docs)]);
    expect(ledger.refresh(index, LATEST).countedEvents).toBe(0);
    expect(ledger.totals()).toEqual(before);
    index.close();
    ledger.close();
  });

  test("totals survive closing and reopening the ledger", async () => {
    const { index, ledger, ledgerPath } = await openPair();
    await index.ingest([result([])]);
    ledger.refresh(index, SEED);
    await index.ingest([
      result([document("a", [usageEvent("2026-09-01T01:00:00.000Z")])]),
    ]);
    ledger.refresh(index, LATER);
    const before = ledger.totals();
    ledger.close();

    const reopened = await UsageExportLedger.open(ledgerPath);
    expect(reopened.seededAt()?.toISOString()).toBe(SEED.toISOString());
    expect(reopened.refresh(index, LATEST)).toMatchObject({
      seeded: false,
      countedEvents: 0,
    });
    expect(reopened.totals()).toEqual(before);
    index.close();
    reopened.close();
  });

  test("counts exact duplicate events as separate turns", async () => {
    const { index, ledger } = await openPair();
    await index.ingest([result([])]);
    ledger.refresh(index, SEED);
    const same = usageEvent("2026-09-01T01:00:00.000Z");
    await index.ingest([result([document("a", [same, same])])]);
    expect(ledger.refresh(index, LATER).countedEvents).toBe(2);
    expect(tokens(ledger.totals(), "input")).toBe(200);

    // The same pair re-read is not new; a third identical turn is.
    await index.ingest([result([document("a", [same, same, same])])]);
    expect(ledger.refresh(index, LATEST).countedEvents).toBe(1);
    expect(tokens(ledger.totals(), "input")).toBe(300);
    index.close();
    ledger.close();
  });

  test("tracks unpriced events per source and cost per model", async () => {
    const { index, ledger } = await openPair();
    await index.ingest([result([])]);
    ledger.refresh(index, SEED);
    await index.ingest([
      result([
        document("a", [
          usageEvent("2026-09-01T01:00:00.000Z", {
            model: "mystery-model",
            costUsd: null,
            costComplete: false,
          }),
          usageEvent("2026-09-01T02:00:00.000Z", { costUsd: 1.25 }),
        ]),
      ]),
    ]);
    ledger.refresh(index, LATER);
    const totals = ledger.totals();
    expect(totals.sources).toEqual([{ source: "claude", unpricedEvents: 1 }]);
    expect(totals.models).toEqual([
      { source: "claude", model: "claude-opus-5-5", costUsd: 1.25, events: 1 },
      { source: "claude", model: "mystery-model", costUsd: 0, events: 1 },
    ]);
    index.close();
    ledger.close();
  });

  test("ignores and prunes keys older than the retention window", async () => {
    const { index, ledger } = await openPair();
    await index.ingest([
      result([
        document("old", [
          usageEvent("2025-01-01T00:00:00.000Z"),
          usageEvent("2026-08-01T00:00:00.000Z"),
        ]),
      ]),
    ]);
    expect(ledger.refresh(index, SEED).newKeys).toBe(1);
    // 400 days after the recent event, its key ages out.
    const muchLater = new Date("2027-09-10T00:00:00.000Z");
    expect(ledger.refresh(index, muchLater).prunedKeys).toBe(1);
    index.close();
    ledger.close();
  });

  test("event keys depend only on stable event fields", () => {
    const event: ExportableUsageEvent = {
      source: "claude",
      sourceId: "a",
      occurredAt: "2026-09-01T01:00:00.000Z",
      model: "m",
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      costUsd: 1,
      costComplete: true,
    };
    const [first] = usageEventKeys([event]);
    // A pricing catalog change must not make an old event look new.
    expect(usageEventKeys([{ ...event, costUsd: 2 }])).toEqual([first]);
    expect(usageEventKeys([{ ...event, sourceId: "b" }])).not.toEqual([first]);
    const [one, two] = usageEventKeys([event, event]);
    expect(one).not.toBe(two);
  });

  test("rejects a ledger from an unknown schema version", async () => {
    const { ledgerPath, ledger, index } = await openPair();
    ledger.close();
    index.close();
    const { Database } = await import("bun:sqlite");
    const database = new Database(ledgerPath);
    database.run("PRAGMA user_version = 99");
    database.close();
    await expect(UsageExportLedger.open(ledgerPath)).rejects.toThrow(
      /schema v99/,
    );
  });
});
