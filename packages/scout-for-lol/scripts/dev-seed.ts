import { cp, mkdir, rm, rename } from "node:fs/promises";
import path from "node:path";
import { publishedBuildId, seedLakeDir, seedRoot } from "./dev-lake-seed.ts";

/**
 * Fill the machine-wide report-lake seed that every checkout copies from.
 *
 *   bun run dev:seed                  # full rebuild from S3 into the seed
 *   bun run dev:seed -- --from-checkout   # publish this checkout's lake as the seed
 *   bun run dev:seed -- --status          # what the seed currently holds
 *
 * See scripts/dev-lake-seed.ts for why the seed is a copy source rather than a
 * directory several backends share.
 */

const FLAGS = ["--from-checkout", "--status"] as const;
type Flag = (typeof FLAGS)[number];

function parseFlags(argv: string[]): Set<Flag> {
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

async function describe(lakeDir: string, label: string): Promise<string> {
  const buildId = await publishedBuildId(lakeDir);
  return buildId === null
    ? `${label}: no published build (${lakeDir})`
    : `${label}: build ${buildId} (${lakeDir})`;
}

/** Copy a checkout's lake into the seed, atomically swapping the old one out. */
async function publishFromCheckout(checkoutLake: string): Promise<void> {
  const buildId = await publishedBuildId(checkoutLake);
  if (buildId === null) {
    throw new Error(
      `${checkoutLake} has no published build to seed from. Run a rebuild there first, or run this without --from-checkout.`,
    );
  }
  const seed = seedLakeDir();
  const staging = `${seed}.publishing`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(seedRoot(), { recursive: true });
  await cp(checkoutLake, staging, { recursive: true });
  await rm(seed, { recursive: true, force: true });
  await rename(staging, seed);
  console.log(`Seeded build ${buildId} into ${seed}`);
}

/**
 * Rebuild straight into the seed.
 *
 * Runs the backend's own compactor rather than reimplementing it — the lake
 * layout and the CURRENT-pointer publish protocol have exactly one owner.
 */
async function rebuildIntoSeed(scoutRoot: string): Promise<void> {
  const seed = seedLakeDir();
  await mkdir(seed, { recursive: true });
  console.log(`Rebuilding the report lake into ${seed} (walks S3; not quick)`);
  const child = Bun.spawn(
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
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
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

if (import.meta.main) {
  const scoutRoot = import.meta.dir.replace(/\/scripts$/, "");
  const checkoutLake = path.join(
    scoutRoot,
    "packages",
    "backend",
    "report-lake",
  );
  const flags = parseFlags(Bun.argv.slice(2));

  if (flags.has("--status")) {
    console.log(await describe(seedLakeDir(), "seed"));
    console.log(await describe(checkoutLake, "this checkout"));
  } else if (flags.has("--from-checkout")) {
    await publishFromCheckout(checkoutLake);
  } else {
    await rebuildIntoSeed(scoutRoot);
  }
}
