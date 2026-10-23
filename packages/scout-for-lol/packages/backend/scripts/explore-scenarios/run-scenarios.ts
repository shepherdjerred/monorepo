/**
 * Run the Explore scenario eval.
 *
 *   bun run test:explore:scenarios -- [--only id,id] [--surfaces web,discord,voice]
 *     [--concurrency 3] [--no-judge] [--write] [--source-lake <dir>]
 *
 * Every case is seeded into its own guild in a throwaway database cloned from
 * the migrated test template, and runs against a private copy of a pulled
 * report-lake build whose accounts are rewritten from that database. Nothing
 * here touches a stage database or the lake it was copied from.
 *
 * This file imports almost nothing on purpose, for the reason
 * `replay-explore.ts` gives: the agent binds `DATABASE_URL`,
 * `REPORT_LAKE_DIR` and the dev guild override at first import, so they are
 * set here, before the harness is loaded, and checked again after.
 *
 * Like the other model-backed evals, this calls a live model and is a manual
 * gate, never CI.
 */

import path from "node:path";
import { homedir } from "node:os";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { parseScenarioArgs, SCENARIO_USAGE } from "./scenario-args.ts";

/** Dropped and re-created from the migrated test template on every run. */
const SCENARIO_DATABASE = "scout_scenarios";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * One scenario eval at a time per machine.
 *
 * Every run replaces the same fixture database and lake clone, so a second
 * run would drop the first one's database mid-turn and lose its paid results.
 * A lock left by a run that died is taken over.
 */
async function holdRunLock(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, "run.lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await takeLock(lockPath)) return lockPath;
    const holder = Number.parseInt(await readFile(lockPath, "utf8"), 10);
    if (processAlive(holder))
      fail(`Another scenario eval is running (pid ${holder.toString()}).`);
    await rm(lockPath, { force: true });
  }
  fail("Could not take the scenario eval lock.");
}

/** Creates the lock file; false when it already exists. */
async function takeLock(lockPath: string): Promise<boolean> {
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(process.pid.toString());
    await handle.close();
    return true;
  } catch (error) {
    if (z.object({ code: z.literal("EEXIST") }).safeParse(error).success)
      return false;
    throw error;
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stateRoot(): string {
  const xdg = Bun.env["XDG_STATE_HOME"];
  return path.join(
    xdg !== undefined && xdg.length > 0
      ? xdg
      : path.join(homedir(), ".local", "state"),
    "scout-for-lol",
    "explore-scenarios",
  );
}

/**
 * A private copy of the source lake's current build.
 *
 * Copy-on-write where the filesystem offers it (`cp -c` on APFS, `--reflink`
 * elsewhere), so a multi-gigabyte build costs seconds. The accounts file is
 * rewritten in the copy, never in the source, which another tool may be
 * reading as a pinned dataset.
 */
async function cloneLake(
  sourceLake: string,
  destination: string,
): Promise<{
  readonly buildId: string;
  readonly buildDir: string;
}> {
  const pointer = await readFile(path.join(sourceLake, "CURRENT"), "utf8");
  const sourceBuildId = pointer.trim();
  if (sourceBuildId.length === 0) fail(`${sourceLake} has no published build.`);
  const buildId = `${sourceBuildId}-scenarios`;
  const buildDir = path.join(destination, "builds", buildId);
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.join(destination, "builds"), { recursive: true });
  const copy = Bun.spawnSync(
    process.platform === "darwin"
      ? ["cp", "-Rc", path.join(sourceLake, "builds", sourceBuildId), buildDir]
      : [
          "cp",
          "-R",
          "--reflink=auto",
          path.join(sourceLake, "builds", sourceBuildId),
          buildDir,
        ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (copy.exitCode !== 0) fail(`Could not copy lake build ${sourceBuildId}.`);
  await writeFile(path.join(destination, "CURRENT"), `${buildId}\n`);
  return { buildId, buildDir };
}

async function main(): Promise<void> {
  const parsed = parseScenarioArgs(Bun.argv.slice(2));
  if (parsed.kind === "help") {
    process.stdout.write(`${SCENARIO_USAGE}\n`);
    return;
  }
  const options = parsed.options;

  // Pure modules only: the corpus and the world ids depend on nothing that
  // reads configuration.
  const { loadScenarioCorpus, scenarioPlan } =
    await import("#src/explore/scenarios/plan.ts");
  const corpus = await loadScenarioCorpus();
  const plan = scenarioPlan(corpus.corpus, options);
  if (plan.length === 0) fail("No scenario matches the selection.");

  for (const name of ["ENVIRONMENT", "DATABASE_URL", "REPORT_LAKE_DIR"]) {
    if (Bun.env[name] !== undefined && Bun.env[name] !== "") {
      fail(
        `${name} is set. The scenario eval chooses its own; unset it so a stray value cannot point the run at real data.`,
      );
    }
  }

  // Dev, so the guild-membership override applies: every seeded guild reads
  // as one the asker owns. `useStageFlagSemantics` then gives flags prod's
  // rules after configuration has memoized this.
  Bun.env["ENVIRONMENT"] = "dev";
  Bun.env["ENABLE_DEV_LOGIN"] = "true";
  Bun.env["DEV_USER_GUILDS"] = [
    ...new Set(plan.map((run) => run.guildId)),
  ].join(",");
  Bun.env["FEATURE_FLAGS_MODE"] = "disabled";
  Bun.env["TEMPORAL_NAMESPACE"] ??= "dev";
  // Nothing in a scenario may start a workflow.
  delete Bun.env["TEMPORAL_ADDRESS"];
  // No S3 credentials: fail the provider chain fast instead of probing EC2.
  Bun.env["AWS_EC2_METADATA_DISABLED"] = "true";

  const root = stateRoot();
  const lockPath = await holdRunLock(root);
  const lake = await cloneLake(
    options.sourceLake,
    path.join(root, "report-lake"),
  );
  Bun.env["REPORT_LAKE_DIR"] = path.join(root, "report-lake");
  // Set before the Postgres helpers load: they import the logger, and nothing
  // may memoize configuration while DATABASE_URL is still unset.
  const databaseUrl = `postgres://scout@127.0.0.1:${Bun.env["SCOUT_PG_PORT"] ?? "5471"}/${SCENARIO_DATABASE}`;
  Bun.env["DATABASE_URL"] = databaseUrl;

  const { devDatabaseUrl, psqlMaintenance } =
    await import("#src/testing/postgres-server.ts");
  if (devDatabaseUrl(SCENARIO_DATABASE) !== databaseUrl) {
    fail(
      `The dev Postgres helper resolves ${devDatabaseUrl(SCENARIO_DATABASE)}, not ${databaseUrl}.`,
    );
  }
  const { ensureTestTemplate, getTestTemplateDatabase } =
    await import("#src/testing/test-template.ts");
  await ensureTestTemplate();
  psqlMaintenance(`DROP DATABASE IF EXISTS ${SCENARIO_DATABASE} WITH (FORCE)`);
  psqlMaintenance(
    `CREATE DATABASE ${SCENARIO_DATABASE} TEMPLATE "${getTestTemplateDatabase()}"`,
  );

  const { runScenarios } = await import("./scenario-run.ts");
  try {
    const outcome = await runScenarios({
      options,
      plan,
      corpus,
      lake,
      bundleRoot: path.join(root, "runs"),
    });
    if (!outcome.passed) process.exitCode = 1;
  } finally {
    // A run that dies before here leaves the lock; the next run sees its pid
    // is gone and takes it over.
    await rm(lockPath, { force: true });
  }
}

await main().catch((error: unknown) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
