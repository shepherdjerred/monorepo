import { mkdtemp, rm } from "node:fs/promises";
import nodePath from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { afterEach, expect, test, vi } from "vitest";
import { forumCommand } from "#commands/forum.ts";
import { parseForumArgs } from "#commands/forum-options.ts";
import { watchForum } from "#commands/forum-watch.ts";
import { trackerClient } from "#lib/tracker/client.ts";
import { trackerRequest } from "#test/lib/tracker/request.ts";

const postUuid = "00000000-0000-4000-8000-000000000012";
const otherUuid = "00000000-0000-4000-8000-000000000099";
const replyUuid = "00000000-0000-4000-8000-000000000034";
const attachmentUuid = "00000000-0000-4000-8000-000000000056";

const servers: ReturnType<typeof Bun.serve>[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
  for (const dir of tempDirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

function createForumFixture() {
  const requests: { procedure: string; input: unknown; method: string }[] = [];
  const uploads: { actorHeader: unknown; multipartBody: string }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/attachments" && request.method === "POST") {
        const header = request.headers.get("x-tracker-actor") ?? "";
        const actorHeader: unknown = JSON.parse(
          Buffer.from(header, "base64").toString("utf8"),
        );
        const multipartBody = await request.text();
        uploads.push({ actorHeader, multipartBody });
        return Response.json(
          {
            id: attachmentUuid,
            filename: "log.txt",
            url: `/attachments/${attachmentUuid}/log.txt`,
          },
          { status: 201 },
        );
      }
      const received = await trackerRequest(request);
      requests.push(received);
      return Response.json({
        result: {
          data: {
            id: postUuid,
            identifier: "FM-12",
            kind: "notice",
            state: "open",
            title: "Repairing main",
            scopes: ["main"],
            creator: { id: "actor-1", key: "codex:session" },
            resolver: null,
            resolvedAt: null,
            lastActivityAt: "2026-11-15T00:00:00.000Z",
          },
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
    uploads,
    actor,
    url,
    context: { url, actor, client: trackerClient(url) },
  };
}

test("post supports question, decision and notice kinds with --owner me, --issue, --pinned and --attach uploads", async () => {
  const { context, requests, uploads } = createForumFixture();
  const dir = await mkdtemp(nodePath.join(tmpdir(), "forum-attach-"));
  tempDirs.push(dir);
  const filePath = nodePath.join(dir, "log.txt");
  await Bun.write(filePath, "failing build output");

  await forumCommand(
    context,
    "post",
    [],
    parseForumArgs([
      "--kind",
      "question",
      "--title",
      "Which cache bucket owns artifacts?",
      "--body",
      "Investigating s3 bucket config",
      "--project",
      "developer-experience",
    ]).values,
  );
  await forumCommand(
    context,
    "post",
    [],
    parseForumArgs([
      "--kind",
      "decision",
      "--title",
      "Keep FM-<N> short identifiers permanent",
      "--body",
      "Sequence allocated in Postgres",
      "--pinned",
    ]).values,
  );
  await forumCommand(
    context,
    "post",
    [],
    parseForumArgs([
      "--kind",
      "notice",
      "--title",
      "Holding cluster deploy",
      "--body",
      "Upgrading CNI",
      "--condition",
      "All nodes Ready",
      "--owner",
      "me",
      "--issue",
      "ai-10",
      "--issue",
      "sj-4",
      "--attach",
      filePath,
    ]).values,
  );

  expect(uploads).toHaveLength(1);
  expect(uploads[0]?.actorHeader).toEqual({
    key: "codex:session",
    kind: "agent",
    name: "Codex",
    metadata: {},
  });
  expect(uploads[0]?.multipartBody).toContain('filename="log.txt"');
  expect(uploads[0]?.multipartBody).toContain("failing build output");
  expect(requests).toMatchObject([
    {
      procedure: "forum.create",
      input: {
        kind: "question",
        title: "Which cache bucket owns artifacts?",
        projectSlug: "developer-experience",
        attachmentIds: [],
      },
    },
    {
      procedure: "forum.create",
      input: {
        kind: "decision",
        pinned: true,
        attachmentIds: [],
      },
    },
    {
      procedure: "forum.create",
      input: {
        kind: "notice",
        ownerKey: "codex:session",
        linkedIssueIdentifiers: ["AI-10", "SJ-4"],
        attachmentIds: [attachmentUuid],
      },
    },
  ]);
});

test("list, search, inbox, scopes and view accept FM-<N> case-insensitively and handle optional viewer identity", async () => {
  const { context, requests } = createForumFixture();
  await forumCommand(
    context,
    "list",
    [],
    parseForumArgs([
      "--state",
      "unanswered",
      "--sort",
      "votes",
      "--owner",
      "none",
      "--creator",
      "me",
      "--project",
      "none",
      "--issue",
      "ai-99",
      "--unread",
      "--subscribed",
    ]).values,
  );
  await forumCommand(
    context,
    "inbox",
    [],
    parseForumArgs(["--limit", "20"]).values,
  );
  await forumCommand(context, "scopes", [], parseForumArgs([]).values);
  await forumCommand(context, "view", ["fm-12"], parseForumArgs([]).values);

  const anonymousContext = {
    ...context,
    actor: () => Promise.reject(new Error("No session identity")),
  };
  await forumCommand(
    anonymousContext,
    "show",
    ["FM-12"],
    parseForumArgs([]).values,
  );

  expect(requests).toMatchObject([
    {
      procedure: "forum.list",
      input: {
        state: "unanswered",
        sort: "votes",
        ownerKey: null,
        creatorKey: "codex:session",
        projectSlug: null,
        linkedIssueIdentifier: "AI-99",
        unreadOnly: true,
        subscribedOnly: true,
        viewerActorKey: "codex:session",
      },
    },
    {
      procedure: "forum.inbox",
      input: {
        viewerActorKey: "codex:session",
        unreadOnly: true,
        limit: 20,
      },
    },
    { procedure: "forum.scopes" },
    {
      procedure: "forum.byId",
      input: { id: "FM-12", viewerActorKey: "codex:session" },
    },
    {
      procedure: "forum.byId",
      input: { id: "FM-12" },
    },
  ]);
  expect(requests[4]?.input).not.toHaveProperty("viewerActorKey");
});

test("collaborative mutations route FM-<N> and reply targets across claim, handoff, Q&A, pins, votes, reactions, subscriptions and issue promotion", async () => {
  const { context, requests } = createForumFixture();

  await forumCommand(
    context,
    "claim",
    ["fm-12"],
    parseForumArgs(["--note", "Taking over recovery"]).values,
  );
  await forumCommand(
    context,
    "handoff",
    ["FM-12"],
    parseForumArgs(["--to", "none", "--note", "Stepping away"]).values,
  );
  await forumCommand(
    context,
    "accept",
    ["fm-12", replyUuid],
    parseForumArgs([]).values,
  );
  await forumCommand(context, "unaccept", ["FM-12"], parseForumArgs([]).values);
  await forumCommand(context, "pin", ["fm-12"], parseForumArgs([]).values);
  await forumCommand(context, "unpin", ["fm-12"], parseForumArgs([]).values);
  await forumCommand(
    context,
    "vote",
    ["fm-12"],
    parseForumArgs(["--note", "Same symptom"]).values,
  );
  await forumCommand(
    context,
    "unvote",
    [],
    parseForumArgs(["--reply", replyUuid]).values,
  );
  await forumCommand(
    context,
    "react",
    ["fm-12"],
    parseForumArgs(["--emoji", "🚀"]).values,
  );
  await forumCommand(
    context,
    "unreact",
    [],
    parseForumArgs(["--reply", replyUuid, "--emoji", "🚀"]).values,
  );
  await forumCommand(
    context,
    "subscribe",
    ["fm-12"],
    parseForumArgs(["--mute"]).values,
  );
  await forumCommand(
    context,
    "unsubscribe",
    ["fm-12"],
    parseForumArgs([]).values,
  );
  await forumCommand(
    context,
    "read",
    ["fm-12"],
    parseForumArgs(["--unread"]).values,
  );
  await forumCommand(
    context,
    "link",
    ["fm-12", "ai-77"],
    parseForumArgs(["--reply", replyUuid]).values,
  );
  await forumCommand(
    context,
    "unlink",
    ["fm-12", "ai-77"],
    parseForumArgs([]).values,
  );
  await forumCommand(
    context,
    "promote",
    ["fm-12"],
    parseForumArgs([
      "--reply",
      replyUuid,
      "--priority",
      "2",
      "--title",
      "Automate recovery check",
    ]).values,
  );
  await forumCommand(
    context,
    "reply",
    ["fm-12"],
    parseForumArgs(["--body", "Nested child", "--parent-reply", replyUuid])
      .values,
  );
  await forumCommand(
    context,
    "edit-reply",
    [replyUuid],
    parseForumArgs(["--body", "Updated reply text"]).values,
  );
  await forumCommand(
    context,
    "delete-reply",
    [replyUuid],
    parseForumArgs([]).values,
  );

  expect(requests).toMatchObject([
    {
      procedure: "forum.claim",
      input: { id: "FM-12", note: "Taking over recovery" },
    },
    {
      procedure: "forum.handoff",
      input: { id: "FM-12", toActorKey: null, note: "Stepping away" },
    },
    {
      procedure: "forum.acceptReply",
      input: { id: "FM-12", replyId: replyUuid },
    },
    {
      procedure: "forum.acceptReply",
      input: { id: "FM-12", replyId: null },
    },
    { procedure: "forum.pin", input: { id: "FM-12", pinned: true } },
    { procedure: "forum.pin", input: { id: "FM-12", pinned: false } },
    {
      procedure: "forum.vote",
      input: { id: "FM-12", note: "Same symptom", remove: false },
    },
    {
      procedure: "forum.vote",
      input: { replyId: replyUuid, remove: true },
    },
    {
      procedure: "forum.react",
      input: { id: "FM-12", emoji: "🚀", remove: false },
    },
    {
      procedure: "forum.react",
      input: { replyId: replyUuid, emoji: "🚀", remove: true },
    },
    {
      procedure: "forum.subscribe",
      input: { id: "FM-12", mode: "muted" },
    },
    {
      procedure: "forum.subscribe",
      input: { id: "FM-12", mode: null },
    },
    {
      procedure: "forum.markRead",
      input: { id: "FM-12", readAt: null },
    },
    {
      procedure: "forum.linkIssue",
      input: {
        id: "FM-12",
        issueIdentifier: "AI-77",
        sourceReplyId: replyUuid,
      },
    },
    {
      procedure: "forum.unlinkIssue",
      input: { id: "FM-12", issueIdentifier: "AI-77" },
    },
    {
      procedure: "forum.promoteToIssue",
      input: {
        id: "FM-12",
        replyId: replyUuid,
        teamKey: "AI",
        priority: 2,
        title: "Automate recovery check",
      },
    },
    {
      procedure: "forum.reply",
      input: {
        id: "FM-12",
        body: "Nested child",
        parentReplyId: replyUuid,
      },
    },
    {
      procedure: "forum.updateReply",
      input: { replyId: replyUuid, body: "Updated reply text" },
    },
    {
      procedure: "forum.deleteReply",
      input: { replyId: replyUuid },
    },
  ]);
});

const ByIdInputSchema = z.object({ id: z.string() });

function buildWatchedPostData(requestedId: string, state: "open" | "resolved") {
  const isOther = requestedId === otherUuid;
  return {
    id: isOther ? otherUuid : postUuid,
    identifier: isOther ? "FM-99" : "FM-12",
    kind: isOther ? "discussion" : "notice",
    state,
    title: isOther ? "Unrelated chat" : "Main CI recovery",
    scopes: isOther ? ["docs"] : ["main"],
    creator: { id: "actor-1", key: "codex:owner" },
    resolver:
      state === "resolved" ? { id: "actor-2", key: "codex:resolver" } : null,
    resolvedAt: state === "resolved" ? "2026-11-15T01:05:00.000Z" : null,
    lastActivityAt: "2026-11-15T01:00:00.000Z",
  };
}

function createSseStreamResponse(
  onConnect?: (send: (chunk: string) => void) => void,
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* Stream already closed by client abort. */
        }
      };
      send('event: resync\ndata: {"type":"resync"}\nretry: 3000\n\n');
      onConnect?.(send);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function createSseFixture(options: {
  initialState?: "open" | "resolved";
  onStreamConnect?: (send: (chunk: string) => void) => void;
}) {
  let currentState = options.initialState ?? "open";
  const byIdQueries: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/events/stream") {
        return createSseStreamResponse(options.onStreamConnect);
      }
      const received = await trackerRequest(request);
      if (received.procedure !== "forum.byId") {
        return Response.json({ error: "unexpected" }, { status: 404 });
      }
      const input = ByIdInputSchema.parse(received.input);
      byIdQueries.push(input.id);
      return Response.json({
        result: { data: buildWatchedPostData(input.id, currentState) },
      });
    },
  });
  servers.push(server);
  const url = server.url.toString();
  return {
    byIdQueries,
    setPostState: (next: "open" | "resolved") => {
      currentState = next;
    },
    context: {
      url,
      client: trackerClient(url),
      actor: () =>
        Promise.resolve({
          key: "codex:session",
          kind: "agent" as const,
          name: "Codex",
          metadata: {},
        }),
    },
  };
}

function sseChangeFrame(params: {
  eventId: string;
  entityType: string;
  entityId: string;
  action: string;
  occurredAt?: string;
}): string {
  const message = {
    type: "change",
    eventId: params.eventId,
    entityType: params.entityType,
    entityId: params.entityId,
    issueIdentifier: null,
    action: params.action,
    actorId: "actor-1",
    requestId: "00000000-0000-4000-8000-000000000111",
    occurredAt: params.occurredAt ?? "2026-11-15T01:02:00.000Z",
  };
  return `id: ${params.eventId}\nevent: change\ndata: ${JSON.stringify(message)}\n\n`;
}

test("watchForum --once skips heartbeats, non-forum events and non-matching scopes/kinds, then exits on first match", async () => {
  const lines: string[] = [];
  const { context } = createSseFixture({
    onStreamConnect(send) {
      setTimeout(() => {
        send(": heartbeat\n\n");
        send(
          sseChangeFrame({
            eventId: "ev-1",
            entityType: "issue",
            entityId: otherUuid,
            action: "updated",
          }),
        );
        send(
          sseChangeFrame({
            eventId: "ev-2",
            entityType: "forum-post",
            entityId: otherUuid,
            action: "created",
          }),
        );
        send(
          sseChangeFrame({
            eventId: "ev-3",
            entityType: "forum-post",
            entityId: postUuid,
            action: "updated",
          }),
        );
      }, 15);
    },
  });

  await watchForum(
    context,
    [],
    parseForumArgs(["--kind", "notice", "--scope", "main", "--once", "--json"])
      .values,
    { writeLine: (line) => lines.push(line) },
  );

  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
    event: { eventId: "ev-3", entityType: "forum-post", action: "updated" },
    post: { id: postUuid, identifier: "FM-12", kind: "notice" },
  });
});

test("watchForum --until-resolved exits immediately with already-resolved snapshot when already resolved at connect time", async () => {
  const lines: string[] = [];
  const { context, byIdQueries } = createSseFixture({
    initialState: "resolved",
  });

  await watchForum(
    context,
    ["fm-12"],
    parseForumArgs(["--until-resolved", "--json"]).values,
    { writeLine: (line) => lines.push(line) },
  );

  expect(byIdQueries).toEqual(["FM-12"]);
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
    event: { action: "already-resolved", entityId: postUuid },
    post: { id: postUuid, identifier: "FM-12", state: "resolved" },
  });
});

test("watchForum --until-resolved streams intermediate updates on target FM-<N> and exits once resolved", async () => {
  const lines: string[] = [];
  let pushFrame: ((chunk: string) => void) | undefined;
  const { context, setPostState, byIdQueries } = createSseFixture({
    initialState: "open",
    onStreamConnect(send) {
      pushFrame = send;
    },
  });

  const watching = watchForum(
    context,
    ["fm-12"],
    parseForumArgs(["--until-resolved"]).values,
    { writeLine: (line) => lines.push(line) },
  );

  while (pushFrame === undefined || byIdQueries.length === 0) {
    await Bun.sleep(10);
  }
  pushFrame(
    sseChangeFrame({
      eventId: "ev-other",
      entityType: "forum-reply",
      entityId: otherUuid,
      action: "created",
    }),
  );
  pushFrame(
    sseChangeFrame({
      eventId: "ev-reply",
      entityType: "forum-reply",
      entityId: postUuid,
      action: "created",
      occurredAt: "2026-11-15T01:03:00.000Z",
    }),
  );
  await Bun.sleep(25);
  setPostState("resolved");
  pushFrame(
    sseChangeFrame({
      eventId: "ev-resolved",
      entityType: "forum-post",
      entityId: postUuid,
      action: "resolved",
      occurredAt: "2026-11-15T01:05:00.000Z",
    }),
  );

  await watching;

  expect(byIdQueries).toEqual(["FM-12", postUuid, postUuid]);
  expect(lines).toEqual([
    "[2026-11-15T01:03:00.000Z] FM-12 (notice/open) created: Main CI recovery",
    "[2026-11-15T01:05:00.000Z] FM-12 (notice/resolved) resolved: Main CI recovery",
  ]);
});

test("watchForum --timeout-sec rejects cleanly when no matching event arrives", async () => {
  const { context } = createSseFixture({
    onStreamConnect(send) {
      send(": heartbeat\n\n");
    },
  });

  await expect(
    watchForum(
      context,
      ["FM-12"],
      parseForumArgs(["--until-resolved", "--timeout-sec", "1"]).values,
      {
        writeLine: () => {
          /* No output expected before timeout. */
        },
      },
    ),
  ).rejects.toThrow("Timed out after 1s waiting for forum events");

  await expect(
    watchForum(context, [], parseForumArgs(["--until-resolved"]).values),
  ).rejects.toThrow("--until-resolved requires a post ID");
});
