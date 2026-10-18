import { generation, required, seconds, type DeployOptions } from "./common.ts";
import { runWorkerCommand, validateWorkerCommand } from "./workers.ts";
import { runMinecraftCommand, validateMinecraftCommand } from "./minecraft.ts";
import { runForumCommand, validateForumCommand } from "./forum.ts";
import { runPlatformCommand, validatePlatformCommand } from "./platform.ts";
import { runTrmnlCommand, validateTrmnlCommand } from "./trmnl.ts";
import { runCatalogCommand, validateCatalogCommand } from "./catalog.ts";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import {
  IdentifierSchema,
  ImportSnapshotSchema,
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
  RecoverDeploymentSchema,
} from "@shepherdjerred/delivery/contract";

export const DEPLOY_HELP = `toolkit deploy <COMMAND> [OPTIONS]

whoami                                Show authenticated server identity
versions [SERVICE]                    List immutable version sets
inventory                             Inspect registered release destinations
handover-context                      Inspect paused, identity-bound authority-transfer prerequisites
artifact --file <PATH> --machine       Resolve an exact original qualified artifact
qualify <BUILD_ID> --machine           Ask the independent verifier to check actual CI provenance
pipeline register <ID> --file <PATH>   Register a reviewed pipeline definition
environment register --file <PATH>     Register reviewed environment metadata
import --file <PATH>                   Save an unverified migration snapshot
imports                               List unverified migration snapshots
workers list <ENVIRONMENT>             Inspect retained worker artifacts and hosts
workers baseline --file <PATH> --machine  Request independent host-only baseline proof
workers adopt --file <PATH> --machine  Adopt an original qualified worker artifact
workers retire <ENVIRONMENT> <ID>      Request guarded scale-to-zero retirement
workers recover <DEPLOYMENT_ID>        Request independent read-only recovery inspection
workers recovery <INTENT_ID>           Inspect recovery state and frozen inputs
minecraft recover <DEPLOYMENT_ID>      Recover the untouched original before candidate source selection
minecraft recovery <INTENT_ID>         Inspect independent recovery and retained ownership
forum publish --file <PATH> --machine Register private licensed bytes for independent qualification
forum baseline --file <PATH> --machine Request read-only original runtime baseline
forum inspect <INTENT_ID>              Inspect original provenance and native baseline proof
trmnl repair <DEPLOYMENT_ID> --machine Repair the same frozen plugin bundle under held quarantine
platform request --file <PATH>         Request exact root inventory, read-only plan, or saved-plan apply
platform control-plane --file <PATH> --machine  Request isolated explicit controller upgrade
platform recover <DEPLOYMENT_ID>       Request bounded infrastructure quarantine recovery
platform recovery <INTENT_ID>          Inspect frozen recovery, native jobs and saved plan
platform recovery-approve <INTENT_ID>  Human decision for exact reviewed recovery plan
diff <FROM|none> <TO>                  Compare component artifacts
start <ENVIRONMENT> <VERSION>          Request an exact release
promote <SOURCE_ENV> <DEST_ENV>        Promote source's accepted release
rollback <ENVIRONMENT> <VERSION>       Request a previous exact release
status [DEPLOYMENT_ID]                 Inspect one deployment or all environments
wait <DEPLOYMENT_ID>                   Foreground wait for completion
approve|reject <DEPLOYMENT_ID>         Human decision; --reason required
cancel <DEPLOYMENT_ID>                 Request cancellation at a safe boundary
retry <DEPLOYMENT_ID>                  Create a new attempt
recover <DEPLOYMENT_ID>                Inspect and release an ambiguous Argo operation

Options:
  --json                              Structured output
  --url <URL>                         Override Delivery bootstrap endpoint
  --machine                           Use brokered DELIVERY_API_TOKEN
  --request-id <ID>                    Idempotency key for start/promote/rollback/retry
  --expected-generation <N>            Require an exact environment generation
  --expected-worker-generation <N>     Require an exact worker generation for retirement
  --reason <TEXT>                      Approval or rejection reason
  --operation-id <UUID>                Exact recorded Argo operation for recovery
  --timeout <SECONDS>                  Wait deadline (default 900)
  --interval <SECONDS>                 Poll interval (default 5)

Exit: 0 = command succeeded; 1 = error/failed/canceled; 2 = wait deadline reached.
Production approvals require trusted human identity; --machine cannot approve.
`;

const specializedCommands: Record<
  string,
  (
    client: DeliveryClient,
    positionals: string[],
    options: DeployOptions & { requestNotice?: (id: string) => void },
  ) => Promise<{ result: unknown; exitCode: number }>
> = {
  workers: runWorkerCommand,
  minecraft: runMinecraftCommand,
  forum: runForumCommand,
  trmnl: runTrmnlCommand,
  artifact: (client, positionals, options) =>
    runCatalogCommand(client, "artifact", positionals, options),
  qualify: (client, positionals, options) =>
    runCatalogCommand(client, "qualify", positionals, options),
};
const COMMAND_ARITY: Record<string, number | readonly number[]> = {
  whoami: 0,
  versions: [0, 1],
  diff: 2,
  start: 2,
  promote: 2,
  rollback: 2,
  status: [0, 1],
  wait: 1,
  approve: 1,
  reject: 1,
  cancel: 1,
  retry: 1,
  recover: 1,
  inventory: 0,
  "handover-context": 0,
  artifact: 0,
  qualify: 1,
  pipeline: 2,
  environment: 1,
  import: 0,
  imports: 0,
  workers: [1, 2, 3],
  minecraft: 2,
  forum: [1, 2],
  trmnl: 2,
  platform: [1, 2],
};

export function validateDeployCommand(
  command: string,
  positionals: string[],
  options: DeployOptions,
): void {
  const arity = COMMAND_ARITY[command];
  if (arity === undefined)
    throw new Error(`Unknown deploy command: ${command}`);
  if (
    !(typeof arity === "number"
      ? arity === positionals.length
      : arity.includes(positionals.length))
  ) {
    throw new Error(
      `Invalid operands for deploy ${command}; run toolkit deploy --help`,
    );
  }
  if (["approve", "reject"].includes(command)) validateApproval(options);
  if (command === "recover") validateRecovery(options);
  if (options["expected-generation"] !== undefined)
    generation(options["expected-generation"]);
  if (options.timeout !== undefined) seconds(options.timeout);
  if (options.interval !== undefined) seconds(options.interval);
  validateRegistration(command, positionals, options);
  if (["artifact", "qualify"].includes(command))
    validateCatalogCommand(command, positionals, options);
  if (command === "workers") validateWorkerCommand(positionals, options);
  if (command === "minecraft") validateMinecraftCommand(positionals, options);
  if (command === "forum") validateForumCommand(positionals, options);
  if (command === "trmnl") validateTrmnlCommand(positionals, options);
  if (command === "platform") validatePlatformCommand(positionals, options);
}

function validateRecovery(options: DeployOptions) {
  if (!options.machine)
    throw new Error("Recovery requires an admin --machine credential");
  if (options["operation-id"] === undefined)
    throw new Error("--operation-id is required");
  if (options.reason === undefined) throw new Error("--reason is required");
  RecoverDeploymentSchema.parse({
    operationId: options["operation-id"],
    reason: options.reason,
  });
}

function validateRegistration(
  command: string,
  positionals: string[],
  options: DeployOptions,
) {
  if (["pipeline", "environment"].includes(command)) {
    if (positionals[0] !== "register")
      throw new Error(`Use deploy ${command} register`);
    if (options.file === undefined) throw new Error("--file is required");
    if (!options.machine)
      throw new Error(
        "Registration requires an admin machine credential; use --machine",
      );
  }
  if (command === "import" && (options.file === undefined || !options.machine))
    throw new Error("Import requires --file and an admin --machine credential");
}

function validateApproval(options: DeployOptions) {
  if (options.machine)
    throw new Error(
      "Production approval requires trusted human identity; omit --machine",
    );
  if (options.reason === undefined || options.reason.trim() === "")
    throw new Error("--reason is required");
}

export async function waitForDeployment(
  client: DeliveryClient,
  id: string,
  options: {
    timeoutMs: number;
    intervalMs: number;
    now?: () => number;
    sleep?: (duration: number) => Promise<void>;
  },
): Promise<{
  result: Awaited<ReturnType<DeliveryClient["deployment"]>>;
  exitCode: number;
}> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((duration: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, duration);
      }));
  const deadline = now() + options.timeoutMs;
  for (;;) {
    const result = await client.deployment(id);
    if (result.deployment.status === "succeeded")
      return { result, exitCode: 0 };
    if (["failed", "canceled"].includes(result.deployment.status))
      return { result, exitCode: 1 };
    const remaining = deadline - now();
    if (remaining <= 0) return { result, exitCode: 2 };
    await sleep(Math.min(options.intervalMs, remaining));
  }
}

export async function runDeployCommand(
  client: DeliveryClient,
  command: string,
  positionals: string[],
  options: DeployOptions & { requestNotice?: (id: string) => void },
): Promise<{ result: unknown; exitCode: number }> {
  validateDeployCommand(command, positionals, options);
  const specialized = specializedCommands[command];
  if (specialized !== undefined)
    return specialized(client, positionals, options);
  if (command === "platform")
    return runPlatformCommand(client, positionals, options);
  if (
    [
      "whoami",
      "versions",
      "diff",
      "status",
      "inventory",
      "imports",
      "handover-context",
    ].includes(command)
  )
    return readCommand(client, command, positionals);
  const target = positionals[0];
  const requestId = () => {
    const id = options["request-id"] ?? crypto.randomUUID();
    options.requestNotice?.(id);
    return id;
  };
  const expectedGeneration = (current: number) =>
    options["expected-generation"] === undefined
      ? current
      : generation(options["expected-generation"]);
  async function environment(id: string) {
    const overview = await client.overview();
    const value = overview.environments.find(
      (candidate) => candidate.id === id,
    );
    if (value === undefined) throw new Error(`Unknown environment: ${id}`);
    return value;
  }
  let result: unknown;
  switch (command) {
    case "pipeline":
    case "environment":
    case "import":
      return registerCommand(client, command, positionals, options);
    case "start":
    case "rollback": {
      const destination = await environment(required(target));
      result = await client.createDeployment({
        requestId: requestId(),
        environmentId: destination.id,
        versionSetRevisionId: required(positionals[1]),
        expectedGeneration: expectedGeneration(destination.generation),
        kind: command === "start" ? "deploy" : "rollback",
      });
      break;
    }
    case "promote": {
      const source = await environment(required(target));
      const destination = await environment(required(positionals[1]));
      if (source.acceptedVersionSetRevisionId === null)
        throw new Error(`No accepted release in ${source.id}`);
      result = await client.createDeployment({
        requestId: requestId(),
        environmentId: destination.id,
        sourceEnvironmentId: source.id,
        versionSetRevisionId: source.acceptedVersionSetRevisionId,
        expectedGeneration: expectedGeneration(destination.generation),
        kind: "promote",
      });
      break;
    }
    case "approve":
    case "reject":
      result = await client.approve(required(target), {
        decision: command,
        reason: required(options.reason).trim(),
      });
      break;
    case "cancel":
      result = await client.cancel(required(target));
      break;
    case "recover":
      result = await client.recover(
        required(target),
        RecoverDeploymentSchema.parse({
          operationId: options["operation-id"],
          reason: options.reason,
        }),
      );
      break;
    case "retry": {
      const detail = await client.deployment(required(target));
      result = await client.retry(detail.deployment.id, {
        requestId: requestId(),
        expectedGeneration: expectedGeneration(detail.environment.generation),
      });
      break;
    }
    case "wait":
      return waitForDeployment(client, required(target), {
        timeoutMs: seconds(options.timeout ?? "900") * 1000,
        intervalMs: seconds(options.interval ?? "5") * 1000,
      });
    default:
      throw new Error(`Unknown deploy command: ${command}`);
  }
  return { result, exitCode: 0 };
}

async function readCommand(
  client: DeliveryClient,
  command: string,
  positionals: string[],
) {
  const target = positionals[0];
  let result: unknown;
  switch (command) {
    case "whoami":
      result = await client.identity();
      break;
    case "versions":
      result = await client.versions(target);
      break;
    case "diff":
      result = await client.diff(
        target === "none" ? null : required(target),
        required(positionals[1]),
      );
      break;
    case "status":
      result =
        target === undefined
          ? await client.overview()
          : await client.deployment(target);
      break;
    case "imports":
      result = await client.imports();
      break;
    case "inventory": {
      const overview = await client.overview();
      result = overview.environments;
      break;
    }
    case "handover-context":
      result = await client.ownershipHandoverContext();
      break;
    default:
      throw new Error(`Unknown read command: ${command}`);
  }
  return { result, exitCode: 0 };
}

async function registerCommand(
  client: DeliveryClient,
  command: "pipeline" | "environment" | "import",
  positionals: string[],
  options: DeployOptions,
) {
  const raw: unknown = await Bun.file(required(options.file)).json();
  let result: unknown;
  if (command === "pipeline")
    result = await client.registerPipeline(
      IdentifierSchema.parse(required(positionals[1])),
      PipelineDefinitionSchema.parse(raw),
    );
  else if (command === "environment")
    result = await client.registerEnvironment(
      RegisterEnvironmentSchema.parse(raw),
    );
  else result = await client.importSnapshot(ImportSnapshotSchema.parse(raw));
  return { result, exitCode: 0 };
}
