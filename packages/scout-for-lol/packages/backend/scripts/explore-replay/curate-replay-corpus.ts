/**
 * Pick the conversations worth replaying, and emit the corpus as ids.
 *
 * Two modes on purpose. Without `--write` it prints candidates *with their
 * text*, because deciding whether a conversation is worth replaying means
 * reading it. With `--write` it emits identifiers only — the committed corpus
 * carries no conversation text, so the repository never becomes a copy of
 * people's questions and a case that has drifted out of the snapshot fails
 * loudly instead of silently meaning something else.
 */

import path from "node:path";
import { ME } from "#src/configuration/flags.ts";
import { defaultDatasetPinPath } from "#src/explore/replay/cli.ts";

const USAGE = `Usage: bun run explore:curate-corpus -- [options]

Lists conversations worth replaying from a pulled stage snapshot.

Options:
  --stage <beta|prod>   Snapshot to read (default: beta)
  --min-turns <n>       Only conversations with at least this many user turns
  --limit <n>           Show at most this many conversations (default: 20)
  --write <path>        Emit the id-only corpus to this file
  --help                Show this help

Without --write it prints candidates with their text, for reading.`;

type Options = {
  readonly stage: "beta" | "prod";
  readonly minTurns: number;
  readonly limit: number;
  readonly write: string | null;
};

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(args: readonly string[]): Options | "help" {
  let stage: "beta" | "prod" = "beta";
  let minTurns = 1;
  let limit = 20;
  let write: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return "help";
    const value = args[index + 1];
    if (argument === "--stage") {
      if (value !== "beta" && value !== "prod") {
        fail(`--stage must be beta or prod, got ${value ?? ""}`);
      }
      stage = value;
      index += 1;
      continue;
    }
    if (argument === "--min-turns" || argument === "--limit") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        fail(`${argument} must be a positive integer, got ${value ?? ""}`);
      }
      if (argument === "--min-turns") minTurns = parsed;
      else limit = parsed;
      index += 1;
      continue;
    }
    if (argument === "--write") {
      if (value === undefined) fail("--write requires a path");
      write = value;
      index += 1;
      continue;
    }
    fail(`Unknown argument ${argument ?? ""}`);
  }
  return { stage, minTurns, limit, write };
}

async function main(): Promise<void> {
  const parsed = parseArgs(Bun.argv.slice(2));
  if (parsed === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const { stage, minTurns, limit, write } = parsed;

  const datasetDir = path.dirname(defaultDatasetPinPath(stage, Bun.env));
  const port = Bun.env["SCOUT_PG_PORT"] ?? "5471";
  Bun.env["DATABASE_URL"] =
    `postgres://scout@127.0.0.1:${port}/scout_${stage}_snapshot`;
  Bun.env["REPORT_LAKE_DIR"] = path.join(datasetDir, "report-lake");
  delete Bun.env["TEMPORAL_ADDRESS"];

  // Dynamic for the same reason the replay entry point is: importing this
  // binds the Prisma singleton to whatever DATABASE_URL says at that moment.
  const { curateCorpus } = await import("./curate-corpus.ts");
  await curateCorpus({ stage, minTurns, limit, write, ownerId: ME });
}

await main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
