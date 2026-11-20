import type { TrackerIssue } from "#src/domain/schemas.ts";
import type { CommandResult, CommandRunner } from "#src/runtime/process.ts";
function respond(stdout: string): Promise<CommandResult> {
  return Promise.resolve({ exitCode: 0, stdout, stderr: "", timedOut: false });
}
export function recordedLabelMutations(calls: string[][]) {
  return calls
    .filter(
      (args) =>
        args[2] === "issue" &&
        args[3] === "update" &&
        (args.includes("--add-label") || args.includes("--remove-label")),
    )
    .map((args) => ({
      id: args[4],
      add: args.flatMap((arg, index) =>
        arg === "--add-label" ? [args[index + 1]] : [],
      ),
      remove: args.flatMap((arg, index) =>
        arg === "--remove-label" ? [args[index + 1]] : [],
      ),
    }));
}
export function defaultTeams(): Record<string, { id: string; name: string }[]> {
  return {
    SJ: [
      { id: "sj-codex-id", name: "agent:codex" },
      { id: "sj-needs-human-id", name: "agent:needs-human" },
      { id: "sj-ready-id", name: "agent:ready" },
    ],
    AI: [
      { id: "ai-codex-id", name: "agent:codex" },
      { id: "ai-autonomous-id", name: "agent:autonomous" },
      { id: "ai-ready-id", name: "agent:ready" },
    ],
  };
}
export function defaultStates(): Record<
  string,
  { name: string; type: string; position: number }[]
> {
  return {
    SJ: [
      { name: "In Progress", type: "started", position: 2 },
      { name: "Done", type: "completed", position: 3 },
    ],
    AI: [
      { name: "In Progress", type: "started", position: 2 },
      { name: "Done", type: "completed", position: 3 },
    ],
  };
}
function wire(issue: TrackerIssue) {
  return { ...issue, labels: issue.labels.nodes, comments: [] };
}
function viewResult(args: readonly string[], nodes: TrackerIssue[]) {
  const identifier = args[4];
  if (identifier === undefined) throw new Error("Missing issue identifier");
  const found = nodes.find((candidate) => candidate.identifier === identifier);
  return found === undefined
    ? Promise.resolve({
        exitCode: 1,
        stdout: "",
        stderr: "Issue " + identifier + " not found",
        timedOut: false,
      })
    : respond(JSON.stringify(wire(found)));
}
function startedIssueFixture(
  args: readonly string[],
  identifier: string,
  state: TrackerIssue["state"],
  current: TrackerIssue | undefined,
) {
  const team = identifier.split("-")[0] ?? "";
  const names = new Set(
    current?.labels.nodes.map(({ name }) => name) ?? ["agent:codex"],
  );
  for (let index = 0; index < args.length - 1; index += 1) {
    const name = args[index + 1];
    if (name === undefined) continue;
    if (args[index] === "--add-label") names.add(name);
    if (args[index] === "--remove-label") names.delete(name);
  }
  return respond(
    JSON.stringify({
      id: identifier,
      title: identifier,
      url: `https://tracker.tailnet-1a49.ts.net/issues/${identifier}`,
      createdAt: "2026-01-01T00:00:00Z",
      priority: 0,
      team: { key: team },
      assigneeId: null,
      ...current,
      identifier,
      revision: (current?.revision ?? 1) + 1,
      state,
      labels: [...names].map((name) => ({ name })),
    }),
  );
}
function updateResult(
  args: readonly string[],
  states: ReturnType<typeof defaultStates>,
  mutateSuccess: boolean,
  nodes: TrackerIssue[],
) {
  const identifier = args[4];
  if (identifier === undefined) throw new Error("Missing mutation identifier");
  const team = identifier.split("-")[0] ?? "";
  const stateIndex = args.indexOf("--state");
  let state: TrackerIssue["state"] | undefined;
  if (stateIndex !== -1) {
    const target = args[stateIndex + 1];
    if (target === undefined) throw new Error("Missing state");
    state = states[team]?.find(
      (candidate) => candidate.name === target || candidate.type === target,
    );
    if (state === undefined)
      return Promise.resolve({
        exitCode: 1,
        stdout: "",
        stderr: "Unknown state: " + target,
        timedOut: false,
      });
  }
  if (mutateSuccess && state?.type === "started") {
    const current = nodes.find((entry) => entry.identifier === identifier);
    return startedIssueFixture(args, identifier, state, current);
  }
  return !mutateSuccess &&
    (args.includes("--add-label") || args.includes("--remove-label"))
    ? respond(JSON.stringify({ success: false }))
    : respond(JSON.stringify({ identifier }));
}
function createLabel(
  args: readonly string[],
  teams: ReturnType<typeof defaultTeams>,
) {
  const team = args[args.indexOf("--team") + 1] ?? "AI";
  const name = args[args.indexOf("--name") + 1] ?? "";
  const created = {
    id: team.toLowerCase() + "-" + name.replace(/^agent:/, "") + "-id",
    name,
  };
  teams[team] = [...(teams[team] ?? []), created];
  return respond(JSON.stringify(created));
}
export function fakeTrackerRunner(
  recorded: string[][] = [],
  options: {
    teams?: ReturnType<typeof defaultTeams>;
    states?: ReturnType<typeof defaultStates>;
    mutateSuccess?: boolean;
    refreshNodes?: TrackerIssue[];
  } = {},
): CommandRunner {
  const {
    teams = defaultTeams(),
    states = defaultStates(),
    mutateSuccess = true,
    refreshNodes = [],
  } = options;
  return (args) => {
    recorded.push([...args]);
    if (args[2] === "issue" && args[3] === "list")
      return respond(
        JSON.stringify({
          items: refreshNodes.map((issue) => wire(issue)),
          nextCursor: null,
        }),
      );
    if (args[2] === "issue" && args[3] === "view")
      return viewResult(args, refreshNodes);
    if (args[2] === "issue" && args[3] === "events") return respond("[]");
    if (args[2] === "team")
      return respond(
        JSON.stringify(Object.keys(teams).map((key) => ({ key }))),
      );
    if (args[2] === "project")
      return respond(JSON.stringify({ slug: "developer-experience" }));
    if (args[2] === "label" && args[3] === "create")
      return createLabel(args, teams);
    if (args[2] === "label") {
      const team = args[args.indexOf("--team") + 1] ?? "AI";
      return respond(JSON.stringify(teams[team] ?? []));
    }
    return args[2] === "issue" && args[3] === "update"
      ? updateResult(args, states, mutateSuccess, refreshNodes)
      : respond(JSON.stringify({ id: "fixture-comment" }));
  };
}
