import { renderAuditMarkdownToHtml } from "#shared/markdown-to-html.ts";
import { resolvePostalAddresses, sendPostalEmail } from "#shared/postal.ts";
import type {
  AlertRemediationChildResult,
  AlertRemediationSweepInput,
  AlertRemediationSweepResult,
} from "#shared/alert-remediation.ts";
import { defaultAlertRemediationDeps } from "./alert-remediation-runtime.ts";

export type SendAlertRemediationSweepEmailInput = {
  input: AlertRemediationSweepInput;
  result: AlertRemediationSweepResult;
};

export type SendAlertRemediationSweepEmailResult = {
  sent: boolean;
  subject: string | undefined;
  messageId: string | undefined;
};

export function shouldEmail(result: AlertRemediationSweepResult): boolean {
  return (
    result.collectionFailures.length > 0 ||
    result.outcomes.some((outcome) => outcome.outcome !== "report-only")
  );
}

function formatOutcome(outcome: AlertRemediationChildResult): string {
  const lines = [
    `### ${outcome.source}: ${outcome.title}`,
    "",
    `- Fingerprint: \`${outcome.fingerprint}\``,
    `- Outcome: ${outcome.outcome}`,
    `- Decision: ${outcome.decision}`,
    `- Reason: ${outcome.reason}`,
  ];
  if (outcome.prUrl !== undefined) {
    lines.push(`- PR: ${outcome.prUrl}`);
  }
  if (outcome.branchName !== undefined) {
    lines.push(`- Branch: \`${outcome.branchName}\``);
  }
  if (outcome.verificationCommands.length > 0) {
    lines.push(
      `- Verification: ${outcome.verificationCommands.map((command) => `\`${command}\``).join(", ")}`,
    );
  }
  lines.push("", outcome.markdown);
  return lines.join("\n");
}

export async function sendSweepEmail(
  input: SendAlertRemediationSweepEmailInput,
): Promise<SendAlertRemediationSweepEmailResult> {
  if (!shouldEmail(input.result)) {
    return { sent: false, subject: undefined, messageId: undefined };
  }
  const { recipient, sender } = resolvePostalAddresses();
  const date = defaultAlertRemediationDeps.now().toISOString().slice(0, 10);
  const subject = `Alert Remediation: ${date}`;
  const failureLines = input.result.collectionFailures.map(
    (failureItem) => `- ${failureItem.source}: ${failureItem.reason}`,
  );
  const body = [
    "# Alert Remediation Sweep",
    "",
    `Repository: ${input.input.repo.fullName}@${input.input.repo.ref}`,
    `Inspected alerts: ${String(input.result.inspectedAlerts)}`,
    `Started children: ${String(input.result.startedChildren)}`,
    `Skipped duplicate alerts: ${String(input.result.skippedDuplicateAlerts)}`,
    "",
    "## Collection Failures",
    "",
    failureLines.length === 0 ? "None." : failureLines.join("\n"),
    "",
    "## Outcomes",
    "",
    input.result.outcomes.length === 0
      ? "No child workflows produced outcomes."
      : input.result.outcomes
          .map((outcome) => formatOutcome(outcome))
          .join("\n\n"),
  ].join("\n");
  const result = await sendPostalEmail({
    to: recipient,
    from: sender,
    subject,
    htmlBody: renderAuditMarkdownToHtml(body),
    tag: "alert-remediation",
  });
  return { sent: true, subject, messageId: result.messageId };
}
