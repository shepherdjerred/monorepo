import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  DELIVERY_JOB_BYTE_EXACT_ATTRIBUTES,
  DELIVERY_JOB_GIT_ENVIRONMENT,
  DELIVERY_JOB_INSTALL_MARKER,
} from "#shared/delivery-job.ts";
import { WorkerBuildIdSchema } from "#shared/infra/temporal-bootstrap.ts";
import {
  requireReplayCheckout,
  type RolloutCommandRunner,
} from "#lib/worker-deployment-proofs.ts";
import type { z } from "zod";
import type { WorkerDeploymentRolloutTargetSchema } from "#lib/worker-deployment-target.ts";
import {
  workerReplayRoute,
  workerReplayArguments,
} from "#lib/delivery/workers/worker-replay-targets.ts";
import { timedWorkerPhase } from "#lib/delivery/workers/worker-phase-timing.ts";

type CandidateCommand = (
  argv: readonly string[],
  cwd: string,
) => ReturnType<RolloutCommandRunner>;

function candidateCommandFamily(argv: readonly string[]) {
  if (argv.includes("test:workflows")) return "workflow-unit-tests";
  if (argv.includes("replay:candidate-histories")) return "history-replay";
  if (argv.some((value) => value.includes("canary"))) return "canary";
  return argv[0] === "git" ? "checkout" : "preparation";
}

const CANDIDATE_OUTPUT_BOUND = 4 * 1024 * 1024;
const CANDIDATE_FAILURE_TAIL = 64 * 1024;

/** Receives a failed candidate's output tail; the default is the Job log. */
export type CandidateFailureLog = (text: string) => void;

const stderrText: CandidateFailureLog = (text) => {
  process.stderr.write(text);
};

class CandidateOutputBoundError extends Error {
  constructor() {
    super("Candidate proof output exceeded its bound");
  }
}

/**
 * Write the last bytes of a failed child's combined output to the Job log, so
 * an operator reading `kubectl logs` sees which test or step failed. Callers
 * give children a reduced environment (see workerCandidateEnvironment), so
 * their output holds no credentials.
 */
function logCandidateFailure(
  family: string,
  outcome: string,
  combined: readonly Uint8Array[],
  log: CandidateFailureLog,
) {
  const output = Buffer.concat(combined);
  const tail = output.subarray(
    Math.max(0, output.byteLength - CANDIDATE_FAILURE_TAIL),
  );
  const scope =
    tail.byteLength === output.byteLength
      ? "full output"
      : `last ${String(tail.byteLength)} of ${String(output.byteLength)} bytes`;
  const text = tail.toString("utf8");
  const separator = text.length === 0 || text.endsWith("\n") ? "" : "\n";
  log(
    `----- candidate ${family} failed (${outcome}); ${scope} of stdout+stderr -----\n` +
      `${text}${separator}----- end candidate ${family} output -----\n`,
  );
}

/** Bounded, credential-scoped subprocess path shared with control-plane replay. */
export async function candidateSourceCommand(
  argv: readonly string[],
  cwd: string,
  environment: Record<string, string | undefined>,
  log: CandidateFailureLog = stderrText,
) {
  const child = Bun.spawn([...argv], {
    cwd,
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout: Uint8Array[] = [];
  // Both streams in arrival order, under one shared bound, for a failure tail.
  const combined: Uint8Array[] = [];
  let bytes = 0;
  const drain = async (
    stream: ReadableStream<Uint8Array>,
    keep: Uint8Array[] | undefined,
  ) => {
    for await (const chunk of stream) {
      bytes += chunk.byteLength;
      if (bytes > CANDIDATE_OUTPUT_BOUND) throw new CandidateOutputBoundError();
      combined.push(chunk);
      keep?.push(chunk);
    }
  };
  const family = candidateCommandFamily(argv);
  try {
    await Promise.all([
      drain(child.stdout, stdout),
      drain(child.stderr, undefined),
    ]);
  } catch (error) {
    if (!(error instanceof CandidateOutputBoundError)) throw error;
    child.kill("SIGKILL");
    await child.exited;
    logCandidateFailure(family, "output exceeded its bound", combined, log);
    throw error;
  }
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    const outcome = `exit ${String(exitCode)}; signal ${String(child.signalCode)}`;
    logCandidateFailure(family, outcome, combined, log);
    throw new Error(
      `Exact candidate source preparation/replay/canary failed (${family}; ${outcome})`,
    );
  }
  return { stdout: Buffer.concat(stdout).toString("utf8"), stderr: "" };
}

/** Candidate children receive only tool locations, a fixed identity and the internal connection. */
export function workerCandidateEnvironment(namespace: string) {
  return {
    PATH: Bun.env["PATH"],
    HOME: Bun.env["HOME"],
    TMPDIR: Bun.env["TMPDIR"],
    // The job workspace is mode 0777, which @swc/core rejects as a cache
    // ancestor. The child keeps a private cache under the job home.
    SWC_NATIVE_BINDING_CACHE: `${Bun.env["HOME"] ?? "/workspace/home"}/.cache`,
    SWC_NATIVE_BINDING_CACHE_SKIP_SECURITY_CHECK: "1",
    MISE_DATA_DIR: Bun.env["MISE_DATA_DIR"],
    MISE_LOCKED: "1",
    // The checkout installs its own bun and node first. Without this, the first
    // `mise exec` also installs every other configured tool the unprivileged
    // Job cannot read from the image, such as a 1.6 GB Rust toolchain.
    MISE_EXEC_AUTO_INSTALL: "false",
    // Temporal's non-cgo Linux CLI needs an explicit identity for os/user.Current.
    USER: "delivery",
    TEMPORAL_ADDRESS:
      "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    TEMPORAL_NAMESPACE: namespace,
    TEMPORAL_TLS: "false",
    // The job home is on the kept claim; a candidate test could leave Git
    // configuration there that runs code or hides a changed tracked file.
    ...DELIVERY_JOB_GIT_ENVIRONMENT,
  };
}

async function candidateCommand(
  argv: readonly string[],
  cwd: string,
  namespace: string,
) {
  return await candidateSourceCommand(
    argv,
    cwd,
    workerCandidateEnvironment(namespace),
  );
}

/** The Job's own prepared checkout, at the qualified executor revision. */
export type ExecutorCheckout = { root: string; revision: string };

const MONOREPO = "https://github.com/shepherdjerred/monorepo.git";

/** Whether a filesystem error says the path does not exist. */
function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Whether anything, even a dangling symlink, is at `target`. */
async function present(target: string) {
  return await lstat(target).then(
    () => true,
    (error: unknown) => {
      if (missing(error)) return false;
      throw error;
    },
  );
}

/** `target` with every symlink in its existing part resolved; it need not exist. */
async function canonical(target: string): Promise<string> {
  const absolute = path.resolve(target);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (!missing(error)) throw error;
    const parent = path.dirname(absolute);
    return parent === absolute
      ? absolute
      : path.join(await canonical(parent), path.basename(absolute));
  }
}

/**
 * Remove every `.git` in `root`'s tree except its own and those inside
 * `node_modules`. `git clean` never lists one under a tracked directory, and a
 * Git command run below it would otherwise answer from that repository.
 */
async function removeNestedRepositories(root: string) {
  const pending = [root];
  for (
    let directory = pending.pop();
    directory !== undefined;
    directory = pending.pop()
  )
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (directory !== root && entry.name === ".git")
        await rm(entryPath, { recursive: true, force: true });
      else if (
        entry.isDirectory() &&
        entry.name !== ".git" &&
        entry.name !== "node_modules"
      )
        pending.push(entryPath);
    }
}

/** Whether `child` is `parent` or lies under it. */
function within(child: string, parent: string) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/**
 * Make `candidateRoot` a real directory that neither is, nor contains, nor
 * lies inside the executor's checkout, whose tree and repository the
 * candidate's reset and clean would otherwise rewrite or remove. Anything
 * else kept at the candidate root, such as a symlink a candidate test left,
 * is removed first (a symlink itself, never what it names).
 */
async function prepareCandidateRoot(
  candidateRoot: string,
  executorRoot: string,
) {
  if (await present(candidateRoot)) {
    const kept = await lstat(candidateRoot);
    if (!kept.isDirectory()) await rm(candidateRoot);
  }
  const [candidate, executor] = await Promise.all([
    canonical(candidateRoot),
    canonical(executorRoot),
  ]);
  if (within(candidate, executor) || within(executor, candidate))
    throw new Error("Candidate checkout must not replace the executor's");
  await mkdir(candidateRoot, { recursive: true });
}

/**
 * Bring the kept candidate tree at `directory` to exactly `source`, writing
 * only what differs from the previous candidate.
 *
 * The repository metadata is created fresh, as the bootstrap does for the
 * executor, and every Git command reads only its configuration
 * (workerCandidateEnvironment): its objects come from the executor's
 * repository (and through it the claim's verified store) by alternates, so a
 * blobless fetch negotiates against the executor's revision and adds only the
 * candidate's new commit and trees, and the checkout fetches just the blobs
 * neither holds. The index starts with no stat data, so
 * `update-index --refresh` hashes every tracked file's exact bytes
 * (DELIVERY_JOB_BYTE_EXACT_ATTRIBUTES) against the candidate's tree.
 * Everything untracked except `node_modules`, nested repositories and a stray
 * `.gitattributes` included, is then removed, as is any `.git` below the root
 * outside `node_modules`, and `reset --hard` rewrites
 * exactly the files whose bytes differ, with the candidate's own attributes.
 * `node_modules` is kept only when the previous candidate's install
 * completed (DELIVERY_JOB_INSTALL_MARKER); otherwise every `node_modules` is
 * removed with the rest. `requireReplayCheckout` still proves the revision
 * and a clean tracked tree afterwards.
 */
async function prepareCandidateCheckout(
  directory: string,
  source: string,
  executor: ExecutorCheckout,
  run: RolloutCommandRunner,
) {
  const git = path.join(directory, ".git");
  const marker = path.join(directory, DELIVERY_JOB_INSTALL_MARKER);
  const installed = await Bun.file(marker).exists();
  await rm(git, { recursive: true, force: true });
  await run(["git", "init", "--quiet"]);
  // Nothing has touched node_modules yet; the install removes this again.
  if (installed) await writeFile(marker, "");
  await mkdir(path.join(git, "objects/info"), { recursive: true });
  await writeFile(
    path.join(git, "objects/info/alternates"),
    `${path.join(executor.root, ".git/objects")}\n`,
  );
  // The executor's revision is shallow; without its boundary Git would walk
  // to that revision's missing parent while negotiating.
  const shallow = path.join(executor.root, ".git/shallow");
  if (await Bun.file(shallow).exists())
    await copyFile(shallow, path.join(git, "shallow"));
  for (const [key, value] of [
    // Git reads ~/.config/git/attributes unless configuration names a file.
    ["core.attributesFile", "/dev/null"],
    ["remote.origin.url", MONOREPO],
    ["remote.origin.promisor", "true"],
    ["remote.origin.partialclonefilter", "blob:none"],
  ] as const)
    await run(["git", "config", key, value]);
  await run([
    "git",
    "fetch",
    "--quiet",
    "--no-tags",
    "--depth=1",
    "--filter=blob:none",
    "origin",
    source,
  ]);
  await run(["git", "update-ref", "--no-deref", "HEAD", source]);
  await run(["git", "read-tree", "HEAD"]);
  const attributes = path.join(git, "info/attributes");
  await mkdir(path.dirname(attributes), { recursive: true });
  await writeFile(attributes, `${DELIVERY_JOB_BYTE_EXACT_ATTRIBUTES}\n`);
  await run(["git", "update-index", "-q", "--refresh"]);
  await rm(attributes);
  if (!installed && (await present(path.join(directory, "node_modules"))))
    console.warn(
      JSON.stringify({
        kind: "delivery-stage-workspace",
        event: "install-reset",
        checkout: "candidate",
        detail:
          "node_modules has no completed install; this Job removes it and installs from scratch",
      }),
    );
  await run([
    "git",
    "clean",
    "-ffdxq",
    ...(installed ? ["-e", "node_modules"] : []),
  ]);
  await removeNestedRepositories(directory);
  await run(["git", "reset", "-q", "--hard"]);
}

/**
 * Prepare the exact candidate source without moving controller HEAD.
 *
 * A candidate at the executor's revision reuses the checkout the bootstrap
 * already installed and generated. Any other candidate is prepared in
 * `candidateRoot`, a tree the stage claim keeps across Jobs beside the
 * executor's (see prepareCandidateCheckout): consecutive Jobs of one rollout
 * name the same candidate and successive rollouts' candidates differ by a few
 * commits, so the checkout and `bun install --frozen-lockfile` write only that
 * difference instead of a whole tree and `node_modules`. Its install shares
 * the Job's Bun cache.
 */
export async function withWorkerCandidateCheckout<T>(
  checkout: {
    sourceRevision: unknown;
    target: z.infer<typeof WorkerDeploymentRolloutTargetSchema>;
    executor: ExecutorCheckout;
    candidateRoot: string;
  },
  use: (candidate: RolloutCommandRunner) => Promise<T>,
  effects: {
    execute?: CandidateCommand;
    replayArguments?: typeof workerReplayArguments;
  } = {},
): Promise<T> {
  const { target, executor } = checkout;
  const source = WorkerBuildIdSchema.parse(checkout.sourceRevision);
  WorkerBuildIdSchema.parse(executor.revision);
  const execute =
    effects.execute ??
    ((argv, cwd) =>
      candidateCommand(argv, cwd, workerReplayRoute(target).namespace));
  const replayArguments = effects.replayArguments ?? workerReplayArguments;
  const reuse = source === executor.revision;
  const directory = reuse ? executor.root : checkout.candidateRoot;
  if (!reuse) await prepareCandidateRoot(directory, executor.root);
  const run: RolloutCommandRunner = (argv) => execute(argv, directory);
  const cwd = path.join(directory, "packages/temporal");
  const candidate: RolloutCommandRunner = async (argv) => {
    // Git answers for the candidate tree's own repository, at its root.
    if (argv[0] === "git") return await execute(argv, directory);
    const family = candidateCommandFamily(argv);
    const flag = argv.indexOf("--namespace");
    const namespace = flag === -1 ? undefined : argv[flag + 1];
    const detail = namespace === undefined ? {} : { namespace };
    const replay = argv.includes("replay:candidate-histories")
      ? await timedWorkerPhase("history-replay-selection", {}, () =>
          replayArguments(directory, target),
        )
      : [];
    return await timedWorkerPhase(family, detail, () =>
      execute(["mise", "exec", "--", ...argv, ...replay], cwd),
    );
  };
  const preparation = { reuse: String(reuse) };
  // The kept candidate tree is not removed afterwards: the next Job resets it
  // to its own candidate before using it (prepareCandidateCheckout).
  await timedWorkerPhase("candidate-checkout", preparation, async () => {
    if (!reuse)
      await prepareCandidateCheckout(directory, source, executor, run);
    await requireReplayCheckout(source, run);
  });
  if (!reuse)
    await timedWorkerPhase("candidate-install", preparation, async () => {
      // Absent from here until the install completes, so an install cut
      // short leaves no marker and the next Job starts it from scratch.
      const marker = path.join(directory, DELIVERY_JOB_INSTALL_MARKER);
      await rm(marker, { force: true });
      await run(["mise", "trust", ".mise.toml"]);
      await run(["mise", "install", "--yes", "bun", "node"]);
      await run(["mise", "exec", "--", "bun", "install", "--frozen-lockfile"]);
      await writeFile(marker, "");
      await run([
        "mise",
        "exec",
        "--",
        "bunx",
        "turbo",
        "run",
        "generate",
        "--filter=@shepherdjerred/temporal^...",
      ]);
    });
  await timedWorkerPhase("candidate-build", preparation, async () => {
    for (const packageName of [
      "home-assistant",
      "llm-models",
      "glitter-context",
    ])
      await execute(
        ["mise", "exec", "--", "bun", "run", "build"],
        path.join(directory, "packages", packageName),
      );
  });
  await requireReplayCheckout(source, candidate);
  return await use(candidate);
}
