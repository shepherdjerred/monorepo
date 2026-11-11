import { afterEach, expect, test, vi } from "vitest";
import { trackerClient, trackerUrl } from "#lib/tracker/client.ts";
import { issueCommand } from "#commands/tracker/issues.ts";
import {
  localToday,
  parseTrackerArgs,
  textInput,
} from "#commands/tracker/options.ts";
import { viewCommand } from "#commands/tracker/views.ts";
import { catalogCommand } from "#commands/tracker/catalog.ts";
import { requiredCredentialsFor } from "#lib/credential-commands.ts";

test("tracker commands never request Linear or other platform credentials", () => {
  for (const command of ["whoami", "issue", "api", "identity-hook"]) {
    expect(requiredCredentialsFor("tracker", command, {})).toEqual([]);
  }
});

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
});
function fixture() {
  const requests: { procedure: string; input: unknown; method: string }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const procedure = url.pathname.slice("/trpc/".length);
      const input: unknown =
        request.method === "GET"
          ? JSON.parse(url.searchParams.get("input") ?? "{}")
          : await request.json();
      requests.push({ procedure, input, method: request.method });
      const data =
        procedure === "states.list"
          ? [{ name: "In progress", type: "started" }]
          : procedure === "issues.list"
            ? {
                items: [{ identifier: "AI-42", revision: 3 }],
                nextCursor: null,
              }
            : { identifier: "AI-42", revision: 3 };
      return Response.json({ result: { data } });
    },
  });
  servers.push(server);
  const actor = vi.fn(() =>
    Promise.resolve({
      key: "codex:session",
      kind: "agent" as const,
      name: "Codex",
      metadata: {},
    }),
  );
  return {
    requests,
    actor,
    context: {
      actor,
      url: server.url.toString().replace(/\/$/u, ""),
      client: trackerClient(server.url.toString()),
    },
  };
}
test("read filters preserve repeated values, pagination and archived search without observing an actor", async () => {
  const { context, requests, actor } = fixture();
  const { values } = parseTrackerArgs([
    "--team",
    "AI",
    "--state",
    "started",
    "--state",
    "backlog",
    "--label",
    "bug",
    "--label",
    "agent:codex",
    "--limit",
    "all",
    "--include-archived",
  ]);
  const result = await issueCommand(context, ["list"], values);
  expect(result).toMatchObject({
    items: [{ identifier: "AI-42", url: context.url + "/issues/AI-42" }],
  });
  expect(requests[0]).toMatchObject({
    procedure: "issues.list",
    method: "GET",
    input: {
      teamKey: "AI",
      states: ["started", "backlog"],
      labels: ["bug", "agent:codex"],
      limit: "all",
      includeArchived: true,
    },
  });
  expect(actor).not.toHaveBeenCalled();
});
test("updates resolve state types and preserve explicit zero, revision and label patches", async () => {
  const { context, requests, actor } = fixture();
  const { values } = parseTrackerArgs([
    "--state",
    "started",
    "--priority",
    "0",
    "--expected-revision",
    "3",
    "--add-label",
    "one",
    "--remove-label",
    "two",
    "--project",
    "none",
  ]);
  await issueCommand(context, ["update", "ai-42"], values);
  expect(requests[1]).toMatchObject({
    procedure: "issues.update",
    method: "POST",
    input: {
      actor: { key: "codex:session" },
      identifier: "AI-42",
      stateName: "In progress",
      priority: 0,
      expectedRevision: 3,
      addLabels: ["one"],
      removeLabels: ["two"],
      projectSlug: null,
    },
  });
  expect(actor).toHaveBeenCalledTimes(1);
});
test("bulk updates pass the shared patch flags and reject per-issue fields", async () => {
  const { context, requests } = fixture();
  await issueCommand(
    context,
    ["bulk-update", "ai-1", "sj-2"],
    parseTrackerArgs([
      "--state",
      "started",
      "--priority",
      "0",
      "--assignee",
      "none",
      "--add-label",
      "one",
      "--parent",
      "none",
      "--due",
      "2026-12-01",
      "--archive",
    ]).values,
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    procedure: "issues.bulkUpdate",
    method: "POST",
    input: {
      actor: { key: "codex:session" },
      identifiers: ["AI-1", "SJ-2"],
      expectedRevisions: {},
      patch: {
        stateType: "started",
        priority: 0,
        assigneeKey: null,
        addLabels: ["one"],
        removeLabels: [],
        parentIdentifier: null,
        dueDate: "2026-12-01",
        archived: true,
      },
    },
  });
  await issueCommand(
    context,
    ["bulk-update", "AI-1"],
    parseTrackerArgs(["--state", "Code review"]).values,
  );
  expect(requests[1]?.input).toMatchObject({
    patch: { stateName: "Code review" },
  });
  for (const flags of [["--title", "Same"], ["--expected-revision", "3"], []])
    await expect(
      issueCommand(
        context,
        ["bulk-update", "AI-1"],
        parseTrackerArgs(flags).values,
      ),
    ).rejects.toThrow();
  await expect(
    issueCommand(
      context,
      ["bulk-update"],
      parseTrackerArgs(["--priority", "1"]).values,
    ),
  ).rejects.toThrow();
  expect(requests).toHaveLength(2);
});
test("catalog reads and malformed options fail before writes", async () => {
  const { context, actor } = fixture();
  const { values } = parseTrackerArgs([]);
  await catalogCommand(context, "team", ["list"], values);
  expect(actor).not.toHaveBeenCalled();
  await expect(issueCommand(context, ["create"], values)).rejects.toThrow(
    "--team",
  );
  expect(() => parseTrackerArgs(["--unexpected"])).toThrow();
  await expect(textInput("inline", "/file")).rejects.toThrow("not both");
  expect(() => trackerUrl("https://token@example.test")).toThrow(
    "without credentials",
  );
});
test("sub-issue and due-date flags reach create, update and list unchanged", async () => {
  const { context, requests } = fixture();
  await issueCommand(
    context,
    ["create"],
    parseTrackerArgs([
      "--team",
      "AI",
      "--title",
      "Child",
      "--parent",
      "ai-7",
      "--due",
      "2026-12-01",
    ]).values,
  );
  expect(requests[0]).toMatchObject({
    procedure: "issues.create",
    input: { parentIdentifier: "AI-7", dueDate: "2026-12-01" },
  });
  await issueCommand(
    context,
    ["update", "AI-42"],
    parseTrackerArgs(["--parent", "none", "--due", "none"]).values,
  );
  expect(requests[1]).toMatchObject({
    procedure: "issues.update",
    input: { identifier: "AI-42", parentIdentifier: null, dueDate: null },
  });
  await issueCommand(
    context,
    ["update", "AI-42"],
    parseTrackerArgs(["--title", "Only the title"]).values,
  );
  const untouched = requests[2]?.input;
  expect(untouched).not.toHaveProperty("parentIdentifier");
  expect(untouched).not.toHaveProperty("dueDate");
  await issueCommand(
    context,
    ["list"],
    parseTrackerArgs([
      "--parent",
      "ai-7",
      "--due-before",
      "2026-12-31",
      "--due-after",
      "2026-01-01",
      "--overdue",
      "--today",
      "2026-06-15",
      "--sort",
      "due",
    ]).values,
  );
  expect(requests[3]).toMatchObject({
    procedure: "issues.list",
    input: {
      parentIdentifier: "AI-7",
      dueBefore: "2026-12-31",
      dueAfter: "2026-01-01",
      overdue: true,
      today: "2026-06-15",
      sort: "due",
    },
  });
  await issueCommand(context, ["list"], parseTrackerArgs(["--overdue"]).values);
  expect(requests[4]?.input).toMatchObject({
    overdue: true,
    today: localToday(),
  });
  await issueCommand(context, ["list"], parseTrackerArgs([]).values);
  expect(requests[5]?.input).not.toHaveProperty("overdue");
  expect(requests[5]?.input).not.toHaveProperty("today");
  expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  await expect(
    issueCommand(
      context,
      ["update", "AI-42"],
      parseTrackerArgs(["--due", "2026-02-30"]).values,
    ),
  ).rejects.toThrow();
  await expect(
    issueCommand(
      context,
      ["list"],
      parseTrackerArgs(["--due-before", "tomorrow"]).values,
    ),
  ).rejects.toThrow();
  expect(requests).toHaveLength(6);
});
test("view commands list without an actor and validate before writing", async () => {
  const { context, requests, actor } = fixture();
  await viewCommand(
    context,
    ["list"],
    parseTrackerArgs(["--team", "AI"]).values,
  );
  expect(requests[0]).toMatchObject({
    procedure: "views.list",
    method: "GET",
    input: { teamKey: "AI" },
  });
  expect(actor).not.toHaveBeenCalled();
  await viewCommand(
    context,
    ["create"],
    parseTrackerArgs([
      "--name",
      "My work",
      "--icon",
      "inbox",
      "--input-json",
      '{"states":["started"],"sort":"due"}',
    ]).values,
  );
  expect(requests[1]).toMatchObject({
    procedure: "views.create",
    method: "POST",
    input: {
      actor: { key: "codex:session" },
      name: "My work",
      icon: "inbox",
      params: { states: ["started"], sort: "due" },
      teamKey: null,
    },
  });
  await viewCommand(context, ["delete", "view-1"], parseTrackerArgs([]).values);
  expect(requests[2]).toMatchObject({
    procedure: "views.delete",
    input: { actor: { key: "codex:session" }, id: "view-1" },
  });
  const invalid = parseTrackerArgs([
    "--name",
    "Bad",
    "--icon",
    "x",
    "--input-json",
    '{"cursor":"abc"}',
  ]).values;
  await expect(viewCommand(context, ["create"], invalid)).rejects.toThrow();
  await expect(
    viewCommand(context, ["create"], parseTrackerArgs([]).values),
  ).rejects.toThrow("--name");
  await expect(
    viewCommand(context, ["delete"], parseTrackerArgs([]).values),
  ).rejects.toThrow("View ID");
  await expect(
    viewCommand(context, ["rename"], parseTrackerArgs([]).values),
  ).rejects.toThrow("Unknown view action");
  expect(requests).toHaveLength(3);
});
