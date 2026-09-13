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
  readLegacyDesktopRetirementCounts,
} from "#src/retirement/desktop-data.ts";
import { legacySqliteSourceDigest } from "#src/database/legacy-import/run-import.ts";

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
  const [
    apiTokenCount,
    desktopClientCount,
    soundPackCount,
    storedSoundCount,
    gameEventLogCount,
    storedSounds,
  ] = await Promise.all([
    prisma.apiToken.count(),
    prisma.desktopClient.count(),
    prisma.soundPack.count(),
    prisma.storedSound.count(),
    prisma.gameEventLog.count(),
    prisma.storedSound.findMany({
      select: { s3Key: true },
      orderBy: { s3Key: "asc" },
    }),
  ]);

  const manifest = createDesktopRetirementManifest({
    postgres: {
      ApiToken: apiTokenCount,
      DesktopClient: desktopClientCount,
      SoundPack: soundPackCount,
      StoredSound: storedSoundCount,
      GameEventLog: gameEventLogCount,
    },
    legacySqlite: readLegacyDesktopRetirementCounts(
      environment.LEGACY_SQLITE_PATH,
    ),
    legacySqliteSourceDigest: legacySqliteSourceDigest(
      environment.LEGACY_SQLITE_PATH,
    ),
    storedSoundKeys: storedSounds.map((storedSound) => storedSound.s3Key),
  });
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
} finally {
  await prisma.$disconnect();
}
