import { z } from "zod";
import {
  executeWorkerDeploymentRollout,
  type WorkerDeploymentRolloutOptions,
} from "#lib/worker-deployment-rollout.ts";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";
import { resolveWorkerDeploymentRolloutTarget } from "#lib/worker-deployment-target.ts";
import { parseTemporalNamespace } from "#shared/temporal-namespace.ts";
import {
  parseFlagArguments,
  requiredEnvironment,
  requiredParsedArgument,
} from "./cli-arguments.ts";

const ACTIONS = new Set([
  "inspect",
  "status",
  "start",
  "advance",
  "promote",
  "rollback",
]);
const ALLOWED_FLAGS = new Set(["--build-id", "--stable-build-id", "--target"]);
const TemporalTlsSchema = z.enum(["true", "false"]).optional();

function rolloutTarget(
  args: ReadonlyMap<string, string>,
  address: string,
): ReturnType<typeof resolveWorkerDeploymentRolloutTarget> {
  return resolveWorkerDeploymentRolloutTarget(
    args.get("--target") ?? "central",
    address,
  );
}

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
      "Usage: bun run worker-deployment <inspect|status|start|advance|promote|rollback> --build-id <image-git-sha>",
    );
  }
  if (
    action !== "inspect" &&
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
  const action = actionFrom(args);
  const flags = parseFlagArguments(args.slice(1), ALLOWED_FLAGS);
  const address = requiredEnvironment(Bun.env, "TEMPORAL_ADDRESS");
  const tls = TemporalTlsSchema.parse(Bun.env["TEMPORAL_TLS"]) === "true";
  const target = rolloutTarget(flags, address);
  const stableBuildId = flags.get("--stable-build-id");
  const status = await executeWorkerDeploymentRollout(
    {
      action,
      address,
      tls,
      namespace: parseTemporalNamespace(
        requiredEnvironment(Bun.env, "TEMPORAL_NAMESPACE"),
      ),
      ...target,
      buildId: requiredParsedArgument(flags, "--build-id"),
      ...(stableBuildId === undefined ? {} : { stableBuildId }),
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
