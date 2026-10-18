import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { cloneTestDatabase } from "#testing/postgres.ts";
import { PrismaUnitOfWork } from "#infrastructure/prisma-unit-of-work.ts";
import { Issues } from "#infrastructure/issues.ts";
import { Collaboration } from "#infrastructure/collaboration.ts";
import { Catalog } from "#infrastructure/catalog.ts";
import { Attachments } from "#infrastructure/attachments.ts";
import {
  CreateIssueSchema,
  IssueListSchema,
  UpdateIssueSchema,
} from "#shared/schema.ts";
import { ActorSchema } from "#shared/actor.ts";
import { appRouter } from "#server/router.ts";
import { createApp } from "#server/app.ts";
import { memoryObjectStore } from "#testing/memory-object-store.ts";

const actor = ActorSchema.parse({
  key: "codex:test-session",
  name: "Codex",
  kind: "agent",
  metadata: { sessionId: "test-session", model: "test" },
});
let suite: Awaited<ReturnType<typeof cloneTestDatabase>>;
let issues: Issues;
let unit: PrismaUnitOfWork;
const create = (title: string, extra: Record<string, unknown> = {}) =>
  issues.create(
    CreateIssueSchema.parse({ actor, teamKey: "AI", title, ...extra }),
    crypto.randomUUID(),
  );

beforeAll(async () => {
  suite = await cloneTestDatabase(
    z.url().parse(Bun.env["TRACKER_TEST_ADMIN_URL"]),
  );
  unit = new PrismaUnitOfWork(suite.database);
  issues = new Issues(suite.database, unit);
});
afterAll(async () => {
  await suite.close();
});

it("validates raster uploads and removes only staged objects", async () => {
  const store = memoryObjectStore();
  const attachments = new Attachments(suite.database, unit, store);
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4zwAAAAASUVORK5CYII=",
    "base64",
  );
  const file = await attachments.upload(
    new File([bytes], "screenshot.png", { type: "image/png" }),
    actor,
    1024,
    "png",
  );
  expect(file.width).toBe(1);
  expect(file.height).toBe(1);
  const response = await attachments.download(file.id, file.filename);
  expect(response.headers.get("content-disposition")).toMatch(/^inline/u);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array(bytes),
  );
  expect(
    await attachments.cleanupStaged(new Date("2100-01-01"), actor, "cleanup"),
  ).toBe(1);
  expect(
    await suite.database.attachment.findUnique({ where: { id: file.id } }),
  ).toBeNull();
});

it("paginates ranked results and combines filters without putting unprioritized issues first", async () => {
  const catalog = new Catalog(unit);
  await catalog.project(
    { actor, slug: "query-checks", name: "Query checks" },
    true,
    "queries",
  );
  for (const name of ["query-alpha", "query-beta"])
    await catalog.label({ actor, teamKey: "AI", name }, "create", "queries");
  const urgent = await create("Query rank exact", {
    priority: 1,
    projectSlug: "query-checks",
    labels: ["query-alpha", "query-beta"],
  });
  const low = await create("Query rank secondary", {
    priority: 4,
    projectSlug: "query-checks",
    labels: ["query-alpha"],
  });
  const none = await create("Query rank unprioritized", {
    priority: 0,
    projectSlug: "query-checks",
  });
  const first = await issues.list(
    IssueListSchema.parse({
      projectSlug: "query-checks",
      sort: "priority",
      limit: 1,
    }),
  );
  expect(first.items.map((item) => item.id)).toEqual([urgent.id]);
  const second = await issues.list(
    IssueListSchema.parse({
      projectSlug: "query-checks",
      sort: "priority",
      limit: 1,
      cursor: first.nextCursor,
    }),
  );
  expect(second.items.map((item) => item.id)).toEqual([low.id]);
  const last = await issues.list(
    IssueListSchema.parse({
      projectSlug: "query-checks",
      sort: "priority",
      limit: 1,
      cursor: second.nextCursor,
    }),
  );
  expect(last.items.map((item) => item.id)).toEqual([none.id]);
  expect(last.nextCursor).toBeNull();
  const intersection = await issues.list(
    IssueListSchema.parse({ labels: ["query-alpha", "query-beta"] }),
  );
  expect(intersection.items.map((item) => item.id)).toEqual([urgent.id]);
  const search = await issues.search("Query rank exact", "AI", false);
  expect(search.items[0]?.id).toBe(urgent.id);
});

it("accepts exactly one of concurrent saves at the same revision", async () => {
  const issue = await create("Concurrent revisions");
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) =>
      issues.update(
        UpdateIssueSchema.parse({
          actor: { ...actor, key: `codex:revision-${String(index)}` },
          identifier: issue.identifier,
          expectedRevision: issue.revision,
          title: `Winner ${String(index)}`,
        }),
        "cas",
      ),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    9,
  );
});

it("rebalances exhausted board gaps with revision increments and audit events for every affected issue", async () => {
  const first = await create("Rebalance first", { stateType: "unstarted" });
  const last = await create("Rebalance last", { stateType: "unstarted" });
  const moving = await create("Rebalance moving");
  const state = first.state;
  await suite.database.issue.updateMany({
    where: { stateId: state.id },
    data: { archivedAt: new Date() },
  });
  await suite.database.issue.update({
    where: { id: first.id },
    data: { boardOrder: 1, archivedAt: null },
  });
  await suite.database.issue.update({
    where: { id: last.id },
    data: { boardOrder: 1 + 1e-12, archivedAt: null },
  });
  const result = await issues.move(
    {
      actor,
      identifier: moving.identifier,
      stateId: state.id,
      beforeId: first.id,
      afterId: last.id,
      expectedRevision: moving.revision,
    },
    "rebalance",
  );
  expect(result.boardOrder).toBe(1536);
  const events = await suite.database.event.findMany({
    where: { requestId: "rebalance", action: "board-rebalanced" },
  });
  expect(
    events
      .map((event) => event.issueIdentifier)
      .sort((a, b) => String(a).localeCompare(String(b))),
  ).toEqual(
    [first.identifier, last.identifier].sort((a, b) => a.localeCompare(b)),
  );
  const persisted = await issues.byIdentifier(first.identifier);
  expect(persisted.revision).toBe(first.revision + 1);
});

it("allocates 25 distinct contiguous numbers under contention", async () => {
  const team = await suite.database.team.findUniqueOrThrow({
    where: { key: "AI" },
  });
  const created = await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      create(`Concurrent ${String(index)}`),
    ),
  );
  expect(created.map(({ number }) => number).sort((a, b) => a - b)).toEqual(
    Array.from({ length: 25 }, (_, i) => team.issueCounter + i + 1),
  );
});
it("rolls back the actor, number, issue and audit when a label is invalid", async () => {
  const before = await suite.database.team.findUniqueOrThrow({
    where: { key: "AI" },
  });
  const eventCount = await suite.database.event.count();
  await expect(
    create("Must roll back", {
      actor: { ...actor, key: "codex:rollback" },
      labels: ["missing"],
    }),
  ).rejects.toThrow("Unknown label");
  expect(
    await suite.database.actor.findUnique({
      where: { key: "codex:rollback" },
    }),
  ).toBeNull();
  expect(
    await suite.database.issue.findFirst({
      where: { title: "Must roll back" },
    }),
  ).toBeNull();
  const afterTeam = await suite.database.team.findUniqueOrThrow({
    where: { key: "AI" },
  });
  expect(afterTeam.issueCounter).toBe(before.issueCounter);
  expect(await suite.database.event.count()).toBe(eventCount);
});
it("rejects stale saves without touching actor counts or history", async () => {
  const issue = await create("Revision check");
  const input = UpdateIssueSchema.parse({
    actor,
    identifier: issue.identifier,
    title: "Winner",
    expectedRevision: issue.revision,
  });
  const first = await issues.update(input, "first");
  const before = await suite.database.actor.findUniqueOrThrow({
    where: { key: actor.key },
  });
  await expect(
    issues.update({ ...input, title: "Stale" }, "second"),
  ).rejects.toThrow("This issue changed");
  const after = await issues.byIdentifier(issue.identifier);
  expect(after.title).toBe("Winner");
  expect(first.revision).toBe(issue.revision + 1);
  const afterActor = await suite.database.actor.findUniqueOrThrow({
    where: { key: actor.key },
  });
  expect(afterActor.seenCount).toBe(before.seenCount);
});
it("serializes duplicate votes and removals while preserving the exact count", async () => {
  const issue = await create("Voting contention");
  await Promise.all(
    Array.from({ length: 12 }, () =>
      issues.vote({ actor, identifier: issue.identifier }, false, "vote"),
    ),
  );
  const voted = await issues.byIdentifier(issue.identifier, actor.key);
  expect(voted.voteCount).toBe(1);
  expect(
    await suite.database.event.count({
      where: { issueId: issue.id, entityType: "vote" },
    }),
  ).toBe(1);
  const other = { ...actor, key: "codex:other-session" };
  await Promise.all([
    issues.vote({ actor, identifier: issue.identifier }, true, "remove"),
    issues.vote({ actor: other, identifier: issue.identifier }, false, "other"),
  ]);
  const current = await issues.byIdentifier(issue.identifier, actor.key);
  expect(current.voteCount).toBe(current.votes.length);
  expect(current.voteCount).toBe(1);
  expect(current.viewerVoted).toBe(false);
});
it("finds identifiers, word prefixes and typos through Postgres indexes", async () => {
  const issue = await create("Kubernetes attachment delivery", {
    description: "Streaming screenshots reliably",
  });
  for (const search of [
    issue.identifier.toLowerCase(),
    "Kubern",
    "Kubernets attachment",
    "screensh",
  ]) {
    const found = await issues.list(IssueListSchema.parse({ search }));
    expect(found.items.map(({ id }) => id)).toContain(issue.id);
  }
});
it("moves cards persistently and rejects invalid or cross-team neighbors", async () => {
  const issue = await create("Move a card");
  const state = await suite.database.workflowState.findFirstOrThrow({
    where: { team: { key: "AI" }, type: "started" },
  });
  const moved = await issues.move(
    {
      actor,
      identifier: issue.identifier,
      stateId: state.id,
      expectedRevision: issue.revision,
    },
    "move",
  );
  expect(moved.startedAt).not.toBeNull();
  const persisted = await issues.byIdentifier(issue.identifier);
  expect(persisted.state.id).toBe(state.id);
  await expect(
    issues.move(
      {
        actor,
        identifier: issue.identifier,
        stateId: "team-sj-started",
        expectedRevision: moved.revision,
      },
      "bad",
    ),
  ).rejects.toThrow("Unknown state");
});
it("keeps complete audit snapshots after deleting an issue", async () => {
  const issue = await create("Keep my history");
  const collaboration = new Collaboration(suite.database, unit);
  await collaboration.comment(
    {
      actor,
      identifier: issue.identifier,
      body: "Historical comment",
      attachmentIds: [],
    },
    "comment",
  );
  await issues.delete(
    { actor, identifier: issue.identifier, expectedRevision: issue.revision },
    "delete",
  );
  const events = await suite.database.event.findMany({
    where: { issueIdentifier: issue.identifier },
  });
  expect(events).toHaveLength(3);
  expect(events.every(({ issueId }) => issueId === null)).toBe(true);
  expect(
    JSON.stringify(events.find(({ action }) => action === "deleted")?.before),
  ).toContain("Historical comment");
});
it("enforces team state consistency even outside the API", async () => {
  const issue = await create("Team constraint");
  await expect(
    suite.database.issue.update({
      where: { id: issue.id },
      data: { stateId: "team-sj-started" },
    }),
  ).rejects.toThrow();
});
it("rejects actorless mutations, pauses writes, and round-trips safe attachments", async () => {
  const objects = new Map<string, Uint8Array>();
  const attachments = new Attachments(suite.database, unit, {
    async put(key, stream) {
      objects.set(
        key,
        new Uint8Array(await new Response(stream).arrayBuffer()),
      );
    },
    get(key) {
      const value = objects.get(key);
      if (value === undefined) throw new Error("Missing test object");
      return new Blob([new Uint8Array(value)]).stream();
    },
    async delete(key) {
      objects.delete(key);
    },
  });
  const context = {
    issues,
    attachments,
    collaboration: new Collaboration(suite.database, unit),
    catalog: new Catalog(unit),
    requestId: "test",
    writesEnabled: async () => false,
  };
  const caller = appRouter.createCaller(context);
  await expect(
    caller.issues.create(
      CreateIssueSchema.parse({ actor, teamKey: "AI", title: "Paused" }),
    ),
  ).rejects.toThrow("paused");
  const app = createApp({
    ...context,
    attachments,
    writesEnabled: async () => true,
    attachmentMaxBytes: async () => 1000,
  });
  const missing = await app.request("/trpc/issues.create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamKey: "AI", title: "No actor" }),
  });
  expect(missing.status).toBe(400);
  const form = new FormData();
  form.set(
    "file",
    new File(["<script>alert(1)</script>"], "proof.svg", {
      type: "image/svg+xml",
    }),
  );
  const response = await app.request("/api/attachments", {
    method: "POST",
    headers: {
      "X-Tracker-Actor": Buffer.from(JSON.stringify(actor)).toString("base64"),
    },
    body: form,
  });
  expect(response.status).toBe(201);
  const attachment = z
    .object({ url: z.string(), sha256: z.string(), id: z.string() })
    .parse(await response.json());
  const download = await app.request(attachment.url);
  expect(await download.text()).toBe("<script>alert(1)</script>");
  expect(download.headers.get("content-disposition")).toMatch(/^attachment/u);
  expect(download.headers.get("x-content-type-options")).toBe("nosniff");
  expect(attachment.sha256).toHaveLength(64);
  const created = await create("Attachment owner", {
    attachmentIds: [attachment.id],
  });
  const persisted = await issues.byIdentifier(created.identifier);
  expect(persisted.attachments).toHaveLength(1);
  expect(
    await attachments.cleanupStaged(new Date("2100-01-01"), actor, "cleanup"),
  ).toBe(0);
});
