import { Database } from "bun:sqlite";

export const DESKTOP_RETIREMENT_TABLES = [
  "ApiToken",
  "DesktopClient",
  "SoundPack",
  "StoredSound",
  "GameEventLog",
] as const;

export type DesktopRetirementTable = (typeof DESKTOP_RETIREMENT_TABLES)[number];

export type DesktopRetirementCounts = Record<DesktopRetirementTable, number>;

export type DesktopRetirementManifest = {
  manifestVersion: 1;
  postgres: DesktopRetirementCounts;
  postgresIdentityDigests: DesktopRetirementIdentityDigests;
  legacySqlite: DesktopRetirementCounts;
  legacySqlitePreflightDigest: string;
  storedSoundObjects: {
    count: number;
    keyDigest: string;
  };
  manifestDigest: string;
};

export type DesktopRetirementIdentityDigests = Record<
  DesktopRetirementTable,
  string
>;

type ManifestInput = {
  postgres: DesktopRetirementCounts;
  postgresIdentityDigests: DesktopRetirementIdentityDigests;
  legacySqlite: DesktopRetirementCounts;
  legacySqlitePreflightDigest: string;
};

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function toSafeCount(value: unknown, table: DesktopRetirementTable): number {
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new TypeError(`Unexpected count type for legacy SQLite ${table}`);
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`Invalid count for legacy SQLite ${table}`);
  }
  return count;
}

function countLegacyTable(db: Database, table: DesktopRetirementTable): number {
  const row: unknown = db
    .query(`SELECT COUNT(*) AS count FROM "${table}"`)
    .get();
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new TypeError(`Unexpected count result for legacy SQLite ${table}`);
  }
  return toSafeCount(Reflect.get(row, "count"), table);
}

/**
 * Read only the desktop-retirement table counts from the retained SQLite
 * snapshot. A missing table is a hard failure: the subsequent destructive
 * release must never treat an incomplete inventory as an empty one.
 */
export function readLegacyDesktopRetirementCounts(
  sqlitePath: string,
): DesktopRetirementCounts {
  const db = new Database(sqlitePath, { readonly: true, safeIntegers: true });
  try {
    return {
      ApiToken: countLegacyTable(db, "ApiToken"),
      DesktopClient: countLegacyTable(db, "DesktopClient"),
      SoundPack: countLegacyTable(db, "SoundPack"),
      StoredSound: countLegacyTable(db, "StoredSound"),
      GameEventLog: countLegacyTable(db, "GameEventLog"),
    };
  } finally {
    db.close();
  }
}

/**
 * Hash object keys without emitting them. Object keys can encode user-owned
 * filenames, so the preflight manifest records only a deterministic digest.
 */
export function storedSoundKeyDigest(keys: readonly string[]): string {
  const sorted = [...keys].sort();
  const hasher = new Bun.CryptoHasher("sha256");
  for (const key of sorted) {
    hasher.update(`${key}\u{0}`);
  }
  return hasher.digest("hex");
}

/**
 * Hash the complete primary-key candidate set without emitting record
 * identities. Counts alone cannot detect a record being replaced between the
 * review preflight and the separately approved destructive release.
 */
export function desktopRetirementIdentityDigest(
  ids: readonly number[],
): string {
  const sorted = [...ids].sort((left, right) => left - right);
  const hasher = new Bun.CryptoHasher("sha256");
  for (const id of sorted) {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new RangeError("Invalid PostgreSQL desktop retirement record ID");
    }
    hasher.update(`${String(id)}\u{0}`);
  }
  return hasher.digest("hex");
}

/**
 * Produce the approval artifact consumed by the later destructive release.
 * Its digest includes both database inventories and the object-key set, but
 * no API token values, token hashes, or object keys are printed or persisted.
 */
export function createDesktopRetirementManifest(
  input: ManifestInput & {
    storedSoundKeys: readonly string[];
  },
): DesktopRetirementManifest {
  const storedSoundObjects = {
    count: input.storedSoundKeys.length,
    keyDigest: storedSoundKeyDigest(input.storedSoundKeys),
  };
  if (storedSoundObjects.count !== input.postgres.StoredSound) {
    throw new Error(
      "StoredSound key inventory does not match the PostgreSQL StoredSound count",
    );
  }
  const manifest: Omit<DesktopRetirementManifest, "manifestDigest"> = {
    manifestVersion: 1,
    postgres: input.postgres,
    postgresIdentityDigests: input.postgresIdentityDigests,
    legacySqlite: input.legacySqlite,
    legacySqlitePreflightDigest: input.legacySqlitePreflightDigest,
    storedSoundObjects,
  };
  return {
    ...manifest,
    manifestDigest: sha256(JSON.stringify(manifest)),
  };
}
