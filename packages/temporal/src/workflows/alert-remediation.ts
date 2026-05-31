import { executeChild, proxyActivities } from "@temporalio/workflow";
import type {
  AlertRemediationActivities,
  FindExistingAlertRemediationPrResult,
} from "#activities/alert-remediation.ts";
import {
  AlertRemediationChildInputSchema,
  AlertRemediationSweepInputSchema,
  alertRemediationWorkflowId,
  type AlertRemediationChildInput,
  type AlertRemediationChildResult,
  type AlertRemediationCollectionResult,
  type AlertRemediationSweepRawInput,
  type AlertRemediationSweepResult,
  type NormalizedAlert,
} from "#shared/alert-remediation.ts";

const COLLECTION_RETRY = {
  maximumAttempts: 2,
  initialInterval: "1 minute" as const,
  backoffCoefficient: 2,
  maximumInterval: "5 minutes" as const,
};

const WORKDIR_RETRY = {
  maximumAttempts: 2,
  initialInterval: "1 minute" as const,
  backoffCoefficient: 2,
  maximumInterval: "5 minutes" as const,
};

const AGENT_RETRY = {
  maximumAttempts: 1,
};

const collectActivities = proxyActivities<AlertRemediationActivities>({
  startToCloseTimeout: "10 minutes",
  retry: COLLECTION_RETRY,
});

const workdirActivities = proxyActivities<AlertRemediationActivities>({
  startToCloseTimeout: "10 minutes",
  retry: WORKDIR_RETRY,
});

const agentActivities = proxyActivities<AlertRemediationActivities>({
  startToCloseTimeout: "90 minutes",
  heartbeatTimeout: "60 seconds",
  retry: AGENT_RETRY,
});

const emailActivities = proxyActivities<AlertRemediationActivities>({
  startToCloseTimeout: "2 minutes",
  retry: COLLECTION_RETRY,
});

function failedResult(
  input: AlertRemediationChildInput,
  error: unknown,
): AlertRemediationChildResult {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    source: input.alert.source,
    fingerprint: input.alert.fingerprint,
    title: input.alert.title,
    outcome: "failed",
    decision: "failed",
    reason,
    markdown: `Alert remediation failed: ${reason}`,
    verificationCommands: [],
  };
}

function alreadyCoveredResult(
  input: AlertRemediationChildInput,
  pr: FindExistingAlertRemediationPrResult,
): AlertRemediationChildResult {
  if (!pr.found) {
    throw new Error("alreadyCoveredResult requires an existing PR");
  }
  return {
    source: input.alert.source,
    fingerprint: input.alert.fingerprint,
    title: input.alert.title,
    outcome: "already-covered",
    decision: "skipped",
    reason: "An open alert-remediation PR already references this fingerprint.",
    markdown: `Existing remediation PR: ${pr.prUrl}`,
    prUrl: pr.prUrl,
    branchName: pr.branchName,
    verificationCommands: [],
  };
}

export async function alertRemediationChildWorkflow(
  rawInput: AlertRemediationChildInput,
): Promise<AlertRemediationChildResult> {
  const input = AlertRemediationChildInputSchema.parse(rawInput);
  try {
    const existing =
      await workdirActivities.findExistingAlertRemediationPr(input);
    if (existing.found) {
      return alreadyCoveredResult(input, existing);
    }

    const workdir = await workdirActivities.prepareAlertRemediationWorkdir({
      input,
    });
    try {
      return await agentActivities.runAlertRemediationAgent({
        input,
        workdir: workdir.workdir,
      });
    } finally {
      await workdirActivities.cleanupAlertRemediationWorkdir(workdir);
    }
  } catch (error: unknown) {
    return failedResult(input, error);
  }
}

function dedupeAlerts(collection: AlertRemediationCollectionResult): {
  alerts: NormalizedAlert[];
  skipped: number;
} {
  const seen = new Set<string>();
  const alerts: NormalizedAlert[] = [];
  let skipped = 0;
  for (const alert of collection.alerts) {
    const key = `${alert.source}:${alert.fingerprint}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    alerts.push(alert);
  }
  return { alerts, skipped };
}

async function runChild(
  input: AlertRemediationChildInput,
): Promise<AlertRemediationChildResult> {
  try {
    return await executeChild(alertRemediationChildWorkflow, {
      args: [input],
      workflowId: alertRemediationWorkflowId(input.alert),
      workflowExecutionTimeout: "2 hours",
    });
  } catch (error: unknown) {
    return failedResult(input, error);
  }
}

async function runChildrenWithLimit(
  inputs: AlertRemediationChildInput[],
  concurrency: number,
): Promise<AlertRemediationChildResult[]> {
  const results: AlertRemediationChildResult[] = [];
  for (let index = 0; index < inputs.length; index += concurrency) {
    const batch = inputs.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map((input) => runChild(input)))));
  }
  return results;
}

function shouldSendEmail(result: AlertRemediationSweepResult): boolean {
  return (
    result.collectionFailures.length > 0 ||
    result.outcomes.some((outcome) => outcome.outcome !== "report-only")
  );
}

export async function alertRemediationSweepWorkflow(
  rawInput: AlertRemediationSweepRawInput = {},
): Promise<AlertRemediationSweepResult> {
  const input = AlertRemediationSweepInputSchema.parse(rawInput);
  const collection =
    await collectActivities.collectAlertRemediationAlerts(input);
  const deduped = dedupeAlerts(collection);
  const childInputs = deduped.alerts.map((alert) =>
    AlertRemediationChildInputSchema.parse({
      alert,
      repo: input.repo,
      provider: input.provider,
      model: input.model,
      maxTurns: input.maxTurns,
    }),
  );
  const outcomes = await runChildrenWithLimit(childInputs, input.concurrency);
  const result: AlertRemediationSweepResult = {
    inspectedAlerts: collection.alerts.length,
    startedChildren: childInputs.length,
    skippedDuplicateAlerts: deduped.skipped,
    collectionFailures: collection.failures,
    outcomes,
    emailSent: false,
  };
  if (shouldSendEmail(result)) {
    await emailActivities.sendAlertRemediationSweepEmail({ input, result });
    return { ...result, emailSent: true };
  }
  return result;
}
