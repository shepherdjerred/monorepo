import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { PrismaClient } from "#generated/prisma/client.ts";
import { createFeedsPrismaClient } from "@shepherdjerred/feeds/server/postgres/sql.ts";
import { PostgresFeedsStore } from "@shepherdjerred/feeds/server/postgres/store.ts";
import { asyncFeedsRepository } from "@shepherdjerred/feeds/server/sqlite-repository.ts";
import { SAMPLE_CATALOG } from "@shepherdjerred/feeds/server/contract/support.ts";
import { FeedsStore } from "@shepherdjerred/feeds/server/store.ts";
import { createMigratedTestDatabase } from "@shepherdjerred/feeds/server/postgres/test-database.ts";
import { importSqliteIntoPostgres } from "./import-sqlite.ts";
import {
  copySqliteToPostgres,
  openSqliteSnapshot,
  STORAGE_CUTOVER_KEY,
} from "./sqlite-to-postgres.ts";
import { verifySqliteImport } from "./verify-sqlite-import.ts";

let workDir = "";
let sqlitePath = "";
let databaseUrl = "";
let dropDatabase: (() => Promise<void>) | undefined;
let prisma: PrismaClient | undefined;

function requirePrisma(): PrismaClient {
  if (prisma === undefined) {
    throw new Error("PostgreSQL test database was not initialized");
  }
  return prisma;
}

/** A SQLite file shaped like production: catalog, user feeds, reads, stars. */
function seedSqlite(file: string): void {
  const store = FeedsStore.open(file);
  try {
    store.reconcileCatalog(SAMPLE_CATALOG);
    const doomed = store.createUserFeed({
      url: "https://deleted.example/rss",
      category: "Scratch",
      hidden: false,
    });
    const lwn = store.createUserFeed({
      url: "https://lwn.net/headlines/newrss?token=subscriber-secret",
      title: "LWN",
      category: "Security",
      hidden: true,
    });
    if (!doomed.ok || !lwn.ok) {
      throw new Error("Expected user feeds");
    }
    for (const [index, feed] of store.listAllFeeds().entries()) {
      store.recordPollSuccess({
        feedId: feed.id,
        polledAtSeconds: 1_720_000_000 + index,
        etag: `"etag-${String(index)}"`,
        lastModified: null,
        entries: Array.from({ length: 30 }, (_unused, n) => ({
          guid: `${String(feed.id)}-${String(n)}`,
          url: `https://example.org/${String(feed.id)}/${String(n)}`,
          title: `Release v${String(n)}.2.${String(index)} notes: café résumé ${feed.title}`,
          author: n % 3 === 0 ? "Zoë Ångström" : `Author ${String(n)}`,
          contentHtml: `<p>${"body ".repeat(n)}</p>`,
          publishedAt: 1_719_000_000 + n * 3600,
          enclosures:
            n % 7 === 0
              ? [
                  {
                    href: `https://example.org/${String(n)}.mp3`,
                    type: "audio/mpeg",
                  },
                ]
              : [],
          categories: n % 2 === 0 ? ["Release"] : ["News"],
        })),
      });
    }
    store.recordPollFailure({
      feedId: lwn.feed.id,
      polledAtSeconds: 1_720_100_000,
      status: 503,
      errorMessage: "HTTP 503",
      nextPollAfterSeconds: 1_720_103_600,
    });
    const page = store.queryEntries({ view: "all", limit: 40 });
    store.editEntryTags({
      ids: page.items.slice(0, 10).map((item) => item.id),
      markStarred: true,
    });
    store.editEntryTags({
      ids: page.items.slice(5, 25).map((item) => item.id),
      markRead: true,
    });
    store.createReaderSession({
      tokenSha256: "a".repeat(64),
      username: "sjerred",
      nowSeconds: 1_720_000_000,
      ttlSeconds: 86_400,
    });
    store.deleteUserFeed(doomed.feed.id);
  } finally {
    store.close();
  }
}

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "feeds-import-"));
  sqlitePath = path.join(workDir, "feeds.sqlite");
  seedSqlite(sqlitePath);
  const database = await createMigratedTestDatabase();
  databaseUrl = database.databaseUrl;
  dropDatabase = database.drop;
  prisma = createFeedsPrismaClient(databaseUrl);
});

afterAll(async () => {
  if (prisma !== undefined) {
    await prisma.$disconnect();
  }
  await dropDatabase?.();
  if (workDir !== "") {
    await rm(workDir, { recursive: true, force: true });
  }
});

describe("SQLite to PostgreSQL import", () => {
  test("a rehearsal copies every row and passes every gate", async () => {
    const outcome = await importSqliteIntoPostgres({
      from: sqlitePath,
      databaseUrl,
      cutover: false,
    });
    if (outcome.status !== "verified") {
      throw new Error(`Rehearsal did not verify: ${JSON.stringify(outcome)}`);
    }
    const { report } = outcome;
    expect(report.tables).toEqual([
      { table: "meta", sqlite: 1, postgres: 1, rowsEqual: true },
      { table: "categories", sqlite: 6, postgres: 6, rowsEqual: true },
      { table: "feeds", sqlite: 5, postgres: 5, rowsEqual: true },
      { table: "entries", sqlite: 150, postgres: 150, rowsEqual: true },
      { table: "reader_sessions", sqlite: 1, postgres: 1, rowsEqual: true },
    ]);
    expect(report.readPaths.mismatches).toEqual([]);
    expect(report.readPaths.checks).toBeGreaterThan(50);
    expect(report.search.mismatches).toEqual([]);
    expect(report.search.queriesWithMatches).toBeGreaterThan(5);
    expect(report.search.tokenizedFields).toBe(300);
    expect(JSON.stringify(outcome)).not.toContain("subscriber-secret");
  });

  test("PostgreSQL never reuses the ID of a feed SQLite deleted", async () => {
    const store = await PostgresFeedsStore.fromClient(requirePrisma());
    const created = await store.createUserFeed({
      url: "https://new.example/rss",
      category: "Security",
      hidden: false,
    });
    expect(created.ok && created.feed.id).toBe(7);
  });

  test("the verifier reports a row that differs", async () => {
    const db = requirePrisma();
    const snapshot = openSqliteSnapshot(sqlitePath);
    try {
      await copySqliteToPostgres(snapshot, db);
      const victim = await db.entry.findFirstOrThrow({
        orderBy: { id: "asc" },
      });
      await db.entry.update({
        where: { id: victim.id },
        data: { title: "tampered" },
      });
      const report = await verifySqliteImport({
        snapshot,
        sqlite: asyncFeedsRepository(snapshot.store),
        postgres: await PostgresFeedsStore.fromClient(db),
        prisma: db,
      });
      expect(report.ok).toBe(false);
      expect(
        report.tables.find((table) => table.table === "entries")?.rowsEqual,
      ).toBe(false);
      expect(report.readPaths.mismatches.length).toBeGreaterThan(0);
    } finally {
      snapshot.release();
    }
  });

  test("cutover writes the marker once and then leaves PostgreSQL alone", async () => {
    const first = await importSqliteIntoPostgres({
      from: sqlitePath,
      databaseUrl,
      cutover: true,
      now: () => new Date("2026-11-28T00:00:00Z"),
    });
    expect(first.status).toBe("cut-over");
    const marker = await requirePrisma().meta.findUnique({
      where: { key: STORAGE_CUTOVER_KEY },
    });
    expect(JSON.parse(marker?.value ?? "{}")).toEqual({
      completedAt: "2026-11-28T00:00:00.000Z",
      rows: {
        meta: 1,
        categories: 6,
        feeds: 5,
        entries: 150,
        reader_sessions: 1,
      },
    });

    await requirePrisma().entry.updateMany({ data: { isRead: true } });
    const again = await importSqliteIntoPostgres({
      from: sqlitePath,
      databaseUrl,
      cutover: true,
    });
    expect(again.status).toBe("already-cut-over");
    expect(
      await requirePrisma().entry.count({ where: { isRead: false } }),
    ).toBe(0);

    const rehearsal = await importSqliteIntoPostgres({
      from: sqlitePath,
      databaseUrl,
      cutover: false,
    });
    expect(rehearsal.status).toBe("refused");
  });
});
