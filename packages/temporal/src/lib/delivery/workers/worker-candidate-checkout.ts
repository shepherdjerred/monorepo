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

/** Bounded, credential-scoped subprocess path shared with control-plane replay. */
export async function candidateSourceCommand(
  argv: readonly string[],
  cwd: string,
  environment: Record<string, string | undefined>,
) {
  const child = Bun.spawn([...argv], {
    cwd,
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of child.stdout) {
    bytes += chunk.byteLength;
    if (bytes > 4 * 1024 * 1024) {
      child.kill("SIGKILL");
      await child.exited;
      throw new Error("Candidate proof output exceeded its bound");
    }
    chunks.push(chunk);
  }
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    const family = candidateCommandFamily(argv);
    throw new Error(
      `Exact candidate source preparation/replay/canary failed (${family}; exit ${String(exitCode)}; signal ${String(child.signalCode)})`,
    );
  }
  return { stdout: Buffer.concat(chunks).toString("utf8"), stderr: "" };
}

/** Candidate children receive only tool locations and the fixed internal connection. */
async function candidateCommand(
  argv: readonly string[],
  cwd: string,
  namespace: string,
) {
  return await candidateSourceCommand(argv, cwd, {
    PATH: Bun.env["PATH"],
    HOME: Bun.env["HOME"],
    TMPDIR: Bun.env["TMPDIR"],
    MISE_DATA_DIR: Bun.env["MISE_DATA_DIR"],
    MISE_LOCKED: "1",
    TEMPORAL_ADDRESS:
      "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    TEMPORAL_NAMESPACE: namespace,
    TEMPORAL_TLS: "false",
  });
}

/** Mirrors the isolated control-plane replay checkout, never moving controller HEAD. */
export async function withWorkerCandidateCheckout<T>(
  sourceRevision: unknown,
  target: z.infer<typeof WorkerDeploymentRolloutTargetSchema>,
  use: (candidate: RolloutCommandRunner) => Promise<T>,
  effects: {
    execute?: CandidateCommand;
    replayArguments?: typeof workerReplayArguments;
  } = {},
): Promise<T> {
  const source = WorkerBuildIdSchema.parse(sourceRevision);
  const execute =
    effects.execute ??
    ((argv, cwd) =>
      candidateCommand(argv, cwd, workerReplayRoute(target).namespace));
  const replayArguments = effects.replayArguments ?? workerReplayArguments;
  const directory = await mkdtemp(
    path.join(tmpdir(), "delivery-worker-candidate-"),
  );
  const run: RolloutCommandRunner = (argv) => execute(argv, directory);
  const candidate: RolloutCommandRunner = async (argv) =>
    execute(
      argv[0] === "git"
        ? argv
        : [
            "mise",
            "exec",
            "--",
            ...argv,
            ...(argv.includes("replay:candidate-histories")
              ? await replayArguments(directory, target)
              : []),
          ],
      path.join(directory, "packages/temporal"),
    );
  try {
    await run(["git", "init", "--quiet"]);
    await run([
      "git",
      "fetch",
      "--quiet",
      "--depth=1",
      "https://github.com/shepherdjerred/monorepo.git",
      source,
    ]);
    await run(["git", "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
    await requireReplayCheckout(source, run);
    await run(["mise", "trust", ".mise.toml"]);
    await run(["mise", "install", "--yes", "bun", "node"]);
    await run(["mise", "exec", "--", "bun", "install", "--frozen-lockfile"]);
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
    for (const packageName of [
      "home-assistant",
      "llm-models",
      "glitter-context",
    ])
      await execute(
        ["mise", "exec", "--", "bun", "run", "build"],
        path.join(directory, "packages", packageName),
      );
    await requireReplayCheckout(source, candidate);
    return await use(candidate);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
