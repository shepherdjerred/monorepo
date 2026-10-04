import type { LinearIssue } from "#src/domain/schemas.ts";

export const AUTONOMOUS_LABEL = "agent:autonomous";
export const BLOCKED_LABEL = "agent:blocked";
export const DEVEX_PROJECT_ID = "41bcb7e7-eacd-48e7-898f-8021bb9f2684";
export const MAX_REPAIR_TURNS = 3;

export function isAutonomousIssue(issue: LinearIssue): boolean {
  return issue.labels.nodes.some(({ name }) => name === AUTONOMOUS_LABEL);
}

export function autonomyIssueBlocker(issue: LinearIssue): string | null {
  const labels = new Set(issue.labels.nodes.map(({ name }) => name));
  if (issue.team?.key !== "AI" || issue.project?.id !== DEVEX_PROJECT_ID)
    return "Autonomous work requires the AI team's Developer Experience project";
  if (!labels.has(AUTONOMOUS_LABEL) || !labels.has("agent:codex"))
    return "Autonomous authorization was removed from the Linear issue";
  if (labels.has("agent:needs-human")) return "The issue is explicitly parked";
  return ["completed", "canceled"].includes(issue.state.type)
    ? "The Linear issue is already terminal"
    : null;
}

export class AutonomousBlocker extends Error {
  public constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AutonomousBlocker";
  }
}
