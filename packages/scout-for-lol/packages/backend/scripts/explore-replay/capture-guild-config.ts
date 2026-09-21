/**
 * Record what each target guild can actually do, and write the dataset pin.
 *
 * Run after both halves of a stage dataset are on disk. Like the replay
 * itself, this imports nothing from `#src/` at the top level: it has to set
 * `DATABASE_URL`, `REPORT_LAKE_DIR` and `ENVIRONMENT` for the stage *before*
 * the agent's module singletons bind, then load the rest dynamically.
 *
 * The capabilities it records come from the stage's own flag service, so they
 * are what that guild really has — not what a synthetic profile asserts.
 */

import path from "node:path";
import {
  defaultDatasetPinPath,
  type ReplayStageName,
} from "#src/explore/replay/cli.ts";

const USAGE = `Usage: bun run explore:capture-guilds -- [options]

Records each target guild's real capabilities and writes the dataset pin.

Options:
  --stage <beta|prod>   Stage whose dataset is on disk (default: beta)
  --top <n>             How many prod guilds to take, by Explore usage
                        (default: 3; ignored for beta, which has one guild)
  --lake <dir>          Where the build was pulled, if not the default beside
                        the pin (match dev:lake-pull --destination)
  --help                Show this help

Pull the lake and the database first; this reads both.`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

type Options = {
  readonly stage: ReplayStageName;
  readonly top: number;
  /** Null means the default beside the pin. */
  readonly lakeDir: string | null;
};

function parseArgs(args: readonly string[]): Options | "help" {
  let stage: ReplayStageName = "beta";
  let top = 3;
  let lakeDir: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return "help";
    if (argument === "--stage") {
      const value = args[index + 1];
      if (value !== "beta" && value !== "prod") {
        fail(`--stage must be beta or prod, got ${value ?? ""}`);
      }
      stage = value;
      index += 1;
      continue;
    }
    if (argument === "--top") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        fail(`--top must be a positive integer, got ${args[index + 1] ?? ""}`);
      }
      top = value;
      index += 1;
      continue;
    }
    if (argument === "--lake") {
      const value = args[index + 1];
      if (value === undefined || value === "") {
        fail("--lake needs a directory");
      }
      lakeDir = value;
      index += 1;
      continue;
    }
    fail(`Unknown argument ${argument ?? ""}`);
  }
  return { stage, top, lakeDir };
}

async function main(): Promise<void> {
  const parsed = parseArgs(Bun.argv.slice(2));
  if (parsed === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const { stage, top } = parsed;

  const pinPath = defaultDatasetPinPath(stage, Bun.env);
  const datasetDir = path.dirname(pinPath);
  // `dev:lake-pull --destination` can put the build anywhere, and a capture
  // that only ever reconstructs the default path cannot find it. Resolved
  // against the working directory so a relative path means what it looks like.
  const lakeDir =
    parsed.lakeDir === null
      ? path.join(datasetDir, "report-lake")
      : path.resolve(process.cwd(), parsed.lakeDir);
  const databaseName = `scout_${stage}_snapshot`;
  const port = Bun.env["SCOUT_PG_PORT"] ?? "5471";
  const databaseUrl = `postgres://scout@127.0.0.1:${port}/${databaseName}`;

  // Set before the dynamic imports below, for the same reason the replay entry
  // point does: these bind on first import and cannot be changed afterwards.
  Bun.env["DATABASE_URL"] = databaseUrl;
  Bun.env["REPORT_LAKE_DIR"] = lakeDir;
  // ENVIRONMENT is deliberately NOT set here. `capture-pin.ts` flips it after
  // configuration has memoized, so prod's flag rules apply without prod's
  // config demands — see `useStageFlagSemantics`.
  Bun.env["TEMPORAL_NAMESPACE"] ??= stage;
  delete Bun.env["TEMPORAL_ADDRESS"];

  const { capturePinForStage } = await import("./capture-pin.ts");
  const pin = await capturePinForStage({
    stage,
    top,
    lakeDir,
    databaseName,
    databaseUrl,
  });

  await Bun.write(pinPath, `${JSON.stringify(pin, null, 2)}\n`);
  await Bun.$`chmod 600 ${pinPath}`.quiet();

  process.stdout.write(
    [
      `Wrote ${pinPath}`,
      "",
      ...Object.values(pin.guilds).map((config) => {
        const live = Object.entries(config.capabilities)
          .filter(([, enabled]) => enabled)
          .map(([name]) => name);
        return `  ${config.label} (${config.guildId}) — ${live.length === 0 ? "no gated features" : live.join(", ")}`;
      }),
      "",
      `Now run: bun run test:explore:replay -- --stage ${stage} --limit 3 --concurrency 1`,
      "",
    ].join("\n"),
  );
}

await main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
