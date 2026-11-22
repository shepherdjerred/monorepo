import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { readFrozenSeerr } from "./reader.ts";
import { requestRecord } from "#migration/capture/seerr-capture.ts";
import {
  recordDigest,
  validateCapture,
} from "#migration/capture/capture-validation.ts";
import { normalizeCapture } from "#migration/normalize.ts";

const source = {
  sourceInstanceId: "1".repeat(64),
  sourceVersion: "v3.5.0",
  writerStopped: true as const,
};
const secret = "PRIVATE_CONFIG_EMAIL_TOKEN_PASSWORD_SENTINEL";

function image(change?: (db: Database) => void) {
  const db = new Database(":memory:");
  try {
    db.run(`CREATE TABLE media_request (
        id INTEGER PRIMARY KEY, type TEXT, status INTEGER, mediaId INTEGER,
        requestedById INTEGER, rootFolder TEXT);
      CREATE TABLE media (id INTEGER PRIMARY KEY, tmdbId INTEGER, tvdbId INTEGER);
      CREATE TABLE user (id INTEGER PRIMARY KEY, plexId INTEGER, email TEXT,
        plexToken TEXT, password TEXT);
      CREATE TABLE season_request (id INTEGER PRIMARY KEY, requestId INTEGER,
        seasonNumber INTEGER, status INTEGER);
      CREATE TABLE private_configuration (value TEXT);`);
    db.query("INSERT INTO user VALUES (17, 1234567, ?, ?, ?)").run(
      secret,
      secret,
      secret,
    );
    db.query("INSERT INTO private_configuration VALUES (?)").run(secret);
    db.run("INSERT INTO media VALUES (30, 100, NULL), (31, 101, 555)");
    for (const status of [1, 2, 3, 4, 5])
      db.query("INSERT INTO media_request VALUES (?, ?, ?, ?, 17, ?)").run(
        40 + status,
        status === 5 ? "tv" : "movie",
        status,
        status === 5 ? 31 : 30,
        secret,
      );
    db.run(`INSERT INTO season_request VALUES
      (71, 45, 0, 2), (72, 45, 1, 3), (73, 45, 2, 5), (74, 45, 3, 4);`);
    change?.(db);
    return db.serialize();
  } finally {
    db.close();
  }
}

async function fixture(
  bytes: Uint8Array,
  run: (target: string) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "media-seerr-sqlite-"));
  try {
    const target = path.join(directory, "db.sqlite3");
    await Bun.write(target, bytes);
    await run(target);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function apiRecords(createdAt?: string) {
  return ([1, 2, 3, 4, 5] as const).map((status) =>
    requestRecord({
      id: 40 + status,
      type: status === 5 ? "tv" : "movie",
      status,
      requestedBy: { id: 17 },
      media: status === 5 ? { tmdbId: 101, tvdbId: 555 } : { tmdbId: 100 },
      createdAt,
      seasons:
        status === 5
          ? [
              { seasonNumber: 0, status: 2 },
              { seasonNumber: 1, status: 3 },
              { seasonNumber: 2, status: 5 },
              { seasonNumber: 3, status: 4 },
            ]
          : [],
    }),
  );
}

test("actual frozen tables retain all request statuses, genuine IDs and selected season statuses without exporting private columns", async () => {
  const bytes = image();
  await fixture(bytes, async (target) => {
    const result = await readFrozenSeerr(target, source);
    expect(validateCapture(result.snapshot)).toMatchObject({
      complete: true,
      stable: true,
    });
    expect(result.transport).toBe("frozen-sqlite");
    expect(result.sqliteDigest).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(result.snapshot.records).toHaveLength(5);
    expect(result.snapshot.records[0]).not.toHaveProperty("requestedAt");
    expect(
      result.snapshot.records.map((record) =>
        record.kind === "request"
          ? [record.sourceId, record.sourceStatus, record.active]
          : null,
      ),
    ).toEqual([
      ["41", 1, false],
      ["42", 2, true],
      ["43", 3, false],
      ["44", 4, false],
      ["45", 5, true],
    ]);
    expect(result.snapshot.records[4]).toMatchObject({
      requesterSourceId: "17",
      plexAccountId: "1234567",
      requesterMappingEvidenceHash: null,
      scope: "season",
      externalIds: { tmdb: 101, tvdb: 555 },
      seasons: [0, 2],
      seasonStatuses: [
        { season: 0, status: 2 },
        { season: 1, status: 3 },
        { season: 2, status: 5 },
        { season: 3, status: 4 },
      ],
    });
    expect(result.apiComparableDigest).toBe(recordDigest(apiRecords()));
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("rootFolder");
    expect(JSON.stringify(result)).not.toContain("email");
    const normalized = normalizeCapture(result.snapshot, { targets: [] });
    expect(normalized.entries).toHaveLength(5);
    expect(normalized.entries.every((entry) => !entry.owned)).toBe(true);
    expect(normalized.entries[0]?.reasons).toContain("requester_unmapped");
  });
});

test.each([
  ["2020-09-12 10:00:27", "2020-09-12T10:00:27.000Z"],
  ["2020-09-12 10:00:27.321", "2020-09-12T10:00:27.321Z"],
])(
  "frozen SQLite creation time %s agrees with the API timestamp",
  async (sqlite, iso) => {
    await fixture(
      image((db) => {
        db.run("ALTER TABLE media_request ADD COLUMN createdAt datetime");
        db.query("UPDATE media_request SET createdAt = ?").run(sqlite);
      }),
      async (target) => {
        const result = await readFrozenSeerr(target, source);
        expect(result.snapshot.records).toHaveLength(5);
        for (const record of result.snapshot.records)
          expect(record).toHaveProperty("requestedAt", iso);
        expect(result.apiComparableDigest).toBe(recordDigest(apiRecords(iso)));
      },
    );
  },
);

test("frozen SQLite preserves a request with an unknown creation time", async () => {
  await fixture(
    image((db) => {
      db.run("ALTER TABLE media_request ADD COLUMN createdAt datetime");
      db.run(
        "UPDATE media_request SET createdAt='2020-09-12 10:00:27' WHERE id=41",
      );
    }),
    async (target) => {
      const { snapshot } = await readFrozenSeerr(target, source);
      expect(snapshot.records).toHaveLength(5);
      expect(snapshot.records[0]).toHaveProperty(
        "requestedAt",
        "2020-09-12T10:00:27.000Z",
      );
      expect(snapshot.records[1]).not.toHaveProperty("requestedAt");
    },
  );
});

test.each([
  ["missing media", "DELETE FROM media WHERE id=31"],
  ["missing requester", "DELETE FROM user WHERE id=17"],
  ["null requester", "UPDATE media_request SET requestedById=NULL WHERE id=45"],
  ["non-positive Plex account ID", "UPDATE user SET plexId=0"],
  ["orphan season", "UPDATE season_request SET requestId=999 WHERE id=71"],
  ["duplicate season", "UPDATE season_request SET seasonNumber=0 WHERE id=72"],
  ["unknown request status", "UPDATE media_request SET status=6 WHERE id=45"],
  ["unknown season status", "UPDATE season_request SET status=6 WHERE id=71"],
  [
    "invalid creation time",
    "ALTER TABLE media_request ADD COLUMN createdAt datetime DEFAULT '2020-02-30 10:00:27'",
  ],
])(
  "%s protects the whole capture instead of dropping joined requests or inventing statuses",
  async (_reason, sql) => {
    await fixture(
      image((db) => db.run(sql)),
      async (target) => {
        await expect(readFrozenSeerr(target, source)).rejects.toThrow();
      },
    );
  },
);

test("duplicate Plex accounts across distinct requesters fail the frozen capture", async () => {
  await fixture(
    image((db) => {
      db.run("INSERT INTO user (id, plexId) VALUES (18, 1234567)");
      db.run("UPDATE media_request SET requestedById=18 WHERE id=45");
    }),
    async (target) => {
      await expect(readFrozenSeerr(target, source)).rejects.toThrow(
        "Frozen Plex account belongs to multiple requesters",
      );
    },
  );
});

test("file reader preserves original bytes, inode and nanosecond mtime and rejects any unapplied WAL", async () => {
  const bytes = image();
  await fixture(bytes, async (target) => {
    const before = await stat(target, { bigint: true });
    await readFrozenSeerr(target, source);
    const after = await stat(target, { bigint: true });
    expect([after.ino, after.mtimeNs, after.size]).toEqual([
      before.ino,
      before.mtimeNs,
      before.size,
    ]);
    expect(new Uint8Array(await Bun.file(target).arrayBuffer())).toEqual(
      new Uint8Array(bytes),
    );
    expect(await Bun.file(`${target}-wal`).exists()).toBe(false);
    expect(await Bun.file(`${target}-shm`).exists()).toBe(false);
    await Bun.write(`${target}-wal`, new Uint8Array([1]));
    await expect(readFrozenSeerr(target, source)).rejects.toThrow(
      "unapplied WAL",
    );
  });
});

test("empty or oversized images never become complete sources", async () => {
  await fixture(new Uint8Array(), async (target) => {
    await expect(readFrozenSeerr(target, source)).rejects.toThrow("bounded");
    await truncate(target, 256 * 1024 * 1024 + 1);
    await expect(readFrozenSeerr(target, source)).rejects.toThrow("bounded");
  });
});

test("a settled WAL-format image is read in private memory without altering the original header or provenance", async () => {
  const bytes = new Uint8Array(image());
  bytes[18] = 2;
  bytes[19] = 2;
  await fixture(bytes, async (target) => {
    const result = await readFrozenSeerr(target, source);
    expect(result.snapshot.records).toHaveLength(5);
    expect(result.sqliteDigest).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(new Uint8Array(await Bun.file(target).arrayBuffer())).toEqual(bytes);
  });
});

test("corrupt SQLite never receives complete capture evidence", async () => {
  await fixture(new Uint8Array([1, 2, 3]), async (target) => {
    await expect(readFrozenSeerr(target, source)).rejects.toThrow();
  });
});

test("absent Plex identity is preserved as unknown rather than manufacturing current Media binding", async () => {
  await fixture(
    image((db) => db.run("UPDATE user SET plexId=NULL")),
    async (target) => {
      const result = await readFrozenSeerr(target, source);
      expect(result.snapshot.records[0]).toMatchObject({
        plexAccountId: null,
        requesterMappingEvidenceHash: null,
      });
    },
  );
});

async function cli(target: string, stopped = true, version = "v3.5.0") {
  const child = Bun.spawn(
    [
      process.execPath,
      `${import.meta.dir}/../../../scripts/migration-seerr.ts`,
      "--sqlite",
      target,
      "--source-instance-id",
      source.sourceInstanceId,
      "--source-version",
      version,
      ...(stopped ? ["--writer-stopped"] : []),
    ],
    { cwd: `${import.meta.dir}/../../..`, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("actual CLI requires stopped-writer and exact-version evidence and exports only filtered capture/provenance", async () => {
  await fixture(image(), async (target) => {
    expect(await cli(target, false)).toMatchObject({ exitCode: 1, stdout: "" });
    expect(await cli(target, true, "unknown")).toMatchObject({
      exitCode: 1,
      stdout: "",
    });
    const result = await cli(target);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      transport: "frozen-sqlite",
      snapshot: {
        sourceKind: "seerr",
        records: [
          { sourceId: "41" },
          { sourceId: "42" },
          { sourceId: "43" },
          { sourceId: "44" },
          { sourceId: "45" },
        ],
      },
    });
    expect(result.stdout).not.toContain(secret);
  });
});
