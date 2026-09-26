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

const TeamLabelsSchema = z.object({
  nodes: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
});

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

const TERMINAL_STATE_TYPES = new Set(["completed", "canceled"]);

export function isEligibleIssue(issue: LinearIssue): boolean {
  const issueLabels = labels(issue);
  return (
    !TERMINAL_STATE_TYPES.has(issue.state.type) &&
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
      "--all-teams",
      "--label",
      "agent:codex",
      "--state",
      "triage",
      "--state",
      "backlog",
      "--state",
      "unstarted",
      "--state",
      "started",
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

  private labelIdsCache: Map<string, string> | null = null;

  private async labelIds(): Promise<Map<string, string>> {
    if (this.labelIdsCache === null) {
      const output = await this.command([
        "label",
        "list",
        "--team",
        this.team,
        "--json",
      ]);
      const parsed = TeamLabelsSchema.parse(JSON.parse(output));
      this.labelIdsCache = new Map(
        parsed.nodes.map(({ id, name }) => [name, id] as const),
      );
    }
    return this.labelIdsCache;
  }

  private async mutateLabels(input: {
    nodeId: string;
    add: readonly string[];
    remove: readonly string[];
  }): Promise<void> {
    // Label names resolve inside the issue's own team, so cross-team issues
    // must be mutated by label ID from the runner's home team instead.
    if (input.add.length === 0 && input.remove.length === 0) return;
    const ids = await this.labelIds();
    const toIds = (names: readonly string[]): string[] =>
      names.map((name) => {
        const id = ids.get(name);
        if (id === undefined) {
          throw new Error(
            `Linear label ${name} does not exist on team ${this.team}`,
          );
        }
        return id;
      });
    await this.command([
      "api",
      "mutation($id: String!, $add: [ID!], $remove: [ID!]) { issueUpdate(input: {id: $id, addedLabelIds: $add, removedLabelIds: $remove}) { success } }",
      "--variables-json",
      JSON.stringify({
        id: input.nodeId,
        add: toIds(input.add),
        remove: toIds(input.remove),
      }),
    ]);
  }

  private async setState(identifier: string, state: string): Promise<void> {
    await this.command(["issue", "update", identifier, "--state", state]);
  }

  private removableLabels(issue: LinearIssue): string[] {
    const present = labels(issue);
    const candidates = [LABEL_NEEDS_HUMAN, LABEL_READY];
    const provider = providerForIssue(issue);
    if (provider !== undefined) candidates.push(`agent:${provider}`);
    return candidates.filter((label) => present.has(label));
  }

  public async claim(issue: LinearIssue): Promise<void> {
    // The provider label stays on through the whole task so that clearing
    // agent:needs-human requeues without relabeling. Only legacy labels go.
    await this.setState(issue.identifier, "In Progress");
    const present = labels(issue);
    await this.mutateLabels({
      nodeId: issue.id,
      add: [],
      remove: present.has(LABEL_READY) ? [LABEL_READY] : [],
    });
    await this.comment(
      issue.identifier,
      "Claimed by `justin-principal-engineer`. Work will continue in short, durable turns; this process is not holding an agent open while it waits.",
    );
  }

  public async needsHuman(issue: LinearIssue, reason: string): Promise<void> {
    if (!labels(issue).has(LABEL_NEEDS_HUMAN)) {
      await this.mutateLabels({
        nodeId: issue.id,
        add: [LABEL_NEEDS_HUMAN],
        remove: [],
      });
    }
    await this.comment(issue.identifier, `Human input needed: ${reason}`);
  }

  public async complete(issue: LinearIssue, prUrl: string): Promise<void> {
    await this.setState(issue.identifier, "Done");
    await this.mutateLabels({
      nodeId: issue.id,
      add: [],
      remove: this.removableLabels(issue),
    });
    await this.comment(issue.identifier, `Merged: ${prUrl}`);
  }

  public async completeNoChange(issue: LinearIssue): Promise<void> {
    await this.setState(issue.identifier, "Done");
    await this.mutateLabels({
      nodeId: issue.id,
      add: [],
      remove: this.removableLabels(issue),
    });
    await this.comment(
      issue.identifier,
      "No change needed; the requested state was already present.",
    );
  }

  public async comment(identifier: string, body: string): Promise<void> {
    await this.command(["issue", "comment", "add", identifier, "--body", body]);
  }
}
