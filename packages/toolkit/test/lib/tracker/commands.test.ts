import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { trackerClient, trackerUrl } from "#lib/tracker/client.ts";
import { issueCommand } from "#commands/tracker/issues.ts";
import { handleTrackerCommand } from "#handlers/tracker.ts";
import {
  localToday,
  parseTrackerArgs,
  textInput,
} from "#commands/tracker/options.ts";
import { viewCommand } from "#commands/tracker/views.ts";
import { catalogCommand } from "#commands/tracker/catalog.ts";
import { requiredCredentialsFor } from "#lib/credential-commands.ts";
import { trackerRequest } from "./request.ts";

test("tracker commands never request Linear or other platform credentials", () => {
  for (const command of ["whoami", "issue", "api", "identity-hook"]) {
    expect(requiredCredentialsFor("tracker", command, {})).toEqual([]);
  }
});

const servers: ReturnType<typeof Bun.serve>[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});
function fixture() {
  const requests: { procedure: string; input: unknown; method: string }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const received = await trackerRequest(request);
      requests.push(received);
      const { procedure } = received;
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
test("urgency, impact, effort and auto-priority flags normalize and validate on mutations", async () => {
  const { context, requests, actor } = fixture();

  await issueCommand(
    context,
    ["create"],
    parseTrackerArgs([
      "--team",
      "AI",
      "--title",
      "Triaged create",
      "--effort",
      "XS",
      "--impact",
      "High",
      "--urgency",
      "medium",
    ]).values,
  );
  expect(requests[0]).toMatchObject({
    procedure: "issues.create",
    method: "POST",
    input: {
      teamKey: "AI",
      title: "Triaged create",
      effort: "xs",
      impact: "high",
      urgency: "medium",
    },
  });
  expect(requests[0]?.input).not.toHaveProperty("priority");
  expect(requests[0]?.input).not.toHaveProperty("priorityManual");

  await issueCommand(
    context,
    ["create"],
    parseTrackerArgs([
      "--team",
      "AI",
      "--title",
      "Manual priority",
      "--priority",
      "2",
      "--effort",
      "NONE",
    ]).values,
  );
  expect(requests[1]?.input).toMatchObject({
    title: "Manual priority",
    priority: 2,
    effort: null,
  });
  expect(requests[1]?.input).not.toHaveProperty("priorityManual");

  await issueCommand(
    context,
    ["create"],
    parseTrackerArgs([
      "--team",
      "AI",
      "--title",
      "Auto priority",
      "--priority",
      "AUTO",
    ]).values,
  );
  expect(requests[2]?.input).toMatchObject({
    title: "Auto priority",
    priorityManual: false,
  });
  expect(requests[2]?.input).not.toHaveProperty("priority");

  await issueCommand(
    context,
    ["update", "AI-42"],
    parseTrackerArgs([
      "--effort",
      "xs",
      "--impact",
      "high",
      "--urgency",
      "medium",
      "--priority",
      "2",
    ]).values,
  );
  expect(requests[3]).toMatchObject({
    procedure: "issues.update",
    input: {
      identifier: "AI-42",
      effort: "xs",
      impact: "high",
      urgency: "medium",
      priority: 2,
    },
  });
  expect(requests[3]?.input).not.toHaveProperty("priorityManual");

  await issueCommand(
    context,
    ["update", "AI-42"],
    parseTrackerArgs([
      "--effort",
      "none",
      "--impact",
      "NONE",
      "--urgency",
      "none",
      "--priority",
      "auto",
    ]).values,
  );
  expect(requests[4]).toMatchObject({
    procedure: "issues.update",
    input: {
      identifier: "AI-42",
      effort: null,
      impact: null,
      urgency: null,
      priorityManual: false,
    },
  });
  expect(requests[4]?.input).not.toHaveProperty("priority");

  await issueCommand(
    context,
    ["bulk-update", "ai-1", "ai-2"],
    parseTrackerArgs([
      "--effort",
      "M",
      "--impact",
      "low",
      "--urgency",
      "HIGH",
      "--priority",
      "auto",
    ]).values,
  );
  expect(requests[5]).toMatchObject({
    procedure: "issues.bulkUpdate",
    input: {
      identifiers: ["AI-1", "AI-2"],
      patch: {
        effort: "m",
        impact: "low",
        urgency: "high",
        priorityManual: false,
      },
    },
  });
  const bulkInput = z
    .object({ patch: z.record(z.string(), z.unknown()) })
    .parse(requests[5]?.input);
  expect(bulkInput.patch).not.toHaveProperty("priority");

  actor.mockClear();
  await expect(
    issueCommand(
      context,
      ["update", "AI-42"],
      parseTrackerArgs([
        "--state",
        "started",
        "--effort",
        "xs",
        "--effort",
        "s",
      ]).values,
    ),
  ).rejects.toThrow("--effort takes one value");
  await expect(
    issueCommand(
      context,
      ["create"],
      parseTrackerArgs([
        "--team",
        "AI",
        "--title",
        "Dup",
        "--impact",
        "high",
        "--impact",
        "low",
      ]).values,
    ),
  ).rejects.toThrow("--impact takes one value");
  await expect(
    issueCommand(
      context,
      ["bulk-update", "AI-42"],
      parseTrackerArgs(["--urgency", "high", "--urgency", "low"]).values,
    ),
  ).rejects.toThrow("--urgency takes one value");
  await expect(
    issueCommand(
      context,
      ["update", "AI-42"],
      parseTrackerArgs(["--effort", "xxl"]).values,
    ),
  ).rejects.toThrow();
  expect(actor).not.toHaveBeenCalled();
  expect(requests).toHaveLength(6);
});
test("urgency, impact, effort filters and sorts reach list, search and help", async () => {
  const { context, requests, actor } = fixture();

  await issueCommand(
    context,
    ["list"],
    parseTrackerArgs([
      "--effort",
      "XS",
      "--effort",
      "s",
      "--urgency",
      "none",
      "--impact",
      "High",
      "--impact",
      "low",
      "--sort",
      "effort",
      "--sort-dir",
      "DESC",
    ]).values,
  );
  expect(requests[0]).toMatchObject({
    procedure: "issues.list",
    method: "GET",
    input: {
      efforts: ["xs", "s"],
      urgencies: ["none"],
      impacts: ["high", "low"],
      sort: "effort",
      dir: "desc",
    },
  });

  await issueCommand(
    context,
    ["search", "grooming"],
    parseTrackerArgs([
      "--effort",
      "l",
      "--urgency",
      "HIGH",
      "--sort",
      "title",
      "--sort-dir",
      "asc",
    ]).values,
  );
  expect(requests[1]).toMatchObject({
    procedure: "issues.list",
    method: "GET",
    input: {
      search: "grooming",
      states: ["triage", "backlog", "unstarted", "started"],
      efforts: ["l"],
      urgencies: ["high"],
      impacts: [],
      sort: "title",
      dir: "asc",
    },
  });
  await expect(
    issueCommand(
      context,
      ["list"],
      parseTrackerArgs(["--priority", "auto"]).values,
    ),
  ).rejects.toThrow();
  expect(actor).not.toHaveBeenCalled();
  expect(requests).toHaveLength(2);

  const lines: string[] = [];
  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  try {
    await handleTrackerCommand("--help", []);
  } finally {
    logSpy.mockRestore();
  }
  const help = lines.join("\n");
  expect(help).toContain("--urgency <high|medium|low|none>");
  expect(help).toContain("--impact <high|medium|low|none>");
  expect(help).toContain("--effort <xs|s|m|l|xl|none>");
  expect(help).toContain("--priority <0..4|auto>");
  expect(help).toContain("due|number|title");
  expect(help).toContain("--sort-dir asc|desc");
});

test("issue create/update alias --body and --body-file and reject ambiguous or bulk-update body flags (AI-878)", async () => {
  const { context, requests, actor } = fixture();
  const dir = await mkdtemp(path.join(tmpdir(), "tracker-body-"));
  tempDirs.push(dir);
  const bodyFile = path.join(dir, "issue.md");
  await Bun.write(bodyFile, "Body loaded from file");

  await issueCommand(
    context,
    ["create"],
    parseTrackerArgs([
      "--team",
      "AI",
      "--title",
      "Inline body",
      "--body",
      "Inline markdown description",
    ]).values,
  );
  await issueCommand(
    context,
    ["create"],
    parseTrackerArgs([
      "--team",
      "AI",
      "--title",
      "File body",
      "--body-file",
      bodyFile,
    ]).values,
  );
  await issueCommand(
    context,
    ["update", "AI-42"],
    parseTrackerArgs(["--body", "Updated inline"]).values,
  );
  await issueCommand(
    context,
    ["update", "AI-42"],
    parseTrackerArgs(["--body-file", bodyFile]).values,
  );

  expect(requests).toMatchObject([
    {
      procedure: "issues.create",
      input: {
        title: "Inline body",
        description: "Inline markdown description",
      },
    },
    {
      procedure: "issues.create",
      input: { title: "File body", description: "Body loaded from file" },
    },
    {
      procedure: "issues.update",
      input: { identifier: "AI-42", description: "Updated inline" },
    },
    {
      procedure: "issues.update",
      input: { identifier: "AI-42", description: "Body loaded from file" },
    },
  ]);

  actor.mockClear();
  for (const dualFlags of [
    ["--description", "A", "--body", "B"],
    ["--description-file", bodyFile, "--body", "B"],
    ["--description", "A", "--body-file", bodyFile],
    ["--body", "A", "--body-file", bodyFile],
  ]) {
    await expect(
      issueCommand(
        context,
        ["create"],
        parseTrackerArgs(["--team", "AI", "--title", "Ambiguous", ...dualFlags])
          .values,
      ),
    ).rejects.toThrow("not both");
    await expect(
      issueCommand(
        context,
        ["update", "AI-42"],
        parseTrackerArgs(dualFlags).values,
      ),
    ).rejects.toThrow("not both");
  }
  await expect(
    issueCommand(
      context,
      ["bulk-update", "AI-42"],
      parseTrackerArgs(["--body", "No per-issue body"]).values,
    ),
  ).rejects.toThrow("bulk-update does not take --body");
  await expect(
    issueCommand(
      context,
      ["bulk-update", "AI-42"],
      parseTrackerArgs(["--body-file", bodyFile]).values,
    ),
  ).rejects.toThrow("bulk-update does not take --body-file");
  expect(actor).not.toHaveBeenCalled();
});

test("tRPC client surfaces HTTP status, content-type, sanitized snippet, and mutation read-back warning on non-JSON or non-tRPC responses (AI-630)", async () => {
  let responseMode:
    "html-502" | "empty-503" | "proxy-json-502" | "truncated-json-502" =
    "html-502";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      if (responseMode === "html-502") {
        const longPadding = "upstream gateway timeout ".repeat(10);
        return new Response(
          `<!doctype html><html><head><style>body{color:red}</style></head><body><h1>502 Bad Gateway</h1><p>Authorization: Bearer secret-jwt-value token=raw-token-123 op://homelab/item/secret ${longPadding}</p></body></html>`,
          {
            status: 502,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }
      if (responseMode === "empty-503") {
        return new Response("   ", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        });
      }
      if (responseMode === "truncated-json-502") {
        return new Response('{"access_token":"truncated-secret-token', {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      return Response.json(
        {
          message: "Bad Gateway",
          token: "quoted-json-secret",
          nested: { api_key: "nested-json-api-key" },
          detail: "Bearer inline-json-bearer",
        },
        { status: 502 },
      );
    },
  });
  servers.push(server);
  const client = trackerClient(server.url.toString());
  const actor = {
    key: "codex:session",
    kind: "agent" as const,
    name: "Codex",
    metadata: {},
  };

  let mutationError: unknown;
  try {
    await client.comments.create.mutate({
      actor,
      identifier: "AI-622",
      body: "Progress note",
    });
  } catch (error) {
    mutationError = error;
  }
  expect(mutationError).toBeInstanceOf(Error);
  const mutationMessage =
    mutationError instanceof Error ? mutationError.message : "";
  expect(mutationMessage).toContain("HTTP 502");
  expect(mutationMessage).toContain("content-type: text/html; charset=utf-8");
  expect(mutationMessage).toContain("body=html");
  expect(mutationMessage).toContain("502 Bad Gateway");
  expect(mutationMessage).toContain(
    "Mutation completion is uncertain; verify state via read-back before retrying.",
  );
  expect(mutationMessage).not.toContain("secret-jwt-value");
  expect(mutationMessage).not.toContain("raw-token-123");
  expect(mutationMessage).not.toContain("op://homelab/item/secret");
  expect(mutationMessage).toContain("[REDACTED]");

  responseMode = "empty-503";
  let queryError: unknown;
  try {
    await client.issues.byIdentifier.query({ identifier: "AI-622" });
  } catch (error) {
    queryError = error;
  }
  const queryMessage = queryError instanceof Error ? queryError.message : "";
  expect(queryMessage).toContain("HTTP 503");
  expect(queryMessage).toContain("content-type: text/plain");
  expect(queryMessage).toContain("body=empty");
  expect(queryMessage).not.toContain("Mutation completion is uncertain");

  responseMode = "proxy-json-502";
  let jsonError: unknown;
  try {
    await client.comments.create.mutate({
      actor,
      identifier: "AI-622",
      body: "Progress note",
    });
  } catch (error) {
    jsonError = error;
  }
  const jsonMessage = jsonError instanceof Error ? jsonError.message : "";
  expect(jsonMessage).toMatch(
    /not a valid tRPC envelope.*HTTP 502.*body=non-trpc-json.*Mutation completion is uncertain/u,
  );
  expect(jsonMessage).not.toContain("quoted-json-secret");
  expect(jsonMessage).not.toContain("nested-json-api-key");
  expect(jsonMessage).not.toContain("inline-json-bearer");
  expect(jsonMessage).toContain("[REDACTED]");

  responseMode = "truncated-json-502";
  let truncatedError: unknown;
  try {
    await client.issues.byIdentifier.query({ identifier: "AI-622" });
  } catch (error) {
    truncatedError = error;
  }
  const truncatedMessage =
    truncatedError instanceof Error ? truncatedError.message : "";
  expect(truncatedMessage).toContain("not valid JSON");
  expect(truncatedMessage).not.toContain("truncated-secret-token");
  expect(truncatedMessage).toContain("[REDACTED]");
});
