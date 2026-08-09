import { fileURLToPath } from "node:url";

/** Migrations that must be applied for the schema to match this build.
 *  The readiness probe checks these so a pod that started against a database
 *  missing a migration reports unready instead of failing queries at runtime. */
export const REQUIRED_MIGRATIONS = ["20260809012953_init"] as const;

/**
 * Apply pending Prisma migrations via the CLI.
 *
 * Deliberately spawns the CLI rather than importing the Prisma client: this
 * runs before the schema is known to exist, and loading the client first would
 * mask a migration failure as a confusing query error instead.
 *
 * Unlike birmel, there is no baseline-resolve step. The karma database is
 * created fresh by `scripts/import-legacy.ts`, so its migration history starts
 * at the init migration and `migrate deploy` is always sufficient.
 */
export async function deployDatabaseMigrations(): Promise<void> {
  const child = Bun.spawn(["bunx", "--trust", "prisma", "migrate", "deploy"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      `prisma migrate deploy exited with code ${String(exitCode)}`,
    );
  }
}
