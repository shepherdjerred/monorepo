import { parseArgs } from "node:util";
import { z } from "zod";
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
pipeline register <ID> --file <PATH>   Register a reviewed pipeline definition
environment register --file <PATH>     Register reviewed environment metadata
import --file <PATH>                   Save an unverified migration snapshot
imports                               List unverified migration snapshots
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
  --reason <TEXT>                      Approval or rejection reason
  --operation-id <UUID>                Exact recorded Argo operation for recovery
  --timeout <SECONDS>                  Wait deadline (default 900)
  --interval <SECONDS>                 Poll interval (default 5)

Exit: 0 = command succeeded; 1 = error/failed/canceled; 2 = wait deadline reached.
Production approvals require trusted human identity; --machine cannot approve.
`;

export function parseDeployArgs(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      machine: { type: "boolean", default: false },
      url: { type: "string" },
      "request-id": { type: "string" },
      "expected-generation": { type: "string" },
      reason: { type: "string" },
      "operation-id": { type: "string" },
      timeout: { type: "string" },
      interval: { type: "string" },
      file: { type: "string" },
    },
  });
}

export type DeployOptions = ReturnType<typeof parseDeployArgs>["values"];
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
  pipeline: 2,
  environment: 1,
  import: 0,
  imports: 0,
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

function required(value: string | undefined): string {
  if (value === undefined || value === "")
    throw new Error("Explicit target is required");
  return value;
}
function generation(value: string): number {
  return z.coerce.number().int().nonnegative().parse(value);
}
function seconds(value: string): number {
  return z.coerce.number().int().min(1).max(86_400).parse(value);
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
  if (
    ["whoami", "versions", "diff", "status", "inventory", "imports"].includes(
      command,
    )
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
