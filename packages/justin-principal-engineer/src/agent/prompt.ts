import type { Feedback, PrHealth, TaskState } from "#src/domain/schemas.ts";
import { linearCommentBodies } from "./public-output.ts";

function feedbackSection(feedback: readonly Feedback[]): string {
  return feedback.length === 0
    ? "No new human feedback."
    : feedback
        .map(
          (item) =>
            `- ${item.source} at ${item.createdAt}${item.url === null ? "" : ` (${item.url})`}:\n${item.body}`,
        )
        .join("\n\n");
}

/**
 * Linear comments are agent-only input. Refuse publication if the untrusted
 * model summary contains any comment verbatim, rather than relying on prompt
 * instructions to enforce that boundary.
 */
export function assertNoLinearContextLeak(
  summary: string,
  linearContext: string | null,
): void {
  if (linearContext === null) return;
  const comments = linearCommentBodies(linearContext);
  const normalizedSummary = summary.toLocaleLowerCase();
  const leaked = comments.find((comment) =>
    normalizedSummary.includes(comment.toLocaleLowerCase()),
  );
  if (leaked !== undefined) {
    throw new Error(
      "Agent summary contains Linear-only comment content; refusing to publish",
    );
  }
}

export function buildAgentPrompt(input: {
  state: TaskState;
  feedback?: readonly Feedback[];
  health?: PrHealth;
  diagnostics?: string;
  linearContext?: string | null;
}): string {
  const { issue } = input.state;
  const health =
    input.health === undefined
      ? "No CI failure context."
      : JSON.stringify(input.health, null, 2);
  return `Implement or revise Linear issue ${issue.identifier}: ${issue.title}

Issue URL: ${issue.url}

Description:
${issue.description ?? "No description was provided."}

Agent-only Linear comments (never publish these to GitHub):
${input.linearContext ?? "No additional Linear comments were provided."}

New feedback from the repository owner:
${feedbackSection(input.feedback ?? [])}

Exact-head PR health context:
${health}

Host-collected review findings and CI logs:
${input.diagnostics ?? "No host diagnostics were collected."}

Codex finding keys currently eligible for resolution (only claim keys you actually fixed):
${input.state.pendingCodexFindingKeys.length === 0 ? "None." : input.state.pendingCodexFindingKeys.join(", ")}

Provider-aware findings eligible for resolution:
${JSON.stringify(input.state.pendingReviewFindings)}

${input.state.deliveryMode === "autonomous" ? "This is an autonomous DevEx task. Make one bounded fix in one existing workspace plus related documentation. Allowed workspace paths are src/, test/, tests/, and README.md; related wiki Markdown is also allowed. Do not edit package.json, lockfiles, other manifests, dependencies, credentials/authentication, infrastructure, CI/release policy, repository guidance, or Justin's controls. Add meaningful regression coverage for a behavioral fix within an existing test-discovery path; do not modify test scripts or manifests to register a new directory. Inspect the complete branch diff, including prior work, for these restrictions before returning changed. If requirements are unclear or scope expands, return needs_human; the host records a blocked task and continues its queue. You have at most three repair turns after initial implementation." : "This task retains exact-head owner approval before merge."}

Work directly in /workspace. Read and obey the repository's AGENTS.md and matching skills. Own the implementation and run proportionate focused verification. Do not commit, push, create or merge a pull request, change Linear, or use GitHub credentials; the host owns those capabilities. Do not weaken checks or leave placeholders. For visual changes, include the smallest toolkit screenshot target that proves each changed surface. If the task is ambiguous or unsafe to finish autonomously, return needs_human with a precise question.

Your final response must match the supplied JSON schema. The summary must describe the complete current branch outcome, including earlier work. Choose a concise conventional commitTitle in the repository's required type(scope): outcome format. Use status changed when you made a useful workspace change, no_change only when the requested state is already correct, and needs_human only when a concrete human decision is required. Put only the exact provider/key pairs you addressed in resolvedFindings. Legacy Codex keys may go in resolvedFindingKeys. Do not claim unrelated or unverified findings.`;
}
