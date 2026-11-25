import { parseArgs } from "node:util";
import { runBugsinkImport } from "#infrastructure/bugsink-importer.ts";
import {
  createDatabase,
  createPrismaErrorsRepository,
} from "#infrastructure/db.ts";
import { createInMemoryErrorsRepository } from "#infrastructure/in-memory-db.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    url: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    project: { type: "string" },
    concurrency: { type: "string" },
    json: { type: "boolean", default: false },
  },
  strict: true,
});

const baseUrl =
  values.url ??
  Bun.env["BUGSINK_IMPORT_URL"]?.trim() ??
  Bun.env["BUGSINK_URL"]?.trim();
const token =
  Bun.env["BUGSINK_IMPORT_TOKEN"]?.trim() ?? Bun.env["BUGSINK_TOKEN"]?.trim();

if (baseUrl === undefined || baseUrl.length === 0) {
  console.error(
    "Missing Bugsink base URL. Pass --url <url> or set BUGSINK_IMPORT_URL / BUGSINK_URL.",
  );
  process.exit(1);
}

if (token === undefined || token.length === 0) {
  console.error(
    "Missing Bugsink API token. Set BUGSINK_IMPORT_TOKEN or BUGSINK_TOKEN.",
  );
  process.exit(1);
}

const dryRun = values["dry-run"];
const projectId =
  values.project === undefined
    ? undefined
    : Number.parseInt(values.project, 10);
const concurrency =
  values.concurrency === undefined
    ? 8
    : Number.parseInt(values.concurrency, 10);

const databaseUrl = Bun.env["DATABASE_URL"]?.trim();
if (!dryRun && (databaseUrl === undefined || databaseUrl.length === 0)) {
  console.error("DATABASE_URL is required unless --dry-run is specified.");
  process.exit(1);
}

const repo =
  databaseUrl !== undefined && databaseUrl.length > 0
    ? createPrismaErrorsRepository(createDatabase(databaseUrl))
    : createInMemoryErrorsRepository();

try {
  const result = await runBugsinkImport({
    baseUrl,
    token,
    repo,
    dryRun,
    concurrency,
    projectId,
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `Bugsink import ${result.dryRun ? "(dry-run) " : ""}completed in ${String(result.durationMs)}ms:`,
        `  Projects:              ${String(result.projectsImported)}`,
        `  Releases:              ${String(result.releasesImported)}`,
        `  Issues:                ${String(result.issuesImported)}`,
        `  Events imported:       ${String(result.eventsImported)}`,
        `  Events skipped (seen): ${String(result.eventsSkippedExisting)}`,
        `  Fingerprints mapped:   ${String(result.fingerprintsRegistered)}`,
      ].join("\n") + "\n",
    );
  }
} finally {
  await repo.close();
}
