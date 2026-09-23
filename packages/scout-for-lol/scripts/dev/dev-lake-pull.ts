import { mkdir, rm, rename } from "node:fs/promises";
import path from "node:path";
import {
  USAGE,
  buildEntryFileCountCommand,
  buildEntryTarCommand,
  buildTableListCommand,
  currentBuildCommand,
  datasetPinPath,
  parseDevLakePullArgs,
  type DevLakePullOptions,
} from "./dev-lake-pull-plan.ts";
import { publishedBuildId } from "./dev-lake-seed.ts";

/**
 * Copy a stage's published report-lake build onto this machine.
 *
 * Thin on purpose: every decision that can be wrong lives in
 * `dev-lake-pull-plan.ts`, which has tests. This file only runs the commands
 * that module chose.
 */

async function run(
  command: readonly string[],
  description: string,
): Promise<string> {
  const child = Bun.spawn([...command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${description} failed (exit ${exitCode.toString()}): ${stderr.trim()}`,
    );
  }
  return stdout;
}

/** The one ready backend pod holding this stage's lake. */
async function resolvePod(options: DevLakePullOptions): Promise<string> {
  const output = await run(
    [
      "kubectl",
      "get",
      "pods",
      "-n",
      options.target.namespace,
      "-l",
      options.target.selector,
      "--field-selector=status.phase=Running",
      "-o",
      String.raw`jsonpath={range .items[*]}{.metadata.name}{'\n'}{end}`,
    ],
    "Listing backend pods",
  );
  const pods = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const pod = pods[0];
  if (pod === undefined) {
    throw new Error(
      `No running pod matches ${options.target.selector} in ${options.target.namespace}.`,
    );
  }
  if (pods.length > 1) {
    // The deployment is Recreate with one replica, so more than one running
    // pod means a rollout is mid-flight and the two may hold different builds.
    // Picking one silently would pin a dataset nobody can reproduce.
    throw new Error(
      `Expected one backend pod, found ${pods.length.toString()}: ${pods.join(", ")}. Wait for the rollout to settle.`,
    );
  }
  return pod;
}

function execArgs(
  options: DevLakePullOptions,
  pod: string,
  command: readonly string[],
): readonly string[] {
  return [
    "kubectl",
    "exec",
    "-n",
    options.target.namespace,
    pod,
    "--",
    ...command,
  ];
}

/** How many times one entry's transfer is retried before the pull gives up. */
const ENTRY_ATTEMPTS = 3;

/**
 * Stream one entry of the build out of the pod and unpack it locally.
 *
 * Piped rather than written to a temporary archive, and per-entry rather than
 * whole-build: a single ~900 MB `kubectl exec` pipe truncates in practice.
 */
type EntryPull = {
  readonly options: DevLakePullOptions;
  readonly pod: string;
  readonly buildId: string;
  readonly entry: string;
  readonly buildDir: string;
};

async function extractEntry(input: EntryPull): Promise<void> {
  const { options, pod, buildId, entry, buildDir } = input;
  const source = Bun.spawn(
    [
      ...execArgs(
        options,
        pod,
        buildEntryTarCommand(options.target, buildId, entry),
      ),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const sink = Bun.spawn(["tar", "-xf", "-", "-C", buildDir], {
    stdin: source.stdout,
    stdout: "inherit",
    stderr: "pipe",
  });
  const [sourceStderr, sinkStderr, sourceExit, sinkExit] = await Promise.all([
    new Response(source.stderr).text(),
    new Response(sink.stderr).text(),
    source.exited,
    sink.exited,
  ]);
  if (sourceExit !== 0) {
    throw new Error(
      `Reading ${entry} failed (exit ${sourceExit.toString()}): ${sourceStderr.trim()}`,
    );
  }
  if (sinkExit !== 0) {
    throw new Error(
      `Unpacking ${entry} failed (exit ${sinkExit.toString()}): ${sinkStderr.trim()}`,
    );
  }
}

/**
 * Local file count for one extracted entry.
 *
 * Counted in-process rather than through `sh -c`: interpolating a path into a
 * shell pipeline means a destination like `/tmp/My Data/report-lake` is split
 * into two `find` arguments, so every integrity check fails, and a path with
 * shell metacharacters would run something else entirely. The count is the
 * evidence a transfer arrived whole, so it must not depend on how the path is
 * spelled.
 */
async function localFileCount(dir: string): Promise<number> {
  let total = 0;
  for await (const _entry of new Bun.Glob("**/*").scan({
    cwd: dir,
    onlyFiles: true,
    dot: true,
  })) {
    total += 1;
  }
  return total;
}

/**
 * Copy one entry and prove it arrived whole.
 *
 * The file count is compared against the pod's rather than trusting tar's exit
 * status: a truncated stream is exactly the failure this pull hit, and a
 * silently short table would produce a lake that queries fine and answers
 * wrong.
 */
async function pullEntry(input: EntryPull): Promise<void> {
  const { options, pod, buildId, entry, buildDir } = input;
  const counted = await run(
    [
      ...execArgs(
        options,
        pod,
        buildEntryFileCountCommand(options.target, buildId, entry),
      ),
    ],
    `Counting ${entry} on ${pod}`,
  );
  const expected = Number(counted.trim());

  for (let attempt = 1; attempt <= ENTRY_ATTEMPTS; attempt += 1) {
    await rm(path.join(buildDir, entry), { recursive: true, force: true });
    try {
      await extractEntry(input);
      const actual = await localFileCount(path.join(buildDir, entry));
      if (actual === expected) {
        process.stdout.write(`  ${entry}: ${actual.toString()} files\n`);
        return;
      }
      throw new Error(
        `expected ${expected.toString()} files, got ${actual.toString()}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === ENTRY_ATTEMPTS) {
        throw new Error(
          `${entry} did not transfer intact after ${ENTRY_ATTEMPTS.toString()} attempts: ${message}`,
          { cause: error },
        );
      }
      process.stdout.write(
        `  ${entry}: attempt ${attempt.toString()} failed (${message}); retrying\n`,
      );
    }
  }
}

async function main(): Promise<void> {
  const parsed = parseDevLakePullArgs(Bun.argv.slice(2), Bun.env);
  if (parsed.kind === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const options = parsed.options;
  const pod = await resolvePod(options);

  const currentPointer = await run(
    [...execArgs(options, pod, currentBuildCommand(options.target))],
    "Reading CURRENT",
  );
  const buildId = currentPointer.trim();
  if (buildId.length === 0) {
    throw new Error(
      `${options.target.lakeDir}/CURRENT on ${pod} is empty; the stage has published no build.`,
    );
  }

  process.stdout.write(
    `Pulling ${options.stage} build ${buildId} from ${pod}…\n`,
  );

  // Staged then renamed, so an interrupted pull never leaves a half-copied
  // tree where a complete dataset is expected.
  await rm(options.staging, { recursive: true, force: true });
  const buildDir = path.join(options.staging, "builds", buildId);
  await mkdir(buildDir, { recursive: true });

  const listing = await run(
    [...execArgs(options, pod, buildTableListCommand(options.target, buildId))],
    "Listing build entries",
  );
  const entries = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (entries.length === 0) {
    throw new Error(`Build ${buildId} on ${pod} is empty.`);
  }

  for (const entry of entries) {
    await pullEntry({ options, pod, buildId, entry, buildDir });
  }

  // Published builds are immutable, but the compactor keeps only the newest
  // two, and a fold lands every fifteen minutes. A long pull can therefore
  // outlive the build it is reading — so confirm it is still there rather than
  // installing a tree that was collected halfway through.
  const stillPresent = await run(
    [...execArgs(options, pod, buildTableListCommand(options.target, buildId))],
    "Re-checking the build after copying",
  );
  if (stillPresent.trim().length === 0) {
    throw new Error(
      `Build ${buildId} was garbage-collected while it was being copied. Re-run; the pull will pick up the newer published build.`,
    );
  }

  await Bun.write(path.join(options.staging, "CURRENT"), `${buildId}\n`);

  const staged = await publishedBuildId(options.staging);
  if (staged !== buildId) {
    throw new Error(
      `Staged lake does not resolve to ${buildId} (got ${staged ?? "nothing"}); refusing to install it.`,
    );
  }

  await rm(options.destination, { recursive: true, force: true });
  await rename(options.staging, options.destination);

  process.stdout.write(
    [
      `Installed ${options.stage} lake build ${buildId} at ${options.destination}`,
      "",
      "Next, pull the matching database — in this order, so the database is the",
      "later of the two and every identity the lake references exists in it:",
      "",
      `  bun run --filter='./packages/scout-for-lol' dev:db-pull -- --stage ${options.stage}`,
      "",
      `Then record both halves in ${datasetPinPath(options.stage, Bun.env)}.`,
      "",
    ].join("\n"),
  );
}

await main();
