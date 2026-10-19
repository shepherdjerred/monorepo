import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkerBuildIdSchema } from "#shared/infra/temporal-bootstrap.ts";
import {
  requireReplayCheckout,
  type RolloutCommandRunner,
} from "#lib/worker-deployment-proofs.ts";

type CandidateCommand = (
  argv: readonly string[],
  cwd: string,
) => ReturnType<RolloutCommandRunner>;

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
  if ((await child.exited) !== 0)
    throw new Error("Exact candidate source preparation/replay/canary failed");
  return { stdout: Buffer.concat(chunks).toString("utf8"), stderr: "" };
}

/** Candidate children receive only tool locations and the fixed internal connection. */
async function candidateCommand(argv: readonly string[], cwd: string) {
  return await candidateSourceCommand(argv, cwd, {
    PATH: Bun.env["PATH"],
    HOME: Bun.env["HOME"],
    TMPDIR: Bun.env["TMPDIR"],
    MISE_DATA_DIR: Bun.env["MISE_DATA_DIR"],
    MISE_LOCKED: "1",
    TEMPORAL_ADDRESS:
      "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    TEMPORAL_NAMESPACE: "prod",
    TEMPORAL_TLS: "false",
    TEMPORAL_REPLAY_WORKFLOW_IDS: Bun.env["TEMPORAL_REPLAY_WORKFLOW_IDS"],
  });
}

/** Mirrors the isolated control-plane replay checkout, never moving controller HEAD. */
export async function withWorkerCandidateCheckout<T>(
  sourceRevision: unknown,
  use: (candidate: RolloutCommandRunner) => Promise<T>,
  execute: CandidateCommand = candidateCommand,
): Promise<T> {
  const source = WorkerBuildIdSchema.parse(sourceRevision);
  const directory = await mkdtemp(
    path.join(tmpdir(), "delivery-worker-candidate-"),
  );
  const run: RolloutCommandRunner = (argv) => execute(argv, directory);
  const candidate: RolloutCommandRunner = (argv) =>
    execute(
      argv[0] === "git" ? argv : ["mise", "exec", "--", ...argv],
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
