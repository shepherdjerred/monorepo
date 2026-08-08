import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type MemoryTestDatabase = {
  client: PrismaClient;
  databasePath: string;
  cleanup: () => Promise<void>;
};

const MEMORY_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE "MemoryClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identityKey" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "salience" REAL NOT NULL,
    "origin" TEXT NOT NULL,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "channelId" TEXT,
    "personaId" TEXT,
    "userId" TEXT,
    "relatedUserIds" TEXT NOT NULL DEFAULT '[]',
    "embedding" TEXT,
    "lastConfirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE TABLE "MemoryRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousValue" TEXT,
    "nextValue" TEXT,
    "sourceDiscordMessageIds" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "extractorModel" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryRevision_claimId_fkey"
      FOREIGN KEY ("claimId") REFERENCES "MemoryClaim" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE TABLE "MemoryExtractionFence" (
    "familyKey" TEXT NOT NULL PRIMARY KEY,
    "sourceOrder" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE TABLE "MemorySourceFence" (
    "sourceDiscordMessageId" TEXT NOT NULL PRIMARY KEY,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE UNIQUE INDEX "MemoryClaim_identityKey_key"
    ON "MemoryClaim"("identityKey");
  CREATE INDEX "MemoryClaim_guildId_scope_status_idx"
    ON "MemoryClaim"("guildId", "scope", "status");
  CREATE INDEX "MemoryClaim_channelId_idx" ON "MemoryClaim"("channelId");
  CREATE INDEX "MemoryClaim_personaId_idx" ON "MemoryClaim"("personaId");
  CREATE INDEX "MemoryClaim_userId_idx" ON "MemoryClaim"("userId");
  CREATE INDEX "MemoryClaim_guildId_subject_predicate_idx"
    ON "MemoryClaim"("guildId", "subject", "predicate");
  CREATE INDEX "MemoryClaim_lastConfirmedAt_idx"
    ON "MemoryClaim"("lastConfirmedAt");
  CREATE INDEX "MemoryRevision_claimId_createdAt_idx"
    ON "MemoryRevision"("claimId", "createdAt");
  CREATE INDEX "MemoryRevision_sourceDiscordMessageIds_idx"
    ON "MemoryRevision"("sourceDiscordMessageIds");
`;

export async function createMemoryTestDatabase(): Promise<MemoryTestDatabase> {
  const directory = await mkdtemp(path.join(tmpdir(), "birmel-memory-"));
  const databasePath = path.join(directory, "memory.db");
  let client: PrismaClient | null = null;
  try {
    const database = new Database(databasePath, { create: true, strict: true });
    try {
      database.run(MEMORY_SCHEMA_SQL);
    } finally {
      database.close();
    }

    client = new PrismaClient({
      adapter: new PrismaLibSql({ url: `file:${databasePath}` }),
    });
    await client.$connect();
    await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    const connectedClient = client;

    return {
      client: connectedClient,
      databasePath,
      async cleanup(): Promise<void> {
        await connectedClient.$disconnect();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (client !== null) {
      await client.$disconnect();
    }
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
