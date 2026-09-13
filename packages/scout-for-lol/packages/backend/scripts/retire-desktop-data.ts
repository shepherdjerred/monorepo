#!/usr/bin/env bun
/**
 * Read-only first release of the Scout desktop retirement.
 *
 * It inventories the PostgreSQL records, the retained SQLite rollback source,
 * and the StoredSound object-key set. The command deliberately has no S3
 * client and performs no mutation. Its JSON output is the exact manifest that
 * the later, separately reviewed destructive release must verify.
 */
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "#generated/prisma/client/index.js";
import {
  createDesktopRetirementManifest,
  createDesktopRetirementIdentityDigest,
  createStoredSoundKeyDigest,
  readLegacyDesktopRetirementCounts,
} from "#src/retirement/desktop-data.ts";
import { legacySqlitePreflightDigest } from "#src/database/legacy-import/sqlite-source-digest.ts";

const ArgumentsSchema = z.object({ preflight: z.literal(true) }).strict();
const EnvironmentSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    LEGACY_SQLITE_PATH: z.string().min(1),
  })
  .strict();
const PAGE_SIZE = 1000;

type PostgresRetirementInventory = {
  count: number;
  identityDigest: string;
};

type StoredSoundObjectInventory = {
  count: number;
  keyDigest: string;
};

function parseArguments(argv: string[]): z.infer<typeof ArgumentsSchema> {
  if (argv.length !== 1 || argv[0] !== "--preflight") {
    throw new Error("Expected exactly: --preflight");
  }
  return ArgumentsSchema.parse({ preflight: true });
}

function parseEnvironment(): z.infer<typeof EnvironmentSchema> {
  return EnvironmentSchema.parse({
    DATABASE_URL: Bun.env["DATABASE_URL"],
    LEGACY_SQLITE_PATH: Bun.env["LEGACY_SQLITE_PATH"],
  });
}

async function scanPostgresRetirementIds(
  findPage: (cursor: number | undefined) => Promise<readonly { id: number }[]>,
): Promise<PostgresRetirementInventory> {
  const digest = createDesktopRetirementIdentityDigest();
  let count = 0;
  let cursor: number | undefined;
  for (;;) {
    const page = await findPage(cursor);
    if (page.length === 0) {
      return { count, identityDigest: digest.digest() };
    }
    for (const record of page) {
      digest.update(record.id);
      count += 1;
    }
    const last = page.at(-1);
    if (last === undefined) {
      throw new Error(
        "PostgreSQL retirement page unexpectedly had no last row",
      );
    }
    cursor = last.id;
  }
}

async function scanStoredSoundObjectKeys(
  findPage: (
    cursor: string | undefined,
  ) => Promise<readonly { s3Key: string }[]>,
): Promise<StoredSoundObjectInventory> {
  const digest = createStoredSoundKeyDigest();
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await findPage(cursor);
    if (page.length === 0) {
      return { count, keyDigest: digest.digest() };
    }
    for (const record of page) {
      digest.update(record.s3Key);
      count += 1;
    }
    const last = page.at(-1);
    if (last === undefined) {
      throw new Error("StoredSound page unexpectedly had no last row");
    }
    cursor = last.s3Key;
  }
}

parseArguments(Bun.argv.slice(2));
const environment = parseEnvironment();
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: environment.DATABASE_URL }),
});

try {
  const [
    apiTokens,
    desktopClients,
    soundPacks,
    storedSounds,
    gameEventLogs,
    storedSoundObjects,
  ] = await Promise.all([
    scanPostgresRetirementIds((cursor) =>
      prisma.apiToken.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      }),
    ),
    scanPostgresRetirementIds((cursor) =>
      prisma.desktopClient.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      }),
    ),
    scanPostgresRetirementIds((cursor) =>
      prisma.soundPack.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      }),
    ),
    scanPostgresRetirementIds((cursor) =>
      prisma.storedSound.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      }),
    ),
    scanPostgresRetirementIds((cursor) =>
      prisma.gameEventLog.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      }),
    ),
    scanStoredSoundObjectKeys((cursor) =>
      prisma.storedSound.findMany({
        select: { s3Key: true },
        orderBy: { s3Key: "asc" },
        take: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor: { s3Key: cursor }, skip: 1 }),
      }),
    ),
  ]);

  const manifest = createDesktopRetirementManifest({
    postgres: {
      ApiToken: apiTokens.count,
      DesktopClient: desktopClients.count,
      SoundPack: soundPacks.count,
      StoredSound: storedSounds.count,
      GameEventLog: gameEventLogs.count,
    },
    postgresIdentityDigests: {
      ApiToken: apiTokens.identityDigest,
      DesktopClient: desktopClients.identityDigest,
      SoundPack: soundPacks.identityDigest,
      StoredSound: storedSounds.identityDigest,
      GameEventLog: gameEventLogs.identityDigest,
    },
    legacySqlite: readLegacyDesktopRetirementCounts(
      environment.LEGACY_SQLITE_PATH,
    ),
    legacySqlitePreflightDigest: legacySqlitePreflightDigest(
      environment.LEGACY_SQLITE_PATH,
    ),
    storedSoundObjects,
  });
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
} finally {
  await prisma.$disconnect();
}
