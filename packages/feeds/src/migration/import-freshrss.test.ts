import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { FeedsStore } from "@shepherdjerred/feeds/server/store.ts";
import {
  importFromFreshRssSqlite,
  normalizeFreshRssAuthor,
  parseFreshRssAttributesEnclosures,
} from "./import-freshrss.ts";

const FRESHRSS_DDL = `
  CREATE TABLE IF NOT EXISTS category (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name VARCHAR(255) NOT NULL,
    kind SMALLINT DEFAULT 0,
    lastUpdate INT(11) DEFAULT 0,
    error SMALLINT DEFAULT 0,
    attributes TEXT,
    UNIQUE (name)
  );

  CREATE TABLE IF NOT EXISTS feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    url VARCHAR(32768) NOT NULL,
    kind SMALLINT DEFAULT 0,
    category SMALLINT DEFAULT 0,
    name VARCHAR(255) NOT NULL,
    website VARCHAR(32768),
    description TEXT,
    lastUpdate INT(11) DEFAULT 0,
    priority TINYINT(2) NOT NULL DEFAULT 10,
    pathEntries VARCHAR(4096) DEFAULT NULL,
    httpAuth VARCHAR(1024) DEFAULT NULL,
    error BOOLEAN DEFAULT 0,
    keep_history MEDIUMINT NOT NULL DEFAULT -2,
    ttl INT NOT NULL DEFAULT 0,
    attributes TEXT,
    cache_nbEntries INT DEFAULT 0,
    cache_nbUnreads INT DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS entry (
    id BIGINT NOT NULL,
    guid VARCHAR(767) NOT NULL,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(1024),
    content TEXT,
    link VARCHAR(16383) NOT NULL,
    date INT(11),
    lastSeen INT(11) DEFAULT 0,
    hash BLOB,
    is_read BOOLEAN NOT NULL DEFAULT 0,
    is_favorite BOOLEAN NOT NULL DEFAULT 0,
    id_feed SMALLINT,
    tags VARCHAR(1024),
    attributes TEXT,
    PRIMARY KEY (id),
    FOREIGN KEY (id_feed) REFERENCES feed(id) ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE (id_feed, guid)
  );
`;

function createSampleFreshRssSnapshot(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.run(FRESHRSS_DDL);
    db.run(`
      INSERT INTO category (id, name) VALUES
        (1, 'Uncategorized'),
        (2, 'Repo Stack'),
        (3, 'Subscriber Feeds');
    `);
    db.run(`
      INSERT INTO feed (id, url, category, name, website, description, priority) VALUES
        (10, 'https://go.dev/blog/feed.atom', 2, 'Go Blog', 'https://go.dev/blog/', NULL, 10),
        (11, 'https://github.com/FreshRSS/FreshRSS/releases.atom', 2, 'FreshRSS Releases', 'https://github.com/FreshRSS/FreshRSS/releases', NULL, 10),
        (12, 'https://lwn.net/headlines/newrss?token=secret', 3, 'LWN.net', 'https://lwn.net/', 'Linux Weekly News subscriber feed', 10),
        (13, 'https://internal.example.com/noisy.xml', 1, 'Noisy Feed', 'https://internal.example.com/', NULL, 0);
    `);
    db.run(`
      INSERT INTO entry (
        id, guid, title, author, content, link, date, lastSeen, is_read, is_favorite, id_feed, attributes
      ) VALUES
        (
          1795569203477068,
          'https://go.dev/blog/go1.27',
          'Go 1.27 is released',
          ';Junyang Shao; on behalf of the Go team',
          '<p>Go 1.27 release notes</p>',
          'https://go.dev/blog/go1.27',
          1795569200,
          1795569203,
          0,
          1,
          10,
          '{"enclosures":[{"url":"https://go.dev/dl/go1.27.src.tar.gz","type":"application/gzip","length":28000000}]}'
        ),
        (
          1795569203477099,
          'freshrss-release-1',
          'FreshRSS 1.25.0',
          ';FreshRSS',
          '<p>Retired feed entry</p>',
          'https://github.com/FreshRSS/FreshRSS/releases/tag/1.25.0',
          1795569210,
          1795569211,
          0,
          0,
          11,
          NULL
        ),
        (
          1795569203477120,
          'https://lwn.net/Articles/999999/',
          'Kernel memory management deep dive',
          ';Jonathan Corbet;',
          '<p>Subscriber article content</p>',
          'https://lwn.net/Articles/999999/',
          1795569300,
          1795569305,
          1,
          0,
          12,
          '{}'
        );
    `);
  } finally {
    db.close();
  }
}

describe("FreshRSS SQLite importer", () => {
  test("normalizes FreshRSS semicolon authors and attributes enclosures", () => {
    expect(
      normalizeFreshRssAuthor(";Junyang Shao; on behalf of the Go team"),
    ).toBe("Junyang Shao, on behalf of the Go team");
    expect(normalizeFreshRssAuthor(";Jonathan Corbet;")).toBe(
      "Jonathan Corbet",
    );
    expect(normalizeFreshRssAuthor("")).toBe("");
    expect(normalizeFreshRssAuthor(null)).toBe("");

    expect(
      parseFreshRssAttributesEnclosures(
        JSON.stringify({
          enclosures: [
            {
              url: "https://example.com/episode.mp3",
              mime: "audio/mpeg",
              length: "12345",
            },
          ],
        }),
      ),
    ).toEqual([
      {
        href: "https://example.com/episode.mp3",
        type: "audio/mpeg",
        length: 12_345,
      },
    ]);
    expect(parseFreshRssAttributesEnclosures("not-json")).toEqual([]);
  });

  test("maps code feeds, imports private user feeds, skips FreshRSS Releases, preserves microsecond IDs, and runs idempotently", async () => {
    const dir = path.join(
      tmpdir(),
      `feeds-freshrss-test-${String(Date.now())}`,
    );
    await Bun.write(path.join(dir, ".keep"), "");
    const snapshotPath = path.join(dir, "freshrss.sqlite");
    createSampleFreshRssSnapshot(snapshotPath);

    const store = FeedsStore.open(":memory:");
    try {
      store.reconcileCatalog();

      const firstSummary = importFromFreshRssSqlite({
        fromPath: snapshotPath,
        store,
      });
      expect(firstSummary).toEqual({
        mappedCodeFeeds: 1,
        importedUserFeeds: 2,
        skippedRetiredFeeds: 1,
        importedEntries: 2,
        unreadEntries: 1,
        starredEntries: 1,
      });

      // Private LWN feed preserved with source = 'user' and exact subscriber URL
      const lwn = store.getFeedByUrl(
        "https://lwn.net/headlines/newrss?token=secret",
      );
      expect(lwn).toBeDefined();
      expect(lwn?.source).toBe("user");
      expect(lwn?.categoryLabel).toBe("Subscriber Feeds");
      expect(lwn?.description).toBe("Linux Weekly News subscriber feed");
      expect(lwn?.hidden).toBe(false);

      // Priority < 10 mapped to hidden: true
      const noisy = store.getFeedByUrl(
        "https://internal.example.com/noisy.xml",
      );
      expect(noisy?.source).toBe("user");
      expect(noisy?.hidden).toBe(true);

      // Retired FreshRSS Releases feed was not imported
      expect(
        store.getFeedByUrl(
          "https://github.com/FreshRSS/FreshRSS/releases.atom",
        ),
      ).toBeUndefined();

      // Exact microsecond ID, normalized author, read/star state, enclosures, and FTS5 index preserved
      const goEntry = store.getEntriesByIds([1_795_569_203_477_068])[0];
      expect(goEntry).toBeDefined();
      expect(goEntry?.title).toBe("Go 1.27 is released");
      expect(goEntry?.author).toBe("Junyang Shao, on behalf of the Go team");
      expect(goEntry?.isRead).toBe(false);
      expect(goEntry?.isStarred).toBe(true);
      expect(goEntry?.enclosures).toEqual([
        {
          href: "https://go.dev/dl/go1.27.src.tar.gz",
          type: "application/gzip",
          length: 28_000_000,
        },
      ]);

      expect(
        store.queryEntries({ view: "all", q: "Junyang Shao" }).items,
      ).toHaveLength(1);

      // Idempotent re-run updates existing entries in place without duplicating feeds or entries
      const secondSummary = importFromFreshRssSqlite({
        fromPath: snapshotPath,
        store,
      });
      expect(secondSummary).toEqual(firstSummary);
      expect(store.queryEntries({ view: "all" }).totalMatching).toBe(2);

      // Subsequent poll allocates ID strictly greater than imported microsecond IDs
      const goFeed = store.getFeedByUrl("https://go.dev/blog/feed.atom");
      if (goFeed === undefined) {
        throw new Error("Expected Go feed");
      }
      store.recordPollSuccess({
        feedId: goFeed.id,
        polledAtSeconds: 1_700_000_000,
        etag: null,
        lastModified: null,
        entries: [
          {
            guid: "post-after-migration",
            url: "https://go.dev/blog/next",
            title: "Next Go Post",
            author: "Go Team",
            contentHtml: "<p>Next</p>",
            publishedAt: 1_700_000_000,
            enclosures: [],
          },
        ],
      });
      const newest = store.queryEntries({ view: "all", limit: 1 }).items[0];
      expect(newest?.id).toBeGreaterThan(1_795_569_203_477_120);
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("CLI prints summary JSON only and never leaks feed URLs or secret tokens", async () => {
    const dir = path.join(tmpdir(), `feeds-freshrss-cli-${String(Date.now())}`);
    await Bun.write(path.join(dir, ".keep"), "");
    const snapshotPath = path.join(dir, "freshrss.sqlite");
    const targetPath = path.join(dir, "feeds.sqlite");
    createSampleFreshRssSnapshot(snapshotPath);

    try {
      const cliPath = path.join(import.meta.dirname, "import-freshrss.ts");
      const proc = Bun.spawn(
        ["bun", cliPath, "--from", snapshotPath, "--to", targetPath],
        {
          cwd: path.join(import.meta.dirname, "../.."),
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).not.toContain("lwn.net");
      expect(stdout).not.toContain("secret");
      expect(JSON.parse(stdout.trim())).toEqual({
        mappedCodeFeeds: 1,
        importedUserFeeds: 2,
        skippedRetiredFeeds: 1,
        importedEntries: 2,
        unreadEntries: 1,
        starredEntries: 1,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
