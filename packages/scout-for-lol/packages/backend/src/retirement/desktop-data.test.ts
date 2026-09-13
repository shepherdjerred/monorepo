import { describe, expect, test } from "vitest";
import {
  createDesktopRetirementManifest,
  desktopRetirementIdentityDigest,
  readLegacyDesktopRetirementCounts,
  storedSoundKeyDigest,
} from "#src/retirement/desktop-data.ts";
import { legacySqlitePreflightDigest } from "#src/database/legacy-import/sqlite-source-digest.ts";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";

const COUNTS = {
  ApiToken: 1,
  DesktopClient: 2,
  SoundPack: 3,
  StoredSound: 2,
  GameEventLog: 5,
};

describe("Scout desktop retirement preflight", () => {
  test("hashes object keys independent of database result order", () => {
    expect(storedSoundKeyDigest(["sounds/b", "sounds/a"])).toBe(
      storedSoundKeyDigest(["sounds/a", "sounds/b"]),
    );
  });

  test("hashes the complete PostgreSQL candidate set independent of query order", () => {
    expect(desktopRetirementIdentityDigest([3, 1, 2])).toBe(
      desktopRetirementIdentityDigest([1, 2, 3]),
    );
    expect(desktopRetirementIdentityDigest([1, 2, 3])).not.toBe(
      desktopRetirementIdentityDigest([1, 2, 4]),
    );
  });

  test("creates a deterministic manifest without exposing object keys", () => {
    const input = {
      postgres: COUNTS,
      postgresIdentityDigests: {
        ApiToken: desktopRetirementIdentityDigest([1]),
        DesktopClient: desktopRetirementIdentityDigest([1, 2]),
        SoundPack: desktopRetirementIdentityDigest([1, 2, 3]),
        StoredSound: desktopRetirementIdentityDigest([1, 2]),
        GameEventLog: desktopRetirementIdentityDigest([1, 2, 3, 4, 5]),
      },
      legacySqlite: COUNTS,
      legacySqlitePreflightDigest: "a".repeat(64),
      storedSoundKeys: ["sounds/b", "sounds/a"],
    };

    const first = createDesktopRetirementManifest(input);
    const second = createDesktopRetirementManifest({
      ...input,
      storedSoundKeys: [...input.storedSoundKeys].reverse(),
    });

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain("sounds/a");
    expect(JSON.stringify(first)).not.toContain("sounds/b");
  });

  test("reads every retired table from SQLite without modifying the source", async () => {
    const sqlitePath = `${tmpdir()}/scout-desktop-retirement-${crypto.randomUUID()}.sqlite`;
    const db = new Database(sqlitePath);
    try {
      for (const [table, count] of Object.entries(COUNTS)) {
        db.run(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY)`);
        for (let index = 0; index < count; index++) {
          db.run(`INSERT INTO "${table}" (id) VALUES (?)`, [index + 1]);
        }
      }
    } finally {
      db.close();
    }

    try {
      const before = Bun.file(sqlitePath).size;
      expect(readLegacyDesktopRetirementCounts(sqlitePath)).toEqual(COUNTS);
      expect(legacySqlitePreflightDigest(sqlitePath)).toMatch(/^[a-f\d]{64}$/);
      expect(Bun.file(sqlitePath).size).toBe(before);
    } finally {
      await Bun.file(sqlitePath).delete();
    }
  });
});
