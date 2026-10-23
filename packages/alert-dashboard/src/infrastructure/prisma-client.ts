import { PrismaLibSql } from "@prisma/adapter-libsql";

import { PrismaClient } from "#generated/prisma/client/index.js";

type LibSqlClient = ReturnType<PrismaLibSql["createClient"]>;
type LibSqlConfig = Parameters<PrismaLibSql["createClient"]>[0];
/** libSQL's `TransactionMode`; this package does not depend on its types. */
type TransactionMode = "write" | "read" | "deferred";
type ExplicitModeTransactions = {
  transaction: (
    mode?: TransactionMode,
  ) => ReturnType<LibSqlClient["transaction"]>;
};

/** Busy timeout for every connection; libSQL applies `timeout` to each one. */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Per-connection settings. `foreign_keys` makes the schema's cascades and
 * references real (libSQL currently defaults it on; the ledger's retention
 * relies on it, so it is set rather than assumed). `synchronous = NORMAL` is
 * durable across application crashes in WAL mode and skips the per-commit WAL
 * fsync that the default `FULL` adds.
 */
const CONNECTION_PRAGMAS = [
  "PRAGMA foreign_keys = ON",
  "PRAGMA synchronous = NORMAL",
] as const;

async function applyConnectionPragmas(client: LibSqlClient): Promise<void> {
  for (const pragma of CONNECTION_PRAGMAS) await client.execute(pragma);
}

/**
 * libSQL's local client hands its current connection to each `transaction()`
 * and lazily opens a fresh one for whatever runs next, so pragmas issued once
 * at startup reach only the first connection. This factory sets them on the
 * connection a transaction is about to take (before `BEGIN`, where
 * `foreign_keys` still takes effect) and on the replacement connection libSQL
 * opens afterwards. The Prisma adapter serializes every client call behind
 * one lock, so no other statement can claim a connection in between.
 */
export class PrismaLibSqlWithConnectionPragmas extends PrismaLibSql {
  override createClient(config: LibSqlConfig): LibSqlClient {
    const client = super.createClient(config);
    // Narrow to the explicit-mode overload; libSQL deprecates the bare form.
    const transactional: ExplicitModeTransactions = client;
    const begin = transactional.transaction.bind(client);
    const transaction: LibSqlClient["transaction"] = async (
      mode?: TransactionMode,
    ) => {
      await applyConnectionPragmas(client);
      const opened = await begin(mode);
      await applyConnectionPragmas(client);
      return opened;
    };
    return Object.assign(client, { transaction });
  }
}

export async function createPrismaClient(
  databaseUrl: string,
): Promise<PrismaClient> {
  const adapter = new PrismaLibSqlWithConnectionPragmas({
    url: databaseUrl,
    intMode: "bigint",
    timeout: BUSY_TIMEOUT_MS,
  });
  const prisma = new PrismaClient({ adapter });
  // journal_mode is persistent in the database file; the per-connection
  // pragmas still need the initial connection, which no transaction has
  // claimed yet.
  await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL");
  for (const pragma of CONNECTION_PRAGMAS)
    await prisma.$executeRawUnsafe(pragma);
  return prisma;
}
