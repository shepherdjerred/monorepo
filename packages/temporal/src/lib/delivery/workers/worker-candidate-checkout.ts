import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

/**
 * Prepare the exact candidate source without moving controller HEAD.
 *
 * A candidate at the executor's revision reuses the checkout the bootstrap
 * already installed and generated. Any other candidate becomes a detached
 * worktree of the executor's object store: a blobless fetch adds only its
 * commit and trees, and checkout downloads just the blobs the executor lacks.
 * Its install shares the Job's Bun cache on the same filesystem, so packages
 * the executor already extracted are linked rather than written again.
 */
export async function withWorkerCandidateCheckout<T>(
  checkout: {
    sourceRevision: unknown;
    target: z.infer<typeof WorkerDeploymentRolloutTargetSchema>;
    executor: ExecutorCheckout;
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
  const directory = reuse
    ? executor.root
    : await mkdtemp(path.join(tmpdir(), "delivery-worker-candidate-"));
  const run: RolloutCommandRunner = (argv) => execute(argv, directory);
  const inExecutor: RolloutCommandRunner = (argv) =>
    execute(argv, executor.root);
  const cwd = path.join(directory, "packages/temporal");
  const candidate: RolloutCommandRunner = async (argv) => {
    if (argv[0] === "git") return await execute(argv, cwd);
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
  const added = { worktree: false };
  try {
    await timedWorkerPhase("candidate-checkout", preparation, async () => {
      if (!reuse) {
        for (const [key, value] of [
          ["remote.origin.url", MONOREPO],
          ["remote.origin.promisor", "true"],
          ["remote.origin.partialclonefilter", "blob:none"],
        ] as const)
          await inExecutor(["git", "config", key, value]);
        await inExecutor([
          "git",
          "fetch",
          "--quiet",
          "--no-tags",
          "--depth=1",
          "--filter=blob:none",
          "origin",
          source,
        ]);
        await inExecutor([
          "git",
          "worktree",
          "add",
          "--quiet",
          "--detach",
          directory,
          source,
        ]);
        added.worktree = true;
      }
      await requireReplayCheckout(source, run);
    });
    if (!reuse)
      await timedWorkerPhase("candidate-install", preparation, async () => {
        await run(["mise", "trust", ".mise.toml"]);
        await run(["mise", "install", "--yes", "bun", "node"]);
        await run([
          "mise",
          "exec",
          "--",
          "bun",
          "install",
          "--frozen-lockfile",
        ]);
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
  } finally {
    if (!reuse) {
      if (added.worktree)
        await inExecutor(["git", "worktree", "remove", "--force", directory]);
      await rm(directory, { recursive: true, force: true });
    }
  }
}
