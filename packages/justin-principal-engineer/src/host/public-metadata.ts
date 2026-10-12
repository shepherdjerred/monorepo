import type { TaskState, AgentOutput } from "#src/domain/schemas.ts";

export function taskPullRequestBody(
  state: TaskState,
  output: AgentOutput,
): string {
  const verification =
    output.verification.length === 0
      ? "- Not reported"
      : output.verification.map((item) => `- ${item}`).join("\n");
  return `## Why

${state.issue.description ?? state.issue.title}

Linear: ${state.issue.url}

## What

${output.summary}

## Verification

${verification}

## Live checks not run

- Deployment and live acceptance are not implied by PR CI.
`;
}
