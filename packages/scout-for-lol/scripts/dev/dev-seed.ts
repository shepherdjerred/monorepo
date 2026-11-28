import { cp, mkdir, rm, rename } from "node:fs/promises";
import path from "node:path";
import {
  DEV_SEED_REFRESH_COMMAND,
  describeBuildSchemaMismatch,
  inspectPublishedBuild,
  seedLakeDir,
  seedRoot,
} from "./dev-lake-seed.ts";

/**
 * Fill the machine-wide report-lake seed that every checkout copies from.
 *
 *   bun run dev:seed                  # full rebuild from S3 into the seed
 *   bun run dev:seed -- --from-checkout   # publish this checkout's lake as the seed
 *   bun run dev:seed -- --status          # what the seed currently holds
 *
 * See scripts/dev/dev-lake-seed.ts for why the seed is a copy source rather than a
 * directory several backends share.
 */

const FLAGS = ["--from-checkout", "--status"] as const;
type Flag = (typeof FLAGS)[number];

export function parseFlags(argv: readonly string[]): Set<Flag> {
  const flags = new Set<Flag>();
  for (const argument of argv) {
    const known = FLAGS.find((flag) => flag === argument);
    if (known === undefined) {
      throw new Error(
        `Unknown flag ${argument}. Known flags: ${FLAGS.join(", ")}`,
      );
    }
    flags.add(known);
  }
  return flags;
}

export async function describe(
  lakeDir: string,
  label: string,
): Promise<string> {
  const inspection = await inspectPublishedBuild(lakeDir);
  if (inspection === null) {
    return `${label}: no published build (${lakeDir})`;
  }
  return inspection.compatible
    ? `${label}: build ${inspection.buildId} [schema: ${inspection.schemaStatus}] (${lakeDir})`
    : `${label}: build ${inspection.buildId} [incompatible: ${describeBuildSchemaMismatch(inspection)} — refresh with \`${DEV_SEED_REFRESH_COMMAND}\`] (${lakeDir})`;
}

/** Copy a checkout's lake into the seed, atomically swapping the old one out. */
export async function publishFromCheckout(checkoutLake: string): Promise<void> {
  const inspection = await inspectPublishedBuild(checkoutLake);
  if (inspection === null) {
    throw new Error(
      `${checkoutLake} has no published build to seed from. Run a rebuild there first, or run this without --from-checkout.`,
    );
  }
  if (!inspection.compatible) {
    throw new Error(
      `Refusing to seed from incompatible build ${inspection.buildId} at ${checkoutLake} (${describeBuildSchemaMismatch(inspection)}). Run \`${DEV_SEED_REFRESH_COMMAND}\` instead.`,
    );
  }
  const seed = seedLakeDir();
  const staging = `${seed}.publishing`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(seedRoot(), { recursive: true });
  await cp(checkoutLake, staging, { recursive: true });
  await rm(seed, { recursive: true, force: true });
  await rename(staging, seed);
  console.log(`Seeded build ${inspection.buildId} into ${seed}`);
}

type SpawnedProcess = Pick<Bun.Subprocess, "exited">;
type SpawnSeedCommand = (
  command: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Record<string, string | undefined>;
  },
) => SpawnedProcess;

function defaultSpawnSeedCommand(
  command: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Record<string, string | undefined>;
  },
): SpawnedProcess {
  return Bun.spawn([...command], {
    cwd: options.cwd,
    env: options.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
}

/**
 * Rebuild straight into the seed.
 *
 * Runs the backend's own compactor rather than reimplementing it — the lake
 * layout and the CURRENT-pointer publish protocol have exactly one owner.
 */
export async function rebuildIntoSeed(
  scoutRoot: string,
  spawnProcess: SpawnSeedCommand = defaultSpawnSeedCommand,
): Promise<void> {
  const seed = seedLakeDir();
  await mkdir(seed, { recursive: true });
  console.log(`Rebuilding the report lake into ${seed} (walks S3; not quick)`);
  const child = spawnProcess(
    [
      "op",
      "run",
      `--env-file=${scoutRoot}/dev-web.env.tpl`,
      "--",
      "bun",
      "run",
      "compact:report-lake",
    ],
    {
      cwd: path.join(scoutRoot, "packages", "backend"),
      env: {
        ...Bun.env,
        REPORT_LAKE_DIR: seed,
        AWS_PROFILE: Bun.env["AWS_PROFILE"] ?? "seaweedfs",
      },
    },
  );
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(
      `Report-lake rebuild failed with exit code ${String(code)}`,
    );
  }
  console.log(await describe(seed, "seed"));
}

export async function runDevSeedCli(
  argv: readonly string[],
  scoutRoot: string = path.resolve(import.meta.dir, "../.."),
  spawnProcess: SpawnSeedCommand = defaultSpawnSeedCommand,
): Promise<void> {
  const checkoutLake = path.join(
    scoutRoot,
    "packages",
    "backend",
    "report-lake",
  );
  const flags = parseFlags(argv);

  if (flags.has("--status")) {
    console.log(await describe(seedLakeDir(), "seed"));
    console.log(await describe(checkoutLake, "this checkout"));
  } else if (flags.has("--from-checkout")) {
    await publishFromCheckout(checkoutLake);
  } else {
    await rebuildIntoSeed(scoutRoot, spawnProcess);
  }
}

if (import.meta.main) {
  await runDevSeedCli(Bun.argv.slice(2));
}
