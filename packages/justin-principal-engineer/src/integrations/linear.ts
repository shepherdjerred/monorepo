import { z } from "zod";

import {
  LinearIssueSchema,
  type LinearIssue,
  type Provider,
} from "#src/domain/schemas.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";
import { AUTONOMOUS_LABEL, BLOCKED_LABEL } from "#src/domain/autonomy.ts";

// Toolkit flattens connections in its CLI JSON; durable snapshots and raw
// GraphQL reads retain Linear's connection shape.
const QuerySchema = z.array(
  LinearIssueSchema.extend({
    labels: LinearIssueSchema.shape.labels.shape.nodes,
  }).transform(({ labels: issueLabels, ...issue }) => ({
    ...issue,
    labels: { nodes: issueLabels },
  })),
);
const ViewSchema = z.object({
  description: z.string().nullable(),
  comments: z.array(z.object({ body: z.string() })),
});
const LabelsSchema = z.array(z.object({ name: z.string().min(1) }));
const LABEL_READY = "agent:ready";
const LABEL_NEEDS_HUMAN = "agent:needs-human";

const TeamLabelsSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string().min(1) }),
);

const MutationResultSchema = z.object({
  data: z.object({
    issueUpdate: z.object({ success: z.literal(true) }),
  }),
});

const TeamStatesSchema = z.object({
  data: z.object({
    teams: z.object({
      nodes: z.array(
        z.object({
          states: z.object({
            nodes: z.array(
              z.object({
                name: z.string().min(1),
                type: z.string().min(1),
                position: z.number(),
              }),
            ),
          }),
        }),
      ),
    }),
  }),
});

const MANAGED_LABELS = [
  {
    name: AUTONOMOUS_LABEL,
    color: "#2563EB",
    description: "Authorize a small DevEx ticket for autonomous merge",
  },
  {
    name: BLOCKED_LABEL,
    color: "#D97706",
    description:
      "Autonomous task is blocked; see recorded reason and retry time",
  },
  {
    name: "agent:codex",
    color: "#059669",
    description: "Use the Codex SDK with native OpenAI credentials",
  },
  {
    name: LABEL_NEEDS_HUMAN,
    color: "#DC2626",
    description: "Parked until Jerred requeues it",
  },
] as const;

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
    !issueLabels.has(BLOCKED_LABEL) &&
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

  public async nextIssue(
    include?: (issue: LinearIssue) => Promise<boolean>,
  ): Promise<LinearIssue | null> {
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
      "all",
      "--json",
    ]);
    const candidates = QuerySchema.parse(JSON.parse(output));
    while (candidates.length > 0) {
      const selected = selectIssue(candidates);
      if (selected === null) return null;
      if (include === undefined) return selected;
      const fresh = await this.refreshIssue(selected.identifier);
      if (fresh !== null && isEligibleIssue(fresh) && (await include(fresh)))
        return fresh;
      candidates.splice(candidates.indexOf(selected), 1);
    }
    return null;
  }

  public async agentContext(identifier: string): Promise<string | null> {
    const view = ViewSchema.parse(
      JSON.parse(await this.command(["issue", "view", identifier, "--json"])),
    );
    const comments = view.comments
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
      LabelsSchema.parse(JSON.parse(output)).map(({ name }) => name),
    );
  }

  private readonly labelIdsCache = new Map<string, Map<string, string>>();

  public async refreshIssue(identifier: string): Promise<LinearIssue | null> {
    const output = await this.command([
      "api",
      "query($id: String!) { issue(id: $id) { id identifier title description url priority createdAt team { key } project { id name } state { name type } labels { nodes { name } } } }",
      "--variables-json",
      JSON.stringify({ id: identifier }),
    ]);
    return z
      .object({ data: z.object({ issue: LinearIssueSchema.nullable() }) })
      .parse(JSON.parse(output)).data.issue;
  }

  private async resolveTeam(issue: LinearIssue): Promise<string> {
    // No configured-team fallback: issue snapshots without a team predate
    // team tracking, and mutating them with another team's IDs fails or
    // worse. Active tasks bypass the queue query, so refetch legacy
    // snapshots instead of wedging the slot on a throw.
    const snapshot = issue.team?.key;
    if (snapshot !== undefined) return snapshot;
    const refreshed = await this.refreshIssue(issue.identifier);
    const team = refreshed?.team?.key;
    if (team === undefined) {
      throw new Error(
        `${issue.identifier} has no team; remove agent:needs-human to requeue it with a fresh snapshot`,
      );
    }
    return team;
  }

  private async labelIds(team: string): Promise<Map<string, string>> {
    const cached = this.labelIdsCache.get(team);
    if (cached !== undefined) return cached;
    const output = await this.command([
      "label",
      "list",
      "--team",
      team,
      "--json",
    ]);
    const parsed = TeamLabelsSchema.parse(JSON.parse(output));
    const ids = new Map(parsed.map(({ id, name }) => [name, id] as const));
    this.labelIdsCache.set(team, ids);
    return ids;
  }

  private async mutateLabels(input: {
    nodeId: string;
    team: string;
    add: readonly string[];
    remove: readonly string[];
  }): Promise<void> {
    // Label names resolve inside the issue's own team, so issues are
    // mutated by label ID resolved from that same team.
    if (input.add.length === 0 && input.remove.length === 0) return;
    const ids = await this.labelIds(input.team);
    const toIds = (names: readonly string[]): string[] =>
      names.map((name) => {
        const id = ids.get(name);
        if (id === undefined) {
          throw new Error(
            `Linear label ${name} does not exist on team ${input.team}`,
          );
        }
        return id;
      });
    const output = await this.command([
      "api",
      "mutation($id: String!, $add: [String!], $remove: [String!]) { issueUpdate(id: $id, input: {addedLabelIds: $add, removedLabelIds: $remove}) { success } }",
      "--variables-json",
      JSON.stringify({
        id: input.nodeId,
        add: toIds(input.add),
        remove: toIds(input.remove),
      }),
    ]);
    // A zero exit does not mean the mutation applied: Linear can answer
    // success:false inside a 200. Reject it here so a failed park never
    // leaves the issue eligible.
    const applied = MutationResultSchema.safeParse(JSON.parse(output));
    if (!applied.success) {
      throw new Error(
        `Linear label mutation failed for ${input.nodeId}: ${output.slice(0, 200)}`,
      );
    }
  }

  private readonly teamStatesCache = new Map<
    string,
    { name: string; type: string; position: number }[]
  >();

  private async teamStates(
    team: string,
  ): Promise<{ name: string; type: string; position: number }[]> {
    const cached = this.teamStatesCache.get(team);
    if (cached !== undefined) return cached;
    const output = await this.command([
      "api",
      "query($key: String!) { teams(filter: {key: {eq: $key}}) { nodes { states { nodes { name type position } } } } }",
      "--variables-json",
      JSON.stringify({ key: team }),
    ]);
    const parsed = TeamStatesSchema.parse(JSON.parse(output));
    const states = parsed.data.teams.nodes[0]?.states.nodes ?? [];
    this.teamStatesCache.set(team, states);
    return states;
  }

  private async workflowState(
    team: string,
    type: string,
    preferred: string,
  ): Promise<string> {
    // State names are per-team; resolve by type so renamed workflows keep
    // working, preferring the conventional name when it exists.
    const states = await this.teamStates(team);
    const candidates = states
      .filter((state) => state.type === type)
      .sort((left, right) => left.position - right.position);
    const chosen =
      candidates.find((state) => state.name === preferred) ?? candidates[0];
    if (chosen === undefined) {
      throw new Error(`Team ${team} has no ${type} workflow state`);
    }
    return chosen.name;
  }

  private async setState(
    issue: LinearIssue,
    type: string,
    preferred: string,
  ): Promise<void> {
    const name = await this.workflowState(
      await this.resolveTeam(issue),
      type,
      preferred,
    );
    await this.command(["issue", "update", issue.identifier, "--state", name]);
  }

  private removableLabels(issue: LinearIssue): string[] {
    const present = labels(issue);
    const candidates = [
      LABEL_NEEDS_HUMAN,
      LABEL_READY,
      AUTONOMOUS_LABEL,
      BLOCKED_LABEL,
    ];
    const provider = providerForIssue(issue);
    if (provider !== undefined) candidates.push(`agent:${provider}`);
    return candidates.filter((label) => present.has(label));
  }

  public async claim(issue: LinearIssue): Promise<void> {
    // The provider label stays on through the whole task so that clearing
    // agent:needs-human requeues without relabeling. Only legacy labels go.
    await this.setState(issue, "started", "In Progress");
    const present = labels(issue);
    await this.mutateLabels({
      nodeId: issue.id,
      team: await this.resolveTeam(issue),
      add: [],
      remove: present.has(LABEL_READY) ? [LABEL_READY] : [],
    });
    await this.comment(
      issue.identifier,
      "Claimed by `justin-principal-engineer`. Work will continue in short, durable turns; this process is not holding an agent open while it waits.",
    );
  }

  private async ensureLabels(
    team: string,
    names: readonly string[],
  ): Promise<void> {
    // Parking is the only path that adds labels, so a team that has never
    // parked is missing agent:needs-human by construction. Create managed
    // labels on demand instead of failing the park.
    const ids = await this.labelIds(team);
    const missing = names.filter((name) => !ids.has(name));
    for (const name of missing) {
      const managed = MANAGED_LABELS.find((label) => label.name === name);
      if (managed === undefined) {
        throw new Error(`Linear label ${name} does not exist on team ${team}`);
      }
      await this.command([
        "label",
        "create",
        "--team",
        team,
        "--name",
        managed.name,
        "--color",
        managed.color,
        "--description",
        managed.description,
      ]);
    }
    if (missing.length > 0) this.labelIdsCache.delete(team);
  }

  public async needsHuman(issue: LinearIssue, reason: string): Promise<void> {
    if (!labels(issue).has(LABEL_NEEDS_HUMAN)) {
      const team = await this.resolveTeam(issue);
      await this.ensureLabels(team, [LABEL_NEEDS_HUMAN]);
      await this.mutateLabels({
        nodeId: issue.id,
        team,
        add: [LABEL_NEEDS_HUMAN],
        remove: [],
      });
    }
    await this.comment(issue.identifier, `Human input needed: ${reason}`);
  }

  public async requeue(issue: LinearIssue): Promise<void> {
    // Compensates a park whose post-label work failed: removing the label
    // returns the issue to the runnable queue so the next run retries the
    // turn instead of running parked work.
    await this.mutateLabels({
      nodeId: issue.id,
      team: await this.resolveTeam(issue),
      add: [],
      remove: [LABEL_NEEDS_HUMAN],
    });
  }

  public async blocked(
    issue: LinearIssue,
    reason: string,
    retryAt: string | null,
    options?: { comment: boolean },
  ): Promise<void> {
    const team = await this.resolveTeam(issue);
    await this.ensureLabels(team, [BLOCKED_LABEL]);
    await this.mutateLabels({
      nodeId: issue.id,
      team,
      add: [BLOCKED_LABEL],
      remove: [],
    });
    if (options?.comment !== false)
      await this.comment(
        issue.identifier,
        `Autonomous task blocked: ${reason}${retryAt === null ? "" : `\nNext automatic check: ${retryAt}`}`,
      );
  }

  public async resumeBlocked(issue: LinearIssue): Promise<void> {
    if (!labels(issue).has(BLOCKED_LABEL)) return;
    await this.mutateLabels({
      nodeId: issue.id,
      team: await this.resolveTeam(issue),
      add: [],
      remove: [BLOCKED_LABEL],
    });
  }

  public async complete(issue: LinearIssue, prUrl: string): Promise<void> {
    // Labels first: a failed cleanup must never leave the issue completed
    // while local state is still active, or every later turn runs against
    // an already-completed issue. The terminal state lands last.
    await this.mutateLabels({
      nodeId: issue.id,
      team: await this.resolveTeam(issue),
      add: [],
      remove: this.removableLabels(issue),
    });
    await this.setState(issue, "completed", "Done");
    await this.comment(issue.identifier, `Merged: ${prUrl}`);
  }

  public async completeNoChange(issue: LinearIssue): Promise<void> {
    // Labels first, for the same reason as complete: keep the issue
    // non-terminal until cleanup succeeds so a failure stays retryable.
    await this.mutateLabels({
      nodeId: issue.id,
      team: await this.resolveTeam(issue),
      add: [],
      remove: this.removableLabels(issue),
    });
    await this.setState(issue, "completed", "Done");
    await this.comment(
      issue.identifier,
      "No change needed; the requested state was already present.",
    );
  }

  public async comment(identifier: string, body: string): Promise<void> {
    await this.command(["issue", "comment", "add", identifier, "--body", body]);
  }
}
