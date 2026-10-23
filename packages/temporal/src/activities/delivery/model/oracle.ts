import type {
  DeploymentDetail,
  EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import type { KubernetesApplicationRecipe } from "#lib/delivery/model/recipe.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { runDeliveryTestStage } from "#activities/delivery/test-stage.ts";
import { recordStage } from "./stages.ts";
import {
  frozenRunnerImage,
  testWorkspace,
} from "#lib/delivery/model/oracle-inputs.ts";

/** An oracle suite as a stage: a Kueue Job on the CI node, its JSON report as `test` evidence (V5). */
export async function runTestStep(
  current: DeploymentDetail,
  recipe: KubernetesApplicationRecipe,
  step: { key: string; suite: string; resultPath: string },
) {
  const source = current.versionSet.components[recipe.chartComponent];
  if (source === undefined)
    throw new Error("Selection lacks the recipe's source component");
  const run = await runDeliveryTestStage(current.deployment.id, {
    stageKey: step.key,
    suite: step.suite,
    workspace: testWorkspace(step.resultPath),
    sourceRevision: source.sourceRevision,
    runnerImage: frozenRunnerImage(current, recipe.runner),
  });
  if (run.result.exitCode !== 0 || run.result.failed > 0)
    throw new Error(
      `Suite ${step.suite} failed ${run.result.failed.toString()} tests; the deployment is not accepted`,
    );
  await recordStage(current, step.key, "succeeded", {
    operationId: run.operationId,
    evidence: [run.evidence],
  });
}

/**
 * One acceptance for every frozen step (T3): each settled by its own
 * readback, whose evidence its stage holds; then the HTTP probes the oracle
 * declares and the acceptance summary (4.14).
 */
export async function oracleEvidence(
  current: DeploymentDetail,
  steps: readonly string[],
  probes: readonly { url: string; expectedStatus: number }[],
): Promise<EvidenceInput[]> {
  const operationId = deliveryOperationId(current.deployment.id);
  const unsettled = steps.filter(
    (key) =>
      !current.stages.some(
        (stage) => stage.key === key && stage.status === "succeeded",
      ),
  );
  if (unsettled.length > 0)
    throw new Error(
      `Frozen steps ${unsettled.join(", ")} have not settled; the deployment is not accepted`,
    );
  const evidence: EvidenceInput[] = [
    {
      kind: "reconciliation",
      operationId,
      summary: `Every frozen step settled by its own readback: ${steps.join(", ")}`,
    },
  ];
  for (const probe of probes) {
    const response = await fetch(probe.url, {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (response.status !== probe.expectedStatus)
      throw new Error(
        `Probe ${probe.url} returned HTTP ${response.status.toString()}, expected ${probe.expectedStatus.toString()}`,
      );
    evidence.push({
      kind: "runtime",
      operationId,
      url: probe.url,
      summary: `Probe responded HTTP ${response.status.toString()}`,
    });
  }
  evidence.push({
    kind: "acceptance",
    operationId,
    summary: "Every frozen step settled and the oracle passed",
  });
  return evidence;
}
