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
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import {
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
minecraft recover <DEPLOYMENT_ID>      Recover the untouched original before candidate source selection
minecraft recovery <INTENT_ID>         Inspect independent recovery and retained ownership
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
retire <SERVICE> --reason <TEXT> --machine  Retire a service and its environments
catalog reconcile --file <PATH> --machine  Make the record agree with a catalog document
attest <DEPLOYMENT_ID> --stage <NAME> --evidence <PATH> --machine  Record operator-attested stage evidence
snapshot --output <PATH>               Fetch the cold-start snapshot from R2; works while Delivery is down
snapshot reconcile --machine           Compare record, snapshot and live target; hold mismatches
snapshot accept <ENVIRONMENT> --machine  Accept the live state of a held environment with evidence
render-application <ENVIRONMENT> --snapshot <PATH> --file <PATH>  Print the cold-start Application for kubectl
status [DEPLOYMENT_ID]                 Inspect one deployment or all environments
wait <DEPLOYMENT_ID>                   Foreground wait for completion
approve|reject <DEPLOYMENT_ID>         Human decision; --reason required, --override for an override approval
cancel <DEPLOYMENT_ID>                 Request cancellation at a safe boundary
retry <DEPLOYMENT_ID>                  Create a new attempt
recover <DEPLOYMENT_ID> --expected-generation <N> --reason <TEXT> [--step <S>] [--operation-id <ID>] --machine  Open a recovery intent; --operation-id settles an ordinary Argo operation by readback
recovery <INTENT_ID>                   Inspect a recovery intent and its evidence

Options:
  --json                              Structured output
  --url <URL>                         Override Delivery bootstrap endpoint
  --machine                           Use brokered DELIVERY_API_TOKEN
  --request-id <ID>                    Idempotency key for deployment or recovery requests
  --expected-generation <N>            Require an exact environment generation
  --expected-worker-generation <N>     Require an exact worker generation for retirement
  --reason <TEXT>                      Approval, rejection, recovery, or restore-hold reason
  --override                           start: ask for an override approval of a non-eligible deploy;
                                       approve/reject: decide that override approval
  --step <NAME>                        Sub-step a recovery intent names
  --recipe <ID>                        Recipe revision a rebind moves to
  --configuration <ID>                 Configuration revision a rebind moves to
  --stage <NAME>                       Operator-run stage an attestation settles
  --evidence <PATH|TEXT>               attest: JSON array of evidence; snapshot accept: what was inspected
  --output <PATH>                      Where snapshot writes the fetched cold-start snapshot
  --snapshot <PATH>                    Cold-start snapshot render-application reads
  --file <PATH>                        Catalog document for catalog reconcile and render-application
  --timeout <SECONDS>                  Wait deadline (default 900)
  --interval <SECONDS>                 Poll interval (default 5)

Exit: 0 = command succeeded; 1 = error/failed/canceled, a refused catalog entry,
or a held environment after restore; 2 = wait deadline reached.
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
  snapshot: [0, 1, 2],
  "render-application": 1,
  recovery: 1,
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
  options: ModelOptions,
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
