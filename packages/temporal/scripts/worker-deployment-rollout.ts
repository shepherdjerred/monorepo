import { z } from "zod";
import {
  executeWorkerDeploymentRollout,
  type WorkerDeploymentRolloutOptions,
} from "#lib/worker-deployment-rollout.ts";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  optionalArgument,
  requiredArgument,
  requiredEnvironment,
} from "./cli-arguments.ts";

const ACTIONS = new Set(["status", "start", "advance", "promote", "rollback"]);
const TemporalTlsSchema = z.enum(["true", "false"]).optional();

const runCommand: RolloutCommandRunner = async (command) => {
  const child = Bun.spawn([...command], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
    env: Bun.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command[0] ?? "command"} failed with exit ${String(exitCode)}: ${stderr.trim()}`,
    );
  }
  return { stdout, stderr };
};

function actionFrom(args: string[]): WorkerDeploymentRolloutOptions["action"] {
  const action = args[0];
  if (action === undefined || !ACTIONS.has(action)) {
    throw new Error(
      "Usage: bun run worker-deployment <status|start|advance|promote|rollback> --build-id <image-git-sha>",
    );
  }
  if (
    action !== "status" &&
    action !== "start" &&
    action !== "advance" &&
    action !== "promote" &&
    action !== "rollback"
  ) {
    throw new Error(`Unsupported action ${action}`);
  }
  return action;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tls = TemporalTlsSchema.parse(Bun.env["TEMPORAL_TLS"]) === "true";
  const status = await executeWorkerDeploymentRollout(
    {
      action: actionFrom(args),
      address: requiredEnvironment(Bun.env, "TEMPORAL_ADDRESS"),
      tls,
      namespace: Bun.env["TEMPORAL_NAMESPACE"] ?? "default",
      deploymentName:
        Bun.env["TEMPORAL_WORKER_DEPLOYMENT_NAME"] ??
        "monorepo-central-workflows",
      buildId: requiredArgument(args, "--build-id"),
      taskQueue: TASK_QUEUES.WORKFLOWS,
      ...(optionalArgument(args, "--stable-build-id") === undefined
        ? {}
        : {
            stableBuildId: requiredArgument(args, "--stable-build-id"),
          }),
      catalogPath: new URL(
        "../../version-catalog/src/catalog.json",
        import.meta.url,
      ).pathname,
      candidateStatePath: new URL(
        "../../../scripts/pin-candidates-state.json",
        import.meta.url,
      ).pathname,
    },
    runCommand,
  );
  console.warn(JSON.stringify(status, null, 2));
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
