import { z } from "zod";
import {
  IdentifierSchema,
  RecoverDeploymentSchema,
} from "@shepherdjerred/delivery/contract";
import {
  AttestationRequestSchema,
  RecoveryIntentRequestSchema,
  deploymentKindForRecipe,
} from "@shepherdjerred/delivery/model-contract";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import { generation, required, type DeployOptions } from "./common.ts";
import {
  runRenderCommand,
  runSnapshotCommand,
  validateRenderCommand,
  validateSnapshotCommand,
} from "./cold-start.ts";
import {
  catalogDocument,
  readJson,
  requestId,
  requireMachine,
  type ModelOptions,
  type ModelResult,
} from "./model-io.ts";

/** Verbs of the Delivery model (`packages/delivery/docs/model.md`). */
export const MODEL_COMMANDS = [
  "start",
  "promote",
  "rollback",
  "candidates",
  "rebind",
  "monitor",
  "retire",
  "catalog",
  "attest",
  "approve-plan",
  "reject-plan",
  "recover",
  "recovery",
  "snapshot",
  "render-application",
] as const;

/** The inspected Argo operation that settles an `argo` intent (4.15), when named. */
function settlement(options: DeployOptions) {
  return options["operation-id"] === undefined
    ? null
    : RecoverDeploymentSchema.parse({
        operationId: options["operation-id"],
        reason: options.reason,
      });
}

function recoveryRequest(options: DeployOptions, id: string) {
  return RecoveryIntentRequestSchema.parse({
    requestId: id,
    reason: options.reason,
    expectedGeneration: generation(required(options["expected-generation"])),
    ...(options.step === undefined ? {} : { step: options.step }),
  });
}

function validateAdmin(
  command: string,
  positionals: string[],
  options: DeployOptions,
) {
  switch (command) {
    case "retire": {
      requireMachine(options, "Service retirement");
      if (options.reason === undefined || options.reason.trim() === "")
        throw new Error("--reason is required");
      return;
    }
    case "catalog": {
      if (positionals[0] !== "reconcile")
        throw new Error("Use deploy catalog reconcile --file <PATH>");
      if (options.file === undefined) throw new Error("--file is required");
      requireMachine(options, "Catalog reconcile");
      return;
    }
    case "recover": {
      requireMachine(options, "A recovery intent");
      if (options["expected-generation"] === undefined)
        throw new Error("--expected-generation is required");
      recoveryRequest(options, options["request-id"] ?? "validation");
      settlement(options);
      return;
    }
  }
}

/**
 * Checks that need no credential and no network, run before either is
 * resolved. Commands outside the model have nothing to check here.
 */
export function validateModelCommand(
  command: string,
  positionals: string[],
  options: ModelOptions,
) {
  validateAdmin(command, positionals, options);
  if (options.override && !["start", "approve", "reject"].includes(command))
    throw new Error("--override applies to deploy start, approve and reject");
  switch (command) {
    case "rollback": {
      IdentifierSchema.parse(positionals[1]);
      return;
    }
    case "rebind": {
      if (options.recipe === undefined && options.configuration === undefined)
        throw new Error("Rebind names --recipe, --configuration, or both");
      return;
    }
    case "attest": {
      requireMachine(options, "Attestation");
      if (options.stage === undefined) throw new Error("--stage is required");
      if (options.evidence === undefined)
        throw new Error("--evidence is required");
      IdentifierSchema.parse(options.stage);
      return;
    }
    case "approve-plan":
    case "reject-plan": {
      if (options.machine)
        throw new Error(
          "A plan decision requires trusted human identity; omit --machine",
        );
      if (options.reason === undefined || options.reason.trim() === "")
        throw new Error("--reason is required");
      return;
    }
    case "snapshot": {
      validateSnapshotCommand(positionals, options);
      return;
    }
    case "render-application": {
      validateRenderCommand(options);
      return;
    }
  }
}

/** The binding generation a mutation expects: the one just read, unless pinned. */
function expectedGeneration(
  options: ModelOptions,
  view: { bindingGeneration: number },
) {
  return options["expected-generation"] === undefined
    ? view.bindingGeneration
    : generation(options["expected-generation"]);
}

/**
 * Realise a set revision the way the declared recipe asks: `deploy`, or
 * `channel-publish` and `operator-run` for those recipe kinds. `--override`
 * asks for the approval a non-eligible deploy needs (H4).
 */
async function start(
  client: DeliveryClient,
  environmentId: string,
  versionSetRevisionId: string,
  options: ModelOptions,
): ModelResult {
  const view = await client.selection(environmentId);
  const kind = deploymentKindForRecipe(view.declared.recipeKind);
  if (kind !== "deploy" && options.override)
    throw new Error(
      `Only a deploy takes an override; ${environmentId} runs ${kind}`,
    );
  const result = await client.createDeployment({
    requestId: requestId(options),
    environmentId,
    expectedGeneration: expectedGeneration(options, view),
    kind,
    versionSetRevisionId,
    ...(options.override ? { override: true } : {}),
  });
  return { result, exitCode: 0 };
}

/** `promote` takes the source's accepted selection; it names no set revision (M2). */
async function promote(
  client: DeliveryClient,
  sourceEnvironmentId: string,
  environmentId: string,
  options: ModelOptions,
): ModelResult {
  const [source, view] = await Promise.all([
    client.selection(sourceEnvironmentId),
    client.selection(environmentId),
  ]);
  if (source.accepted === null)
    throw new Error(`No accepted selection in ${sourceEnvironmentId}`);
  const result = await client.createDeployment({
    requestId: requestId(options),
    environmentId,
    expectedGeneration: expectedGeneration(options, view),
    kind: "promote",
    sourceEnvironmentId,
  });
  return { result, exitCode: 0 };
}

async function rollback(
  client: DeliveryClient,
  environmentId: string,
  deploymentId: string,
  options: ModelOptions,
): ModelResult {
  const [{ candidates }, view] = await Promise.all([
    client.rollbackCandidates(environmentId),
    client.selection(environmentId),
  ]);
  const candidate = candidates.find(
    (entry) => entry.deploymentId === deploymentId,
  );
  if (candidate === undefined)
    throw new Error(
      `${deploymentId} is not a previously accepted selection of ${environmentId}; run deploy candidates ${environmentId}`,
    );
  if (!candidate.eligible)
    throw new Error(
      `${deploymentId} is not eligible for rollback: ${candidate.reason ?? "no reason recorded"}`,
    );
  const result = await client.createDeployment({
    requestId: requestId(options),
    environmentId,
    expectedGeneration: expectedGeneration(options, view),
    kind: "rollback",
    selectionDeploymentId: deploymentId,
  });
  return { result, exitCode: 0 };
}

async function rebind(
  client: DeliveryClient,
  environmentId: string,
  options: ModelOptions,
): ModelResult {
  const view = await client.selection(environmentId);
  const result = await client.createDeployment({
    requestId: requestId(options),
    environmentId,
    expectedGeneration: expectedGeneration(options, view),
    kind: "rebind",
    ...(options.recipe === undefined
      ? {}
      : { recipeRevisionId: options.recipe }),
    ...(options.configuration === undefined
      ? {}
      : { configurationRevisionId: options.configuration }),
  });
  return { result, exitCode: 0 };
}

async function administer(
  client: DeliveryClient,
  command: string,
  target: string,
  options: ModelOptions,
): ModelResult {
  switch (command) {
    case "retire": {
      const result = await client.retireService(target, {
        requestId: requestId(options),
        reason: required(options.reason).trim(),
      });
      return { result, exitCode: 0 };
    }
    case "catalog": {
      const result = await client.reconcileCatalog(
        await catalogDocument(options),
      );
      return { result, exitCode: result.refused.length === 0 ? 0 : 1 };
    }
    case "recover": {
      const intent = await client.createRecoveryIntent(
        target,
        recoveryRequest(options, requestId(options)),
      );
      // Readback of the inspected operation settles an ordinary Argo intent.
      const settle = settlement(options);
      const result =
        settle === null
          ? intent
          : await client.settleRecoveryIntent(intent.id, settle);
      return { result, exitCode: 0 };
    }
    default: {
      const evidence = z
        .array(z.unknown())
        .parse(await readJson(required(options.evidence)));
      const input = AttestationRequestSchema.parse({
        stage: options.stage,
        evidence,
      });
      return { result: await client.attest(target, input), exitCode: 0 };
    }
  }
}

/**
 * Decide the exact saved plan a model `tofu` recipe's approve step waits on
 * (section 5, 4.13): the digest comes from the deployment's own saved plan,
 * so a decision never names a plan the deployment did not produce. A
 * rejection discards the plan and ends the deployment failed (H3).
 */
async function decidePlan(
  client: DeliveryClient,
  deploymentId: string,
  options: ModelOptions,
  decision: "approved" | "rejected",
): ModelResult {
  const { savedPlan } = await client.deployment(deploymentId);
  if (savedPlan === null)
    throw new Error(`${deploymentId} has no saved plan to decide`);
  const result = await client.approvePlan(deploymentId, {
    decision,
    planDigest: savedPlan.planDigest,
    reason: required(options.reason).trim(),
  });
  return { result, exitCode: 0 };
}

export async function runModelCommand(
  client: DeliveryClient,
  command: string,
  positionals: string[],
  options: ModelOptions,
): ModelResult {
  validateModelCommand(command, positionals, options);
  if (command === "snapshot")
    return runSnapshotCommand(client, positionals, options);
  const target = required(positionals[0]);
  switch (command) {
    case "start": {
      return start(client, target, required(positionals[1]), options);
    }
    case "promote": {
      return promote(client, target, required(positionals[1]), options);
    }
    case "rollback": {
      return rollback(client, target, required(positionals[1]), options);
    }
    case "rebind": {
      return rebind(client, target, options);
    }
    case "candidates": {
      return { result: await client.rollbackCandidates(target), exitCode: 0 };
    }
    case "monitor": {
      return { result: await client.monitor(target), exitCode: 0 };
    }
    case "recovery": {
      return { result: await client.recoveryIntent(target), exitCode: 0 };
    }
    case "approve-plan": {
      return decidePlan(client, target, options, "approved");
    }
    case "reject-plan": {
      return decidePlan(client, target, options, "rejected");
    }
    case "render-application": {
      return runRenderCommand(target, options);
    }
    default: {
      return administer(client, command, target, options);
    }
  }
}
