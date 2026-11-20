import { z } from "zod";
import {
  TrackerIssueSchema,
  type TrackerIssue,
  type Provider,
  type Config,
} from "#src/domain/schemas.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";
import { AUTONOMOUS_LABEL, BLOCKED_LABEL } from "#src/domain/autonomy.ts";

const WireIssueSchema = TrackerIssueSchema.extend({
  labels: z.array(z.object({ name: z.string().min(1) })),
}).transform(({ labels: names, ...issue }) => ({
  ...issue,
  labels: { nodes: names },
}));
const QuerySchema = z.object({
  items: z.array(WireIssueSchema),
  nextCursor: z.string().nullable(),
});
const ViewSchema = z.object({
  comments: z.array(z.object({ body: z.string() })),
});
const ContextViewSchema = z.intersection(
  WireIssueSchema,
  z.object({
    comments: z.array(
      z.object({
        id: z.string().min(1),
        body: z.string(),
        editedAt: z.string().nullable(),
        author: z.object({ kind: z.string() }),
      }),
    ),
  }),
);
const startedStateTypes = new Set([
  "triage",
  "backlog",
  "unstarted",
  "started",
]);
const LabelsSchema = z.array(z.object({ name: z.string().min(1) }));
const LABEL_READY = "agent:ready";
const LABEL_NEEDS_HUMAN = "agent:needs-human";
const MANAGED_LABELS = [
  { name: AUTONOMOUS_LABEL, color: "#2563eb" },
  { name: BLOCKED_LABEL, color: "#d97706" },
  { name: "agent:codex", color: "#059669" },
  { name: LABEL_NEEDS_HUMAN, color: "#dc2626" },
] as const;
function labels(issue: TrackerIssue) {
  return new Set(issue.labels.nodes.map(({ name }) => name));
}
export function providerForIssue(issue: TrackerIssue): Provider | undefined {
  return labels(issue).has("agent:codex") ? "codex" : undefined;
}
export function isEligibleIssue(issue: TrackerIssue, allowPassed = false) {
  const names = labels(issue);
  const automatic =
    issue.team?.key === "AI" &&
    issue.assigneeId === null &&
    ["backlog", "unstarted"].includes(issue.state.type);
  return (
    issue.archivedAt == null &&
    startedStateTypes.has(issue.state.type) &&
    (allowPassed || !names.has(LABEL_NEEDS_HUMAN)) &&
    !names.has(BLOCKED_LABEL) &&
    (automatic || providerForIssue(issue) !== undefined)
  );
}
const priorityRank = (priority: number) => (priority === 0 ? 5 : priority);
export function compareIssuePriority(a: TrackerIssue, b: TrackerIssue): number {
  return (
    priorityRank(a.priority) - priorityRank(b.priority) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
  );
}
export function selectIssue(
  issues: readonly TrackerIssue[],
): TrackerIssue | null {
  return (
    issues
      .filter((candidate) => isEligibleIssue(candidate))
      .sort(compareIssuePriority)[0] ?? null
  );
}

/** Toolkit owns transport, errors and actor metadata; the host owns queue policy. */
export class TrackerClient {
  public constructor(
    private readonly team: string,
    private readonly run: CommandRunner,
    private readonly env?: Readonly<Record<string, string>>,
  ) {}
  private execute(args: readonly string[], identifier = "catalog") {
    return this.run(
      [
        "toolkit",
        "tracker",
        ...args,
        "--json",
        "--actor-key",
        "justin:" + identifier,
        "--actor-kind",
        "runner",
        "--actor-name",
        "justin-principal-engineer",
      ],
      this.env === undefined ? undefined : { env: this.env },
    );
  }
  private async command(args: readonly string[], identifier = "catalog") {
    return requireSuccess(
      "Tracker command",
      await this.execute(args, identifier),
    ).stdout;
  }
  public async nextIssue(
    include?: (issue: TrackerIssue) => Promise<boolean>,
  ): Promise<TrackerIssue | null> {
    for (const selected of await this.listCandidates()) {
      if (include === undefined) return selected;
      const fresh = await this.refreshIssue(selected.identifier);
      if (fresh !== null && isEligibleIssue(fresh) && (await include(fresh)))
        return fresh;
    }
    return null;
  }
  public async listCandidates(): Promise<TrackerIssue[]> {
    const output = await this.command([
      "issue",
      "list",
      "--team",
      this.team,
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
    ]);
    return QuerySchema.parse(JSON.parse(output))
      .items.filter((candidate) => isEligibleIssue(candidate))
      .sort(compareIssuePriority);
  }
  public async refreshIssue(identifier: string): Promise<TrackerIssue | null> {
    const result = await this.execute(
      ["issue", "view", identifier],
      identifier,
    );
    const notFound =
      result.exitCode !== 0 &&
      result.stderr.includes("Issue " + identifier + " not found");
    return notFound
      ? null
      : WireIssueSchema.parse(
          JSON.parse(requireSuccess("Tracker issue view", result).stdout),
        );
  }
  public async agentContext(identifier: string) {
    const view = ViewSchema.parse(
      JSON.parse(await this.command(["issue", "view", identifier], identifier)),
    );
    return formatAgentContext(view.comments);
  }
  public async issueContext(identifier: string) {
    const result = await this.execute(
      ["issue", "view", identifier],
      identifier,
    );
    if (
      result.exitCode !== 0 &&
      result.stderr.includes("Issue " + identifier + " not found")
    )
      return null;
    const { comments, ...issue } = ContextViewSchema.parse(
      JSON.parse(requireSuccess("Tracker issue view", result).stdout),
    );
    return { issue, comments, prompt: formatAgentContext(comments) };
  }
  public async labelNames() {
    return new Set(
      LabelsSchema.parse(
        JSON.parse(await this.command(["label", "list", "--team", this.team])),
      ).map(({ name }) => name),
    );
  }
  public async checkCatalog() {
    const teams = z
      .array(z.object({ key: z.string() }))
      .parse(JSON.parse(await this.command(["team", "list"])));
    if (!teams.some(({ key }) => key === this.team))
      throw new Error("Tracker team is missing: " + this.team);
    z.object({ slug: z.literal("developer-experience") }).parse(
      JSON.parse(
        await this.command(["project", "view", "developer-experience"]),
      ),
    );
  }
  private async mutateLabels(
    issue: TrackerIssue,
    add: readonly string[],
    remove: readonly string[],
  ) {
    if (add.length + remove.length === 0) return;
    const args = ["issue", "update", issue.identifier];
    for (const name of add) args.push("--add-label", name);
    for (const name of remove) args.push("--remove-label", name);
    const saved = z
      .object({ identifier: z.literal(issue.identifier) })
      .safeParse(JSON.parse(await this.command(args, issue.identifier)));
    if (!saved.success)
      throw new Error("Tracker label mutation failed for " + issue.identifier);
  }
  private async ensureLabels(issue: TrackerIssue, names: readonly string[]) {
    const team = await this.teamForIssue(issue);
    const existing = LabelsSchema.parse(
      JSON.parse(await this.command(["label", "list", "--team", team])),
    );
    for (const name of names.filter(
      (candidate) => !existing.some((label) => label.name === candidate),
    )) {
      const managed = MANAGED_LABELS.find((label) => label.name === name);
      if (managed === undefined)
        throw new Error("Unknown managed Tracker label: " + name);
      await this.command(
        [
          "label",
          "create",
          "--team",
          team,
          "--name",
          name,
          "--color",
          managed.color,
        ],
        issue.identifier,
      );
    }
  }
  private async setState(issue: TrackerIssue, state: string) {
    await this.teamForIssue(issue);
    await this.command(
      ["issue", "update", issue.identifier, "--state", state],
      issue.identifier,
    );
  }
  private async teamForIssue(issue: TrackerIssue) {
    const fresh =
      issue.team === undefined
        ? await this.refreshIssue(issue.identifier)
        : null;
    const team = issue.team?.key ?? fresh?.team?.key;
    if (team === undefined) throw new Error(issue.identifier + " has no team");
    if (!issue.identifier.startsWith(team + "-"))
      throw new Error("Tracker issue team disagrees with identifier");
    return team;
  }
  private removableLabels(issue: TrackerIssue) {
    const present = labels(issue);
    const candidates = [
      LABEL_NEEDS_HUMAN,
      LABEL_READY,
      AUTONOMOUS_LABEL,
      BLOCKED_LABEL,
    ];
    const provider = providerForIssue(issue);
    if (provider !== undefined) candidates.push("agent:" + provider);
    return candidates.filter((label) => present.has(label));
  }
  public async claim(
    issue: TrackerIssue,
    options: { retryPassed?: boolean; requireRevision?: boolean } = {},
  ): Promise<TrackerIssue | null> {
    await this.teamForIssue(issue);
    if (options.requireRevision === true && issue.revision === undefined)
      throw new Error(`${issue.identifier} has no claim revision`);
    const present = labels(issue);
    const addProvider = !present.has("agent:codex");
    if (addProvider) await this.ensureLabels(issue, ["agent:codex"]);
    const args = ["issue", "update", issue.identifier, "--state", "started"];
    if (issue.revision !== undefined)
      args.push("--expected-revision", String(issue.revision));
    if (addProvider) args.push("--add-label", "agent:codex");
    if (present.has(LABEL_READY)) args.push("--remove-label", LABEL_READY);
    if (options.retryPassed === true && present.has(LABEL_NEEDS_HUMAN))
      args.push("--remove-label", LABEL_NEEDS_HUMAN);
    const result = await this.execute(args, issue.identifier);
    if (
      result.exitCode !== 0 &&
      /(?:changed|moved)\. Reload before saving\./u.test(result.stderr)
    )
      return null;
    const updated = WireIssueSchema.parse(
      JSON.parse(requireSuccess("Tracker claim", result).stdout),
    );
    if (updated.identifier !== issue.identifier)
      throw new Error(
        `${issue.identifier}: Tracker claim returned a different issue`,
      );
    return updated;
  }
  public async claimPreviouslyApplied(issue: TrackerIssue): Promise<boolean> {
    if (issue.revision === undefined) return false;
    const command = await this.command(
      ["issue", "events", issue.identifier],
      issue.identifier,
    );
    const events = z
      .array(
        z.object({
          action: z.string(),
          entityType: z.string(),
          actor: z.object({ key: z.string() }),
          after: z.unknown(),
        }),
      )
      .parse(JSON.parse(command));
    const appliedRevision = issue.revision + 1;
    const after = z.object({ revision: z.literal(appliedRevision) });
    return events.some(
      (event) =>
        event.action === "updated" &&
        event.entityType === "issue" &&
        event.actor.key === "justin:" + issue.identifier &&
        after.safeParse(event.after).success,
    );
  }
  public async parkPass(issue: TrackerIssue, body: string) {
    const view = await this.command(
      ["issue", "view", issue.identifier],
      issue.identifier,
    );
    const fresh = WireIssueSchema.parse(JSON.parse(view));
    if (!labels(fresh).has(LABEL_NEEDS_HUMAN)) {
      await this.ensureLabels(fresh, [LABEL_NEEDS_HUMAN]);
      await this.mutateLabels(fresh, [LABEL_NEEDS_HUMAN], []);
    }
    const comments = ViewSchema.parse(JSON.parse(view)).comments;
    if (!comments.some((comment) => comment.body === body))
      await this.comment(issue.identifier, body);
  }
  public async needsHuman(issue: TrackerIssue, reason: string) {
    if (!labels(issue).has(LABEL_NEEDS_HUMAN)) {
      await this.ensureLabels(issue, [LABEL_NEEDS_HUMAN]);
      await this.mutateLabels(issue, [LABEL_NEEDS_HUMAN], []);
    }
    await this.comment(issue.identifier, "Human input needed: " + reason);
  }
  public async requeue(issue: TrackerIssue) {
    await this.mutateLabels(issue, [], [LABEL_NEEDS_HUMAN]);
  }
  public async blocked(
    issue: TrackerIssue,
    reason: string,
    retryAt: string | null,
    options?: { comment: boolean },
  ) {
    await this.ensureLabels(issue, [BLOCKED_LABEL]);
    await this.mutateLabels(issue, [BLOCKED_LABEL], []);
    if (options?.comment !== false)
      await this.comment(
        issue.identifier,
        "Autonomous task blocked: " +
          reason +
          (retryAt === null ? "" : "\nNext automatic check: " + retryAt),
      );
  }
  public async resumeBlocked(issue: TrackerIssue) {
    if (labels(issue).has(BLOCKED_LABEL))
      await this.mutateLabels(issue, [], [BLOCKED_LABEL]);
  }
  public async complete(issue: TrackerIssue, prUrl: string) {
    await this.mutateLabels(issue, [], this.removableLabels(issue));
    await this.setState(issue, "completed");
    await this.comment(issue.identifier, "Merged: " + prUrl);
  }
  public async completeNoChange(issue: TrackerIssue, evidence?: string) {
    await this.mutateLabels(issue, [], this.removableLabels(issue));
    await this.setState(issue, "completed");
    await this.comment(
      issue.identifier,
      "No change needed; the requested state was already present." +
        (evidence === undefined ? "" : `\n\nVerification:\n${evidence}`),
    );
  }
  public async comment(identifier: string, body: string) {
    await this.command(
      ["issue", "comment", "add", identifier, "--body", body],
      identifier,
    );
  }
}

function formatAgentContext(comments: readonly { body: string }[]) {
  const bodies = comments.map(({ body }) => body.trim()).filter(Boolean);
  return bodies.length === 0
    ? null
    : "Tracker comments present for agent context:\n" +
        bodies.map((body) => JSON.stringify(body)).join("\n");
}

export function createTrackerClient(config: Config, run: CommandRunner) {
  return new TrackerClient(config.tracker.team, run, {
    TRACKER_URL: config.tracker.url,
    TRACKER_ACTOR_MODEL: config.agents.codex.model,
  });
}
