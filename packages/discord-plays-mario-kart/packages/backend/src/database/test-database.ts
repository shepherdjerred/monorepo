// A fresh SQLite database with the real Prisma schema, for store tests.
//
// The DDL comes from `prisma migrate diff` against prisma/schema.prisma, so the
// tests exercise the same tables production gets from `prisma db push` rather
// than a hand-copied schema that can drift. Requires `prisma generate` (CI runs
// it before backend tests; locally run `bun run generate`).
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const BACKEND_ROOT = path.join(import.meta.dirname, "..", "..");
let ddl: string[] | undefined;
let counter = 0;

function schemaStatements(): string[] {
  if (ddl !== undefined) return ddl;
  const cli = Bun.resolveSync("prisma/build/index.js", BACKEND_ROOT);
  const result = Bun.spawnSync(
    [
      process.execPath,
      cli,
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      "prisma/schema.prisma",
      "--script",
    ],
    { cwd: BACKEND_ROOT, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(`prisma migrate diff failed: ${result.stderr.toString()}`);
  }
  ddl = result.stdout
    .toString()
    .split(";")
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((statement) => statement.length > 0);
  return ddl;
}

/**
 * A client on a new, empty database file. libSQL `:memory:` gives each pooled
 * connection its own database, so the schema and the queries would land in
 * different ones; a unique file avoids that.
 */
export async function openTestDatabase(): Promise<PrismaClient> {
  counter += 1;
  const file = path.join(
    tmpdir(),
    `dpmk-test-${String(process.pid)}-${String(counter)}-${String(Date.now())}.db`,
  );
  const prisma = new PrismaClient({
    adapter: new PrismaLibSql({ url: `file:${file}` }),
  });
  for (const statement of schemaStatements()) {
    await prisma.$executeRawUnsafe(statement);
  }
  return prisma;
}
