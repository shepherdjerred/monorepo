import { proxyActivities } from "@temporalio/workflow";
import type {
  HomelabAuditActivities,
  HomelabAuditAgentInput,
} from "#activities/homelab-audit.ts";

const RETRY = {
  maximumAttempts: 3,
  initialInterval: "1 minute" as const,
  backoffCoefficient: 2,
  maximumInterval: "10 minutes" as const,
};

// The agent run is the long pole — claude -p drives kubectl/talosctl/toolkit/
// tofu through a 13-section runbook and writes the markdown audit. 45 min is
// generous for the full run (hand-run audits land in ~25 min); the workflow
// schedule sets 60 min as the workflow execution timeout to leave slack for
// retries.
const { runHomelabAuditAgent } = proxyActivities<HomelabAuditActivities>({
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "60 seconds",
  retry: RETRY,
});

const { sendHomelabAuditEmail } = proxyActivities<HomelabAuditActivities>({
  startToCloseTimeout: "1 minute",
  retry: RETRY,
});

export type RunHomelabAuditWorkflowInput = {
  /** ISO date for the audit. Defaults to the workflow start time when undefined. */
  date?: string;
};

export async function runHomelabAuditWorkflow(
  input: RunHomelabAuditWorkflowInput = {},
): Promise<void> {
  const agentInput: HomelabAuditAgentInput = {};
  if (input.date !== undefined) {
    agentInput.date = input.date;
  }
  const agent = await runHomelabAuditAgent(agentInput);
  await sendHomelabAuditEmail({
    date: input.date ?? new Date().toISOString().slice(0, 10),
    markdown: agent.markdown,
  });
}
