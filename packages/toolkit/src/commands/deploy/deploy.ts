import { z } from "zod";
import { generation, required, seconds, type DeployOptions } from "./common.ts";
import { runWorkerCommand, validateWorkerCommand } from "./workers.ts";
import { runMinecraftCommand, validateMinecraftCommand } from "./minecraft.ts";
import { runForumCommand, validateForumCommand } from "./forum.ts";
import { runPlatformCommand, validatePlatformCommand } from "./platform.ts";
import { runTrmnlCommand, validateTrmnlCommand } from "./trmnl.ts";
import { runCatalogCommand, validateCatalogCommand } from "./catalog.ts";
import {
  MODEL_COMMANDS,
  runModelCommand,
  validateModelCommand,
} from "./model.ts";
import type { ModelOptions } from "./model-io.ts";
import {
  runContentRecovery,
  validateContentRecovery,
} from "./content-recovery.ts";
import {
  DeliveryClientError,
  type DeliveryClient,
} from "@shepherdjerred/delivery/client";
import {
  DeploymentStatusSchema,
  IdentifierSchema,
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
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
workers list <ENVIRONMENT>             Inspect retained worker artifacts and hosts
workers baseline --file <PATH> --machine  Request independent host-only baseline proof
workers adopt --file <PATH> --machine  Adopt an original qualified worker artifact
workers retire <ENVIRONMENT> <ID>      Request guarded scale-to-zero retirement
workers recover <DEPLOYMENT_ID>        Request independent read-only recovery inspection
workers recovery <INTENT_ID>           Inspect recovery state and frozen inputs
minecraft                               Retained-volume releases have no restore command
forum publish --file <PATH> --machine Register private licensed bytes for independent qualification
forum baseline --file <PATH> --machine Request read-only original runtime baseline
forum inspect <INTENT_ID>              Inspect original provenance and native baseline proof
forum recover <DEPLOYMENT_ID>          Request exact native repair under the retained forum lock
forum recovery <INTENT_ID>             Inspect frozen forum recovery and native evidence
sites recover <DEPLOYMENT_ID>          Request exact archive repair under the retained site lock
sites recovery <INTENT_ID>             Inspect frozen site recovery and native evidence
trmnl repair <DEPLOYMENT_ID> --machine Repair the same frozen plugin bundle under held quarantine
platform request --file <PATH>         Request exact root inventory, read-only plan, or saved-plan apply
platform control-plane --file <PATH> --machine  Request isolated explicit controller upgrade
platform recover <DEPLOYMENT_ID>       Request bounded infrastructure quarantine recovery
platform recovery <INTENT_ID>          Inspect frozen recovery, native jobs and saved plan
platform recovery-approve <INTENT_ID>  Human decision for exact reviewed recovery plan
diff <FROM|none> <TO>                  Compare component artifacts
start <ENVIRONMENT> <VERSION>          Request a set revision as the recipe realises it (deploy, channel-publish, operator-run)
promote <SOURCE_ENV> <DEST_ENV>        Promote the source's accepted selection
candidates <ENVIRONMENT>               List accepted selections and why any is excluded
rollback <ENVIRONMENT> <DEPLOYMENT_ID> Restore the selection that deployment froze
rebind <ENVIRONMENT> --recipe <ID> --configuration <ID>  Keep the accepted set revision, change either revision
monitor <ENVIRONMENT>                  Inspect the accepted deployment's monitor
retire <SERVICE> --reason <TEXT> --machine [--force-while-on-main]  Retire a service after its main removal completes helm-push
catalog reconcile [--file <PATH>] --machine  Make the record agree with a catalog document (default: the committed catalog)
attest <DEPLOYMENT_ID> --stage <NAME> --evidence <PATH> --machine  Record operator-attested stage evidence
selected <ENVIRONMENT>                 Inspect the environment's selected release and component revisions
approvals                              List pending and recent deployment and saved-plan approvals
list [ENVIRONMENT]                     List deployments (filter with --environment, --service, --status, --cursor)
status [DEPLOYMENT_ID]                 Inspect one deployment or all environments
wait <DEPLOYMENT_ID>                   Foreground wait for completion
approve|reject <DEPLOYMENT_ID>         Human decision; --reason required, --override for an override approval
approve-plan <DEPLOYMENT_ID> --reason <TEXT>  Approve the exact saved plan a tofu approve step waits on
reject-plan <DEPLOYMENT_ID> --reason <TEXT>  Reject that saved plan; the deployment ends failed without applying
cancel <DEPLOYMENT_ID>                 Request cancellation at a safe boundary
retry <DEPLOYMENT_ID>                  Create a new attempt
recover <DEPLOYMENT_ID> --expected-generation <N> --reason <TEXT> [--step <S>] [--operation-id <ID>] --machine  Open a recovery intent; --operation-id settles an ordinary Argo operation by readback
recovery <INTENT_ID>                   Inspect a recovery intent and its evidence
recovery --pending                     List every pending recovery intent, oldest first
recovery <INTENT_ID> --abandon --reason <TEXT> --machine  Close a pending intent whose deployment ended without needing it

Options:
  --json                              Structured output
  --url <URL>                         Override Delivery bootstrap endpoint
  --machine                           Use brokered DELIVERY_API_TOKEN
  --request-id <ID>                    Idempotency key for deployment or recovery requests
  --expected-generation <N>            Require an exact environment generation
  --expected-worker-generation <N>     Require an exact worker generation for retirement
  --reason <TEXT>                      Approval, rejection, or recovery reason
  --abandon                            recovery: close a stale pending intent (admin)
  --pending                            recovery: list pending intents instead of reading one
  --override                           Ask for or decide an override approval (start, approve, reject)
  --force-while-on-main                retire: bypass the origin/main catalog and helm-push guard
  --step <NAME>                        Sub-step a recovery intent names
  --operation-id <UUID>                recover: the exact Argo operation inspected; settles the intent by readback
  --recipe <ID>                        Recipe revision a rebind moves to
  --configuration <ID>                 Configuration revision a rebind moves to
  --stage <NAME>                       Operator-run stage an attestation settles
  --evidence <PATH>                    attest: JSON array of evidence
  --file <PATH>                        Catalog document for catalog reconcile (default: committed catalog)
  --environment <ID>                   list: filter deployments by environment
  --service <ID>                       list: filter deployments by service
  --status <STATUS>                    list: filter deployments by status
  --cursor <CURSOR>                    list: pagination cursor from previous page
  --timeout <SECONDS>                  Wait deadline (default 900)
  --interval <SECONDS>                 Poll interval (default 5)

Exit: 0 = command succeeded; 1 = error/failed/canceled or a refused catalog
entry; 2 = wait deadline reached.
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
  sites: runContentRecovery,
  trmnl: runTrmnlCommand,
  artifact: (client, positionals, options) =>
    runCatalogCommand(client, "artifact", positionals, options),
  qualify: (client, positionals, options) =>
    runCatalogCommand(client, "qualify", positionals, options),
  ...Object.fromEntries(
    MODEL_COMMANDS.map((command) => [
      command,
      (client: DeliveryClient, positionals: string[], options: ModelOptions) =>
        runModelCommand(client, command, positionals, options),
    ]),
  ),
};
const COMMAND_ARITY: Record<string, number | readonly number[]> = {
  whoami: 0,
  versions: [0, 1],
  diff: 2,
  start: 2,
  promote: 2,
  rollback: 2,
  candidates: 1,
  rebind: 1,
  monitor: 1,
  retire: 1,
  catalog: 1,
  attest: 1,
  "approve-plan": 1,
  "reject-plan": 1,
  // One intent, or none with --pending.
  recovery: [0, 1],
  selected: 1,
  approvals: 0,
  list: [0, 1],
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
  workers: [1, 2, 3],
  minecraft: 2,
  forum: [1, 2],
  sites: 2,
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
  if (options["expected-generation"] !== undefined)
    generation(options["expected-generation"]);
  if (options.timeout !== undefined) seconds(options.timeout);
  if (options.interval !== undefined) seconds(options.interval);
  validateListFlags(command, positionals, options);
  validateRegistration(command, positionals, options);
  if (["artifact", "qualify"].includes(command))
    validateCatalogCommand(command, positionals, options);
  if (command === "workers") validateWorkerCommand(positionals, options);
  if (command === "minecraft") validateMinecraftCommand(positionals, options);
  if (command === "forum") validateForumCommand(positionals, options);
  if (command === "sites")
    validateContentRecovery("sites", positionals, options);
  if (command === "trmnl") validateTrmnlCommand(positionals, options);
  if (command === "platform") validatePlatformCommand(positionals, options);
  validateModelCommand(command, positionals, options);
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
}

function validateApproval(options: DeployOptions) {
  if (options.machine)
    throw new Error(
      "Production approval requires trusted human identity; omit --machine",
    );
  if (options.reason === undefined || options.reason.trim() === "")
    throw new Error("--reason is required");
}

function validateListFlags(
  command: string,
  positionals: string[],
  options: DeployOptions,
) {
  const hasListOption = [
    options.environment,
    options.service,
    options.status,
    options.cursor,
  ].some((value) => value !== undefined);
  if (command !== "list") {
    if (hasListOption)
      throw new Error(
        "--environment, --service, --status and --cursor apply to deploy list",
      );
    return;
  }
  if (positionals[0] !== undefined && options.environment !== undefined)
    throw new Error(
      "Pass either a positional ENVIRONMENT or --environment, not both",
    );
  const environmentId = positionals[0] ?? options.environment;
  if (environmentId !== undefined) IdentifierSchema.parse(environmentId);
  if (options.service !== undefined) IdentifierSchema.parse(options.service);
  if (options.status !== undefined)
    DeploymentStatusSchema.parse(options.status);
  if (options.cursor === "") throw new Error("--cursor must be non-empty");
}

const TRANSIENT_CODES = new Set(
  "ConnectionRefused ConnectionClosed ECONNREFUSED ECONNRESET EPIPE ETIMEDOUT".split(
    " ",
  ),
);
function listQuery(target: string | undefined, options: DeployOptions) {
  const environmentId = target ?? options.environment;
  return {
    ...(environmentId === undefined ? {} : { environmentId }),
    ...(options.service === undefined ? {} : { serviceId: options.service }),
    ...(options.status === undefined
      ? {}
      : { status: DeploymentStatusSchema.parse(options.status) }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
  };
}
const READ_COMMANDS = new Set(
  "whoami versions diff selected approvals list status inventory handover-context".split(
    " ",
  ),
);

const CodedErrorSchema = z.object({ code: z.string() });
function isTransientWaitError(error: unknown): boolean {
  if (error instanceof DeliveryClientError)
    return (
      [429, 502, 503, 504].includes(error.status) ||
      error.code === "PAUSED" ||
      error.code === "UNAVAILABLE"
    );
  if (error instanceof TypeError || error instanceof SyntaxError) return true;
  if (error instanceof DOMException && error.name === "TimeoutError")
    return true;
  const coded = CodedErrorSchema.safeParse(error);
  return coded.success && TRANSIENT_CODES.has(coded.data.code);
}

type DeploymentView = Awaited<ReturnType<DeliveryClient["deployment"]>>;
type PollOutcome =
  | { kind: "settled"; result: DeploymentView; exitCode: number }
  | { kind: "pending"; result: DeploymentView }
  | { kind: "transient"; error: unknown };

async function pollDeployment(
  client: DeliveryClient,
  id: string,
): Promise<PollOutcome> {
  try {
    const result = await client.deployment(id);
    const { status } = result.deployment;
    if (status === "succeeded") return { kind: "settled", result, exitCode: 0 };
    return status === "failed" || status === "canceled"
      ? { kind: "settled", result, exitCode: 1 }
      : { kind: "pending", result };
  } catch (error) {
    if (!isTransientWaitError(error)) throw error;
    return { kind: "transient", error };
  }
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
): Promise<{ result: DeploymentView; exitCode: number }> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + options.timeoutMs;
  let lastResult: DeploymentView | undefined;
  for (;;) {
    const polled = await pollDeployment(client, id);
    if (polled.kind === "settled")
      return { result: polled.result, exitCode: polled.exitCode };
    if (polled.kind === "pending") lastResult = polled.result;
    const remaining = deadline - now();
    if (remaining <= 0) {
      if (lastResult !== undefined) return { result: lastResult, exitCode: 2 };
      if (polled.kind === "transient") throw polled.error;
    }
    await sleep(Math.min(options.intervalMs, remaining));
  }
}

export async function runDeployCommand(
  client: DeliveryClient,
  command: string,
  positionals: string[],
  options: ModelOptions,
): Promise<{ result: unknown; exitCode: number }> {
  validateDeployCommand(command, positionals, options);
  const specialized = specializedCommands[command];
  if (specialized !== undefined)
    return specialized(client, positionals, options);
  if (command === "platform")
    return runPlatformCommand(client, positionals, options);
  if (READ_COMMANDS.has(command))
    return readCommand(client, command, positionals, options);
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
  let result: unknown;
  switch (command) {
    case "pipeline":
    case "environment":
      return registerCommand(client, command, positionals, options);
    case "approve":
    case "reject":
      result = await client.approve(required(target), {
        decision: command,
        reason: required(options.reason).trim(),
        ...(options.override ? { override: true } : {}),
      });
      break;
    case "cancel":
      result = await client.cancel(required(target));
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
  options: DeployOptions,
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
    case "selected": {
      const environmentId = required(target);
      const selection = await client.selection(environmentId);
      const versionSet =
        selection.accepted === null
          ? null
          : await client.version(selection.accepted.versionSetRevisionId);
      result = { environmentId, selection, versionSet };
      break;
    }
    case "approvals":
      result = await client.approvals();
      break;
    case "list":
      result = await client.deployments(listQuery(target, options));
      break;
    case "status":
      result =
        target === undefined
          ? await client.overview()
          : await client.deployment(target);
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
  command: "pipeline" | "environment",
  positionals: string[],
  options: DeployOptions,
) {
  const raw: unknown = await Bun.file(required(options.file)).json();
  const result: unknown =
    command === "pipeline"
      ? await client.registerPipeline(
          IdentifierSchema.parse(required(positionals[1])),
          PipelineDefinitionSchema.parse(raw),
        )
      : await client.registerEnvironment(RegisterEnvironmentSchema.parse(raw));
  return { result, exitCode: 0 };
}
