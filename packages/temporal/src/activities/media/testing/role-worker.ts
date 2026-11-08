import path from "node:path";
import { rm } from "node:fs/promises";
import type { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";

export const mediaWorkflowWorkerScript = new URL(
  "../../../../scripts/media-system/workflow-worker.ts",
  import.meta.url,
).pathname;

export function movieWorkflowChildEnvironment() {
  const runtimePath = Bun.env["PATH"];
  if (runtimePath === undefined || runtimePath.length === 0)
    throw new Error("Pinned runtime PATH required");
  return { PATH: runtimePath };
}

export function createMovieRoleEnvironment(temporal: string) {
  return TestWorkflowEnvironment.createLocal({
    server: {
      executable: { type: "existing-path", path: temporal },
      ip: "127.0.0.1",
      namespace: "dev",
      ui: false,
    },
  });
}

type MovieRoleFixtureLifetime = {
  workflow: Pick<Bun.Subprocess, "kill" | "exited"> | undefined;
  fixture: { close: () => Promise<void> } | undefined;
  environment: Pick<TestWorkflowEnvironment, "teardown">;
  directory: string;
};

async function closeMovieFixtureResources(input: MovieRoleFixtureLifetime) {
  try {
    await input.fixture?.close();
  } finally {
    await input.environment.teardown();
    await rm(input.directory, { recursive: true, force: true });
  }
}

/** Preserve sequential stop semantics for the existing single/optional-role tests. */
export async function closeMovieRoleFixtureSequential(
  input: MovieRoleFixtureLifetime & { stopActivities: () => Promise<void> },
) {
  try {
    await input.stopActivities();
    if (input.workflow !== undefined) {
      input.workflow.kill("SIGTERM");
      await input.workflow.exited;
    }
  } finally {
    await closeMovieFixtureResources(input);
  }
}

/** Drain owned Activities before stopping their Node poller and fixture. */
export async function closeMovieRoleFixture(
  input: MovieRoleFixtureLifetime & {
    workers: readonly Pick<Worker, "shutdown">[];
    running: readonly Promise<void>[];
  },
) {
  try {
    try {
      for (const worker of input.workers) worker.shutdown();
      await Promise.all(input.running);
    } finally {
      if (input.workflow !== undefined) {
        input.workflow.kill("SIGTERM");
        await input.workflow.exited;
      }
    }
  } finally {
    await closeMovieFixtureResources(input);
  }
}

export function pinnedMovieRuntimes() {
  const temporal = pinnedRuntime("temporal");
  return { temporal, node: pinnedRuntime("node") };
}

function pinnedRuntime(name: "temporal" | "node") {
  const resolved = Bun.spawnSync(["mise", "which", name], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (resolved.exitCode !== 0) throw new Error(`Pinned ${name} required`);
  const filename = resolved.stdout.toString().trim();
  if (filename.length === 0) throw new Error(`Pinned ${name} required`);
  return filename;
}

/** Credentialless Node child owns only Workflow execution; the caller owns its lifetime. */
export async function startMovieWorkflowWorker(options: {
  node: string;
  script: string;
  address: string;
  directory: string;
  childEnvironment: { PATH: string };
  namespace?: "dev" | "default";
}) {
  const marker = path.join(options.directory, "ready");
  const workflow = Bun.spawn(
    [
      options.node,
      "--experimental-strip-types",
      options.script,
      "run",
      options.address.replace(/^localhost:/u, "127.0.0.1:"),
      marker,
      options.namespace ?? "dev",
    ],
    {
      env: options.childEnvironment,
      stdin: "ignore",
      stdout: Bun.file(path.join(options.directory, "workflow.log")),
      stderr: Bun.file(path.join(options.directory, "workflow-errors.log")),
    },
  );
  try {
    const deadline = performance.now() + 30_000;
    while (!(await Bun.file(marker).exists())) {
      if (workflow.exitCode !== null || performance.now() >= deadline)
        throw new Error(
          `Workflow worker startup failed; inspect ${options.directory}`,
        );
      await Bun.sleep(100);
    }
    return workflow;
  } catch (error) {
    workflow.kill("SIGTERM");
    await workflow.exited;
    throw error;
  }
}
