import { z } from "zod";

import {
  LinearIssueSchema,
  type LinearIssue,
  type Provider,
} from "#src/domain/schemas.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";

const QuerySchema = z.object({ nodes: z.array(LinearIssueSchema) });
const ViewSchema = z.object({
  description: z.string().nullable(),
  comments: z.object({
    nodes: z.array(z.object({ body: z.string() })),
  }),
});
const LabelsSchema = z.object({
  nodes: z.array(z.object({ name: z.string().min(1) })),
});
const LABEL_READY = "agent:ready";
const LABEL_NEEDS_HUMAN = "agent:needs-human";

function labels(issue: LinearIssue): Set<string> {
  return new Set(issue.labels.nodes.map(({ name }) => name));
}

export function providerForIssue(issue: LinearIssue): Provider | undefined {
  const issueLabels = labels(issue);
  const providers = (["codex"] as const).filter((provider) =>
    issueLabels.has(`agent:${provider}`),
  );
  return providers.length === 1 ? providers[0] : undefined;
}

export function isEligibleIssue(issue: LinearIssue): boolean {
  const issueLabels = labels(issue);
  return (
    issue.state.type === "unstarted" &&
    issueLabels.has(LABEL_READY) &&
    !issueLabels.has(LABEL_NEEDS_HUMAN) &&
    providerForIssue(issue) !== undefined
  );
}

function priorityRank(priority: number): number {
  return priority === 0 ? 5 : priority;
}

export function selectIssue(
  issues: readonly LinearIssue[],
): LinearIssue | null {
  const eligible = issues
    .filter((issue) => isEligibleIssue(issue))
    .sort((left, right) => {
      const priority =
        priorityRank(left.priority) - priorityRank(right.priority);
      return priority === 0
        ? left.createdAt.localeCompare(right.createdAt)
        : priority;
    });
  return eligible[0] ?? null;
}

export class LinearClient {
  public constructor(
    private readonly team: string,
    private readonly run: CommandRunner,
    private readonly env?: Readonly<Record<string, string>>,
  ) {}

  private async command(args: readonly string[]): Promise<string> {
    return requireSuccess(
      "Linear command",
      await this.run(
        ["toolkit", "linear", ...args],
        this.env === undefined ? undefined : { env: this.env },
      ),
    ).stdout;
  }

  public async nextIssue(): Promise<LinearIssue | null> {
    const output = await this.command([
      "issue",
      "query",
      "--team",
      this.team,
      "--state",
      "unstarted",
      "--limit",
      "0",
      "--json",
    ]);
    const selected = selectIssue(QuerySchema.parse(JSON.parse(output)).nodes);
    return selected;
  }

  public async agentContext(identifier: string): Promise<string | null> {
    const view = ViewSchema.parse(
      JSON.parse(await this.command(["issue", "view", identifier, "--json"])),
    );
    const comments = view.comments.nodes
      .map(({ body }) => body.trim())
      .filter((body) => body !== "");
    return comments.length === 0
      ? null
      : `Linear comments present for agent context:\n${comments.map((body) => JSON.stringify(body)).join("\n")}`;
  }

  public async labelNames(): Promise<Set<string>> {
    const output = await this.command([
      "label",
      "list",
      "--team",
      this.team,
      "--json",
    ]);
    return new Set(
      LabelsSchema.parse(JSON.parse(output)).nodes.map(({ name }) => name),
    );
  }

  public async claim(issue: LinearIssue): Promise<void> {
    await this.command([
      "issue",
      "update",
      issue.identifier,
      "--state",
      "In Progress",
      "--remove-label",
      LABEL_READY,
    ]);
    await this.comment(
      issue.identifier,
      "Claimed by `justin-principal-engineer`. Work will continue in short, durable turns; this process is not holding an agent open while it waits.",
    );
  }

  public async needsHuman(identifier: string, reason: string): Promise<void> {
    await this.command([
      "issue",
      "update",
      identifier,
      "--add-label",
      LABEL_NEEDS_HUMAN,
    ]);
    await this.comment(identifier, `Human input needed: ${reason}`);
  }

  public async complete(identifier: string, prUrl: string): Promise<void> {
    await this.command([
      "issue",
      "update",
      identifier,
      "--state",
      "Done",
      "--remove-label",
      LABEL_NEEDS_HUMAN,
    ]);
    await this.comment(identifier, `Merged: ${prUrl}`);
  }

  public async completeNoChange(identifier: string): Promise<void> {
    await this.command([
      "issue",
      "update",
      identifier,
      "--state",
      "Done",
      "--remove-label",
      LABEL_NEEDS_HUMAN,
    ]);
    await this.comment(
      identifier,
      "No change needed; the requested state was already present.",
    );
  }

  public async comment(identifier: string, body: string): Promise<void> {
    await this.command(["issue", "comment", "add", identifier, "--body", body]);
  }
}
