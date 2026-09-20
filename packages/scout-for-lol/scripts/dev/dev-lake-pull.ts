import { mkdir, rm, rename } from "node:fs/promises";
import path from "node:path";
import {
  USAGE,
  buildTarCommand,
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

/**
 * Stream the build out of the pod and unpack it locally.
 *
 * Piped rather than written to a temporary archive: a published lake build is
 * large, and a `kubectl cp` of the same tree is markedly slower and silently
 * skips files it cannot stat.
 */
async function extractBuild(
  options: DevLakePullOptions,
  pod: string,
  buildId: string,
  buildsDir: string,
): Promise<void> {
  const source = Bun.spawn(
    [...execArgs(options, pod, buildTarCommand(options.target, buildId))],
    { stdout: "pipe", stderr: "pipe" },
  );
  const sink = Bun.spawn(["tar", "-xf", "-", "-C", buildsDir], {
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
      `Reading build ${buildId} from ${pod} failed (exit ${sourceExit.toString()}): ${sourceStderr.trim()}`,
    );
  }
  if (sinkExit !== 0) {
    throw new Error(
      `Unpacking build ${buildId} failed (exit ${sinkExit.toString()}): ${sinkStderr.trim()}`,
    );
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
  const buildsDir = path.join(options.staging, "builds");
  await mkdir(buildsDir, { recursive: true });
  await extractBuild(options, pod, buildId, buildsDir);
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
