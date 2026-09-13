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
  desktopRetirementIdentityDigest,
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

parseArguments(Bun.argv.slice(2));
const environment = parseEnvironment();
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: environment.DATABASE_URL }),
});

try {
  const [apiTokens, desktopClients, soundPacks, storedSounds, gameEventLogs] =
    await Promise.all([
      prisma.apiToken.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
      }),
      prisma.desktopClient.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
      }),
      prisma.soundPack.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
      }),
      prisma.storedSound.findMany({
        select: { id: true, s3Key: true },
        orderBy: { id: "asc" },
      }),
      prisma.gameEventLog.findMany({
        select: { id: true },
        orderBy: { id: "asc" },
      }),
    ]);

  const manifest = createDesktopRetirementManifest({
    postgres: {
      ApiToken: apiTokens.length,
      DesktopClient: desktopClients.length,
      SoundPack: soundPacks.length,
      StoredSound: storedSounds.length,
      GameEventLog: gameEventLogs.length,
    },
    postgresIdentityDigests: {
      ApiToken: desktopRetirementIdentityDigest(
        apiTokens.map((apiToken) => apiToken.id),
      ),
      DesktopClient: desktopRetirementIdentityDigest(
        desktopClients.map((desktopClient) => desktopClient.id),
      ),
      SoundPack: desktopRetirementIdentityDigest(
        soundPacks.map((soundPack) => soundPack.id),
      ),
      StoredSound: desktopRetirementIdentityDigest(
        storedSounds.map((storedSound) => storedSound.id),
      ),
      GameEventLog: desktopRetirementIdentityDigest(
        gameEventLogs.map((gameEventLog) => gameEventLog.id),
      ),
    },
    legacySqlite: readLegacyDesktopRetirementCounts(
      environment.LEGACY_SQLITE_PATH,
    ),
    legacySqlitePreflightDigest: legacySqlitePreflightDigest(
      environment.LEGACY_SQLITE_PATH,
    ),
    storedSoundKeys: storedSounds.map((storedSound) => storedSound.s3Key),
  });
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
} finally {
  await prisma.$disconnect();
}
