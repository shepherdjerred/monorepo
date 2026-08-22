import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HistoryIndex } from "#lib/history/index.ts";
import { defaultHistoryRuntimePaths } from "#lib/history/paths.ts";
import { ftsQuery } from "#lib/history/query.ts";
import type {
  HistoryDocument,
  HistorySourceName,
  HistorySourceResult,
} from "#lib/history/types.ts";

const roots: string[] = [];

async function runtime() {
  const root = await mkdtemp(path.join(os.tmpdir(), "toolkit-history-index-"));
  roots.push(root);
  return defaultHistoryRuntimePaths(root);
}

function document(
  sourceId: string,
  values: {
    readonly title?: string;
    readonly dialogue?: string;
    readonly tool?: string;
    readonly createdAt?: string;
    readonly promptHash?: string;
    readonly runtimeId?: string;
    readonly source?: HistorySourceName;
  },
): HistoryDocument {
  const createdAt = values.createdAt ?? "2026-08-01T00:00:00.000Z";
  return {
    source: values.source ?? "conductor",
    sourceId,
    title: values.title ?? `Session ${sourceId}`,
    path: `/fixture/${sourceId}`,
    workspace: "/fixture",
    agent: "fixture",
    createdAt,
    updatedAt: createdAt,
    runtimeId: values.runtimeId ?? sourceId,
    openingPromptHash: values.promptHash ?? null,
    dialogueText: values.dialogue ?? "",
    toolOutputText: values.tool ?? "",
  };
}

function result(
  documents: readonly HistoryDocument[],
  source: HistorySourceName = "conductor",
): HistorySourceResult {
  return {
    source,
    available: true,
    documents,
    fingerprint: "fixture-v1",
    error: null,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("history BM25 index", () => {
  test("ranks dialogue above newer tool-only mentions", async () => {
    const paths = await runtime();
    const index = await HistoryIndex.open(paths);
    await index.ingest([
      result([
        document("substantive", {
          dialogue:
            "Bryan Bucks betting model analysis with calibration and bankroll evaluation",
          createdAt: "2026-08-01T00:00:00.000Z",
        }),
        document("branch", {
          tool: "git branch list pull-up-bryan-bucks-v1",
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    ]);

    const matches = index.search("Bryan Bucks", {
      since: null,
      source: null,
    });
    expect(matches.map((match) => match.sourceId)).toEqual([
      "substantive",
      "branch",
    ]);
    index.close();
  });

  test("supports exact quoted phrases and AND-prefix terms", async () => {
    const paths = await runtime();
    const index = await HistoryIndex.open(paths);
    await index.ingest([
      result([
        document("exact", { dialogue: "Deploy Bryan Bucks model safely" }),
        document("separated", {
          dialogue: "Deploy Bryan experimental model before Bucks reporting",
        }),
        document("punctuated", { dialogue: "Deploy foo bar safely" }),
        document("accented", { dialogue: "Review the café forecast" }),
      ]),
    ]);

    expect(
      index
        .search('"Bryan Bucks"', { since: null, source: null })
        .map((match) => match.sourceId),
    ).toEqual(["exact"]);
    expect(
      index
        .search("depl buck", { since: null, source: null })
        .map((match) => match.sourceId)
        .sort(),
    ).toEqual(["exact", "separated"]);
    expect(ftsQuery('"Bryan Bucks" model')).toBe('"bryan bucks" AND "model"*');
    expect(ftsQuery('"foo.bar"')).toBe('"foo bar"');
    expect(
      index
        .search('"foo.bar"', { since: null, source: null })
        .map((match) => match.sourceId),
    ).toEqual(["punctuated"]);
    expect(
      index
        .search("cafe", { since: null, source: null })
        .map((match) => match.sourceId),
    ).toEqual(["accented"]);
    index.close();
  });

  test("loads every same-prompt sibling without applying the FTS query", async () => {
    const paths = await runtime();
    const index = await HistoryIndex.open(paths);
    await index.ingest([
      result([
        document("matching", {
          dialogue: "later dialogue contains the retrieval term",
          createdAt: "2026-08-01T00:10:00.000Z",
          promptHash: "shared-prompt",
        }),
        document("sibling", {
          dialogue: "the parallel branch took another direction",
          createdAt: "2026-08-01T00:00:00.000Z",
          promptHash: "shared-prompt",
        }),
      ]),
    ]);

    expect(
      index.search("retrieval", { since: null, source: null }),
    ).toHaveLength(1);
    expect(
      index
        .recent({
          since: null,
          source: null,
          openingPromptHash: "shared-prompt",
        })
        .map((match) => match.sourceId)
        .sort(),
    ).toEqual(["matching", "sibling"]);
    index.close();
  });

  test("paginates ranked rows after filtering current runtimes", async () => {
    const paths = await runtime();
    const index = await HistoryIndex.open(paths);
    await index.ingest([
      result([
        document("oldest", {
          dialogue: "bounded history match",
          createdAt: "2026-08-01T00:00:00.000Z",
        }),
        document("middle", {
          dialogue: "bounded history match",
          createdAt: "2026-08-02T00:00:00.000Z",
        }),
        document("current", {
          dialogue: "bounded history match",
          createdAt: "2026-08-03T00:00:00.000Z",
        }),
      ]),
    ]);

    const options = {
      since: null,
      source: null,
      excludedRuntimes: [
        { source: "conductor" as const, runtimeId: "current" },
      ],
      limit: 1,
      offset: 1,
    };
    expect(
      index.search("bounded", options).map((match) => match.sourceId),
    ).toEqual(["oldest"]);
    expect(index.recent(options).map((match) => match.sourceId)).toEqual([
      "oldest",
    ]);
    index.close();
  });
});

describe("history read snapshots", () => {
  test("holds one read snapshot across paged queries", async () => {
    const paths = await runtime();
    const writer = await HistoryIndex.open(paths);
    await writer.ingest([
      result([
        document("oldest", {
          createdAt: "2026-08-01T00:00:00.000Z",
        }),
        document("middle", {
          createdAt: "2026-08-02T00:00:00.000Z",
        }),
        document("newest", {
          createdAt: "2026-08-03T00:00:00.000Z",
        }),
      ]),
    ]);
    writer.close();

    const reader = await HistoryIndex.open(paths, true);
    const concurrentWriter = new Database(paths.indexDb, { strict: true });
    const observed = reader.readSnapshot(() => {
      const first = reader.recent({
        since: null,
        source: null,
        limit: 1,
        offset: 0,
      });
      concurrentWriter.run(
        "UPDATE documents SET updated_at = ? WHERE source_id = ?",
        ["2026-08-04T00:00:00.000Z", "oldest"],
      );
      const second = reader.recent({
        since: null,
        source: null,
        limit: 1,
        offset: 1,
      });
      return [...first, ...second].map((record) => record.sourceId);
    });

    expect(observed).toEqual(["newest", "middle"]);
    expect(
      reader
        .recent({ since: null, source: null, limit: 1, offset: 0 })
        .map((record) => record.sourceId),
    ).toEqual(["oldest"]);
    concurrentWriter.close();
    reader.close();
  });
});

describe("history BM25 index", () => {
  test("scopes runtime exclusions to their owning source", async () => {
    const paths = await runtime();
    const index = await HistoryIndex.open(paths);
    await index.ingest([
      result([
        document("conductor-current", {
          dialogue: "shared runtime collision",
          runtimeId: "shared-runtime",
        }),
      ]),
      result(
        [
          document("codex-unrelated", {
            dialogue: "shared runtime collision",
            runtimeId: "shared-runtime",
            source: "codex",
          }),
        ],
        "codex",
      ),
    ]);
    const options = {
      since: null,
      source: null,
      excludedRuntimes: [
        { source: "conductor" as const, runtimeId: "shared-runtime" },
      ],
    };

    expect(
      index.search("collision", options).map((row) => row.sourceId),
    ).toEqual(["codex-unrelated"]);
    expect(index.recent(options).map((row) => row.sourceId)).toEqual([
      "codex-unrelated",
    ]);
    index.close();
  });
});

describe("history index rebuilds", () => {
  test("force reindex rebuilds the derived corpus", async () => {
    const paths = await runtime();
    const index = await HistoryIndex.open(paths);
    await index.ingest([
      result([
        document("removed", { dialogue: "old derived row" }),
        document("retained", { dialogue: "retained conversation" }),
      ]),
    ]);

    await index.ingest(
      [result([document("retained", { dialogue: "retained conversation" })])],
      true,
    );

    expect(index.search("retained", { since: null, source: null })).toEqual([
      expect.objectContaining({ id: 1, sourceId: "retained" }),
    ]);
    expect(index.search("derived", { since: null, source: null })).toEqual([]);
    index.close();
  });

  test("retries a source after a forced reindex scan fails", async () => {
    const paths = await runtime();
    const index = await HistoryIndex.open(paths);
    await index.ingest(
      [
        {
          source: "conductor",
          available: false,
          documents: [],
          fingerprint: "unchanged-source",
          error: "fixture database could not be read",
        },
      ],
      true,
    );

    await index.ingest([
      {
        ...result([
          document("recovered", { dialogue: "recovered history record" }),
        ]),
        fingerprint: "unchanged-source",
      },
    ]);

    expect(index.search("recovered", { since: null, source: null })).toEqual([
      expect.objectContaining({ sourceId: "recovered" }),
    ]);
    index.close();
  });

  test("rebuilds an older derived index and secures private files", async () => {
    const paths = await runtime();
    await mkdir(paths.historyDir, { recursive: true, mode: 0o755 });
    const old = new Database(paths.indexDb);
    old.run(
      "CREATE TABLE documents (id INTEGER PRIMARY KEY, body TEXT); PRAGMA user_version = 1;",
    );
    old.close();

    const index = await HistoryIndex.open(paths);
    await index.ingest([
      result([document("rebuilt", { dialogue: "schema rebuild succeeded" })]),
    ]);
    expect(index.search("schema", { since: null, source: null })).toHaveLength(
      1,
    );
    index.close();

    const directoryInfo = await stat(paths.historyDir);
    const indexInfo = await stat(paths.indexDb);
    const directoryMode = directoryInfo.mode & 0o777;
    const indexMode = indexInfo.mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(indexMode).toBe(0o600);
  });

  test("preserves the older index when an atomic schema rebuild fails", async () => {
    const paths = await runtime();
    await mkdir(paths.historyDir, { recursive: true });
    const old = new Database(paths.indexDb);
    old.run(`
      CREATE TABLE documents (id INTEGER PRIMARY KEY, body TEXT);
      INSERT INTO documents (body) VALUES ('preserved derived row');
      CREATE TABLE history_fts (body TEXT);
      INSERT INTO history_fts (body) VALUES ('preserved search row');
      CREATE VIEW source_state AS SELECT 1 AS available;
      PRAGMA user_version = 1;
    `);
    old.close();

    await expect(HistoryIndex.open(paths)).rejects.toThrow();

    const preserved = new Database(paths.indexDb, { readonly: true });
    expect(preserved.query("SELECT body FROM documents").get()).toEqual({
      body: "preserved derived row",
    });
    expect(preserved.query("SELECT body FROM history_fts").get()).toEqual({
      body: "preserved search row",
    });
    expect(preserved.query("PRAGMA user_version").get()).toEqual({
      user_version: 1,
    });
    preserved.close();
  });
});
