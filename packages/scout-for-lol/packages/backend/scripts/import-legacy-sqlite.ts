#!/usr/bin/env bun
/**
 * Entrypoint step: import the legacy SQLite database into Postgres, exactly
 * once. Runs between `prisma migrate deploy` and the app in the container
 * CMD; also the rehearsal/verification CLI.
 *
 *   bun run scripts/import-legacy-sqlite.ts                     # cutover mode
 *   bun run scripts/import-legacy-sqlite.ts --allow-fresh-install
 *                                                               # explicit empty install
 *   bun run scripts/import-legacy-sqlite.ts --source <path>    # explicit snapshot
 *   bun run scripts/import-legacy-sqlite.ts --source <path> --verify-only
 *
 * DATABASE_URL selects the Postgres target. LEGACY_SQLITE_PATH (default
 * /data/db.sqlite) selects the source in entrypoint mode. --verify-only
 * compares an already-imported database against the snapshot (counts +
 * PK-ordered content digests + ledger invariant) and exits nonzero on any
 * mismatch, writing nothing.
 */
import { z } from "zod";
import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createLogger } from "#src/logger.ts";
import {
  runImport,
  verifyImport,
  verifyLedgerBalances,
} from "#src/database/legacy-import/run-import.ts";

const logger = createLogger("import-legacy-sqlite");

const ArgsSchema = z
  .object({
    source: z.string().min(1),
    verifyOnly: z.boolean().default(false),
    allowFreshInstall: z.boolean().default(false),
  })
  .strict();

function parseArgs(argv: string[]): z.infer<typeof ArgsSchema> {
  const raw: Record<string, unknown> = {
    source: Bun.env["LEGACY_SQLITE_PATH"] ?? "/data/db.sqlite",
    verifyOnly: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--source") {
      raw["source"] = argv[++index];
      continue;
    }
    if (arg === "--verify-only") {
      raw["verifyOnly"] = true;
      continue;
    }
    if (arg === "--allow-fresh-install") {
      raw["allowFreshInstall"] = true;
      continue;
    }
    throw new Error(
      `Unknown argument ${arg ?? ""}. Expected [--source <path>] [--verify-only] [--allow-fresh-install].`,
    );
  }
  return ArgsSchema.parse(raw);
}

const args = parseArgs(Bun.argv.slice(2));
const databaseUrl = Bun.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl === "") {
  throw new Error("DATABASE_URL is required (postgres:// URL)");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

try {
  if (args.verifyOnly) {
    const mismatches = await verifyImport({ prisma, sqlitePath: args.source });
    for (const mismatch of mismatches) {
      logger.error(
        `✗ ${mismatch.model} (${mismatch.kind}): ${mismatch.detail}`,
      );
    }
    const drift = await verifyLedgerBalances(prisma);
    for (const line of drift) {
      logger.error(`✗ ledger: ${line}`);
    }
    if (mismatches.length > 0 || drift.length > 0) {
      logger.error(
        `Verification FAILED: ${mismatches.length.toString()} model mismatches, ${drift.length.toString()} ledger drifts`,
      );
      process.exit(1);
    }
    logger.info(
      "Verification clean: counts, content digests, and ledger match",
    );
  } else {
    const summary = await runImport({
      prisma,
      sqlitePath: args.source,
      allowFreshInstall: args.allowFreshInstall,
    });
    logger.info(`Legacy import: ${summary.action}`);
    if (summary.action === "imported") {
      const drift = await verifyLedgerBalances(prisma);
      for (const line of drift) {
        logger.error(`✗ ledger: ${line}`);
      }
      if (drift.length > 0) {
        // The import committed; drift is an importer bug to investigate, and
        // starting the app on top of it would compound the damage.
        throw new Error(
          `Ledger drift after import (${drift.length.toString()} accounts) — refusing to start`,
        );
      }
    }
  }
} finally {
  await prisma.$disconnect();
}
