import { afterEach, expect, test, vi } from "vitest";
import { forumCommand } from "#commands/forum.ts";
import { parseForumArgs } from "#commands/forum-options.ts";
import { trackerClient } from "#lib/tracker/client.ts";
import { coordinationSummary, formatCoordination } from "#lib/forum.ts";
import { requiredCredentialsFor } from "#lib/credential-commands.ts";

const id = "00000000-0000-4000-8000-000000000001";
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
});
function fixture(failure = false) {
  const requests: { procedure: string; input: unknown }[] = [];
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
      requests.push({ procedure, input });
      if (failure)
        return Response.json(
          {
            error: {
              message: "private response should not appear",
              code: -32_603,
              data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
            },
          },
          { status: 500 },
        );
      const post = {
        id,
        title: "Repairing main",
        scopes: ["main"],
        exitCondition: "Main passes",
        expiresAt: null,
        creator: { key: "codex:owner" },
      };
      return Response.json({
        result: {
          data:
            procedure === "forum.list" || procedure === "forum.search"
              ? {
                  items: [post],
                  total: 9,
                  nextCursor: null,
                  checkedAt: "2026-11-14T00:00:00Z",
                }
              : post,
        },
      });
    },
  });
  servers.push(server);
  const url = server.url.toString();
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
    url,
    context: { url, actor, client: trackerClient(url) },
  };
}
test("forum reads preserve scopes, history search and pagination without observing an actor", async () => {
  const { context, requests, actor } = fixture();
  await forumCommand(
    context,
    "list",
    [],
    parseForumArgs([
      "--scope",
      "main",
      "--scope",
      "ci",
      "--kind",
      "notice",
      "--limit",
      "5",
    ]).values,
  );
  await forumCommand(
    context,
    "search",
    ["migration"],
    parseForumArgs([]).values,
  );
  expect(requests).toMatchObject([
    {
      procedure: "forum.list",
      input: {
        scopes: ["main", "ci"],
        kind: "notice",
        state: "active",
        limit: 5,
      },
    },
    { procedure: "forum.search", input: { query: "migration", state: "all" } },
  ]);
  expect(actor).not.toHaveBeenCalled();
  expect(requiredCredentialsFor("forum", "post", {})).toEqual([]);
});
test("forum writes retain native actor, revision, plain text condition and clearing options", async () => {
  const { context, requests } = fixture();
  await forumCommand(
    context,
    "post",
    [],
    parseForumArgs([
      "--kind",
      "notice",
      "--title",
      "Repairing main",
      "--body",
      "Investigating own change",
      "--condition",
      "Main passes",
      "--scope",
      "main",
    ]).values,
  );
  await forumCommand(
    context,
    "update",
    [id],
    parseForumArgs([
      "--expected-revision",
      "2",
      "--clear-scopes",
      "--expires-at",
      "none",
    ]).values,
  );
  await forumCommand(
    context,
    "reply",
    [id],
    parseForumArgs(["--body", "The PR merged"]).values,
  );
  await forumCommand(
    context,
    "resolve",
    [id],
    parseForumArgs([
      "--expected-revision",
      "3",
      "--note",
      "Verified main's CI passed",
    ]).values,
  );
  await forumCommand(
    context,
    "reopen",
    [id],
    parseForumArgs(["--expected-revision", "4"]).values,
  );
  expect(requests).toMatchObject([
    {
      procedure: "forum.create",
      input: {
        actor: { key: "codex:session" },
        kind: "notice",
        exitCondition: "Main passes",
        scopes: ["main"],
      },
    },
    {
      procedure: "forum.update",
      input: { expectedRevision: 2, scopes: [], expiresAt: null },
    },
    { procedure: "forum.reply", input: { body: "The PR merged" } },
    {
      procedure: "forum.resolve",
      input: { expectedRevision: 3, note: "Verified main's CI passed" },
    },
    { procedure: "forum.reopen", input: { expectedRevision: 4 } },
  ]);
});
test("forum rejects malformed commands before any request", async () => {
  const { context, requests } = fixture();
  for (const [action, args, flags] of [
    [
      "post",
      [],
      ["--kind", "notice", "--title", "Missing condition", "--body", "text"],
    ],
    ["update", [id], ["--title", "Missing revision"]],
    ["update", [id], ["--expected-revision", "1", "--expires-at", "tomorrow"]],
    [
      "update",
      [id],
      ["--expected-revision", "1", "--scope", "ci", "--clear-scopes"],
    ],
    ["resolve", [id], ["--expected-revision", "1"]],
  ] as const) {
    await expect(
      forumCommand(
        context,
        action,
        [...args],
        parseForumArgs([...flags]).values,
      ),
    ).rejects.toThrow();
  }
  expect(requests).toEqual([]);
});
test("coordination summaries are bounded, retain totals and show attribution and exit conditions", async () => {
  const { url, requests } = fixture();
  const report = await coordinationSummary(["main", "ci"], url);
  expect(report).toMatchObject({
    available: true,
    total: 9,
    checkedAt: "2026-11-14T00:00:00Z",
    items: [{ title: "Repairing main", creator: { key: "codex:owner" } }],
  });
  expect(requests[0]).toMatchObject({
    procedure: "forum.list",
    input: {
      kind: "notice",
      state: "active",
      scopes: ["main", "ci"],
      limit: 5,
    },
  });
  expect(formatCoordination(report)).toContain("1 of 9");
  expect(formatCoordination(report)).toContain("Main passes");
});
test("coordination outages are explicit and do not leak upstream payloads or alter exit state", async () => {
  const { url } = fixture(true);
  const exitCode = process.exitCode;
  const report = await coordinationSummary(undefined, url);
  expect(report).toMatchObject({ available: false, total: null, items: [] });
  expect(formatCoordination(report)).toContain("unavailable");
  expect(JSON.stringify(report)).not.toContain("private response");
  expect(process.exitCode).toBe(exitCode);
});

test("a stalled Tracker request times out without blocking the primary command indefinitely", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Promise<Response>(() => {
        /* Deliberately never responds. */
      }),
  });
  servers.push(server);
  const report = await coordinationSummary(undefined, server.url.toString());
  expect(report).toMatchObject({ available: false, items: [], total: null });
}, 10_000);
