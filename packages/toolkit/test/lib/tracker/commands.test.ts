import { afterEach, expect, test, vi } from "vitest";
import { trackerClient, trackerUrl } from "#lib/tracker/client.ts";
import { issueCommand } from "#commands/tracker/issues.ts";
import { parseTrackerArgs, textInput } from "#commands/tracker/options.ts";
import { catalogCommand } from "#commands/tracker/catalog.ts";
import { requiredCredentialsFor } from "#lib/credentials.ts";

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
