#!/usr/bin/env bun
import path from "node:path";

const PACKAGE_ROOT = path.resolve(import.meta.dir, "..");
const INIT_MIGRATION = "20261118000000_init_and_sync_seq";
const INIT_MIGRATION_SQL = path.join(
  PACKAGE_ROOT,
  "prisma",
  "migrations",
  INIT_MIGRATION,
  "migration.sql",
);

async function runPrisma(
  args: string[],
): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(["bunx", "--no-install", "prisma", ...args], {
    cwd: PACKAGE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = `${stdout}${stderr}`;
  if (stdout !== "") {
    process.stdout.write(stdout);
  }
  if (stderr !== "") {
    process.stderr.write(stderr);
  }
  return { code, output };
}

export async function deployTasknotesMigrations(): Promise<void> {
  const initial = await runPrisma(["migrate", "deploy"]);
  if (initial.code === 0) {
    return;
  }

  // Production tasknotes_db predates _prisma_migrations (9 tables created via db push).
  // When Prisma reports P3005 ("database schema is not empty"), execute our idempotent
  // init+repair migration directly, baseline it in _prisma_migrations, and re-verify deploy.
  if (!initial.output.includes("P3005")) {
    throw new Error(
      `prisma migrate deploy failed (exit ${String(initial.code)})`,
    );
  }

  console.warn(
    `[migrate] Detected pre-existing schema without _prisma_migrations (P3005); applying idempotent ${INIT_MIGRATION} and baselining...`,
  );

  const executed = await runPrisma([
    "db",
    "execute",
    "--file",
    INIT_MIGRATION_SQL,
  ]);
  if (executed.code !== 0) {
    throw new Error(`prisma db execute failed (exit ${String(executed.code)})`);
  }

  const resolved = await runPrisma([
    "migrate",
    "resolve",
    "--applied",
    INIT_MIGRATION,
  ]);
  if (resolved.code !== 0) {
    throw new Error(
      `prisma migrate resolve failed (exit ${String(resolved.code)})`,
    );
  }

  const verified = await runPrisma(["migrate", "deploy"]);
  if (verified.code !== 0) {
    throw new Error(
      `prisma migrate deploy verification failed (exit ${String(verified.code)})`,
    );
  }
}

if (import.meta.main) {
  await deployTasknotesMigrations();
}
