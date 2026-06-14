import type { PrReviewPipelineInput } from "#shared/schemas.ts";

export type PostReviewStatusState =
  | "draft_skipped"
  | "running"
  | "skipped"
  | "failed";

export type PostReviewStatusInput = {
  pipeline: PrReviewPipelineInput;
  state: PostReviewStatusState;
  reason?: string;
  workflowId?: string;
};

export function renderStatusCommentBody(
  input: PostReviewStatusInput,
  marker: string,
): string {
  const lines: string[] = [];
  lines.push(marker);
  lines.push("");
  lines.push(
    "**pr-review-bot** (deterministic checks + multi-specialist review)",
  );
  lines.push("");
  lines.push(`PR: #${String(input.pipeline.prNumber)}`);
  lines.push(`Commit: \`${input.pipeline.commitSha}\``);
  lines.push("");

  switch (input.state) {
    case "draft_skipped":
      lines.push(
        "Review skipped: draft PR detected. I will run and post inline comments once the PR is marked ready for review.",
      );
      break;
    case "running":
      lines.push(
        "Review running: deterministic checks, specialist review, consensus, verification, and dedupe are in progress.",
      );
      break;
    case "skipped":
      lines.push("Review skipped before deep analysis.");
      appendReason(lines, "Reason", input.reason);
      break;
    case "failed":
      lines.push("Review failed before completion.");
      appendReason(lines, "Failure", input.reason);
      break;
  }

  if (input.workflowId !== undefined) {
    lines.push("");
    lines.push(`Workflow: \`${input.workflowId}\``);
  }
  lines.push("");
  return lines.join("\n");
}

function appendReason(
  lines: string[],
  label: "Failure" | "Reason",
  reason: string | undefined,
): void {
  if (reason === undefined) return;
  lines.push("");
  lines.push(`${label}: ${reason}`);
}
