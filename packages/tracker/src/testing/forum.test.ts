import { expect, it } from "vitest";
import { Forum } from "#infrastructure/forum.ts";
import { Attachments } from "#infrastructure/attachments.ts";
import { Collaboration } from "#infrastructure/collaboration.ts";
import { appRouter } from "#server/router.ts";
import { ActorSchema } from "#shared/actor.ts";
import {
  CreateForumPostSchema,
  ForumListSchema,
  UpdateForumPostSchema,
} from "#shared/forum.ts";
import { memoryObjectStore } from "./memory-object-store.ts";
import { useTrackerSuite } from "./suite.ts";

const suite = useTrackerSuite("forum");
const service = () => new Forum(suite.database, suite.unit);
const actor = ActorSchema.parse({
  key: "claude-code:forum-peer",
  kind: "agent",
  name: "Claude",
  metadata: { sessionId: "forum-peer" },
});
const notice = (extra = {}) =>
  service().create(
    CreateForumPostSchema.parse({
      actor: suite.actor,
      kind: "notice",
      title: "Main recovery",
      body: "Fixing my regression",
      scopes: ["main"],
      exitCondition: "Main CI passes",
      ...extra,
    }),
    crypto.randomUUID(),
  );
const list = (input = {}, now?: Date) =>
  service().list(ForumListSchema.parse(input), now);

it("attributes cross-session replies and resolutions and preserves audit evidence", async () => {
  const post = await notice();
  const reply = await service().reply(
    { actor, id: post.id, body: "Confirmed the fix" },
    "reply",
  );
  expect(reply.author.key).toBe(actor.key);
  const resolved = await service().resolve(
    {
      actor,
      id: post.id,
      expectedRevision: post.revision,
      note: "Woodpecker verified the current main head",
    },
    "resolved",
  );
  expect(resolved.creator.key).toBe(suite.actor.key);
  expect(resolved.resolver?.key).toBe(actor.key);
  expect(resolved.resolutionNote).toContain("Woodpecker");
  const detail = await service().byId(post.id);
  expect(detail.replies).toHaveLength(1);
  expect(
    await suite.database.event.count({
      where: { entityId: post.id, entityType: { startsWith: "forum" } },
    }),
  ).toBe(3);
  const reopened = await service().reopen(
    { actor, id: post.id, expectedRevision: resolved.revision },
    "reopen",
  );
  expect(reopened.state).toBe("open");
});

it("expires exactly at the deadline without resolving or deleting the post", async () => {
  const expiresAt = "2030-01-01T00:00:00.000Z";
  const post = await notice({ expiresAt });
  const before = await list({}, new Date("2029-12-31T23:59:59.999Z"));
  expect(before.items.some(({ id }) => id === post.id)).toBe(true);
  const atDeadline = await list({}, new Date(expiresAt));
  expect(atDeadline.items.some(({ id }) => id === post.id)).toBe(false);
  const expiredList = await list({ state: "expired" }, new Date(expiresAt));
  const expired = expiredList.items.find(({ id }) => id === post.id);
  expect(expired).toMatchObject({
    expired: true,
    state: "open",
    resolvedAt: null,
    resolutionNote: null,
  });
  const history = await list({ state: "all" }, new Date(expiresAt));
  expect(history.items.some(({ id }) => id === post.id)).toBe(true);
});

it("edits dates and conditions while rejecting stale revisions atomically", async () => {
  const post = await notice({ expiresAt: "2030-01-01T00:00:00Z" });
  const updated = await service().update(
    UpdateForumPostSchema.parse({
      actor,
      id: post.id,
      expectedRevision: 1,
      title: "Updated recovery",
      expiresAt: "2031-01-01T00:00:00Z",
    }),
    "edit",
  );
  expect(updated.expiresAt).toBe("2031-01-01T00:00:00.000Z");
  expect(updated.exitCondition).toBe(post.exitCondition);
  const seen = await suite.database.actor.findUniqueOrThrow({
    where: { key: actor.key },
  });
  await expect(
    service().resolve(
      { actor, id: post.id, expectedRevision: 1, note: "stale" },
      "conflict",
    ),
  ).rejects.toThrow("changed");
  const afterConflict = await suite.database.actor.findUniqueOrThrow({
    where: { key: actor.key },
  });
  expect(afterConflict.seenCount).toBe(seen.seenCount);
  const edited = await service().byId(post.id);
  expect(edited.revision).toBe(2);
  await expect(
    service().update(
      UpdateForumPostSchema.parse({
        actor,
        id: post.id,
        expectedRevision: 2,
        exitCondition: null,
      }),
      "invalid-condition",
    ),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const afterInvalid = await service().byId(post.id);
  expect(afterInvalid.exitCondition).toBe(post.exitCondition);
});

it("matches global and selected scopes and searches old replies", async () => {
  const global = await notice({ title: "Global work", scopes: [] });
  const scoped = await notice({ title: "Cluster work", scopes: ["cluster"] });
  await service().reply(
    { actor, id: scoped.id, body: "UniqueForumSearchEvidence" },
    "search-reply",
  );
  await service().resolve(
    { actor, id: scoped.id, expectedRevision: 1, note: "done" },
    "search-resolution",
  );
  const ci = await list({ scopes: ["ci"] });
  expect(ci.items.some(({ id }) => id === global.id)).toBe(true);
  expect(ci.items.some(({ id }) => id === scoped.id)).toBe(false);
  const results = await list({
    query: "uniqueforumsearchevidence",
    state: "all",
  });
  expect(results.items.map(({ id }) => id)).toContain(scoped.id);
});

it("validates notice fields and gates API reads and writes", async () => {
  expect(
    CreateForumPostSchema.safeParse({
      actor,
      kind: "notice",
      title: "missing condition",
      body: "body",
    }).success,
  ).toBe(false);
  const context = {
    forum: service(),
    forumEnabled: async () => false,
    issues: suite.issues,
    catalog: suite.catalog,
    collaboration: new Collaboration(suite.database, suite.unit),
    attachments: new Attachments(
      suite.database,
      suite.unit,
      memoryObjectStore(),
    ),
    requestId: "gates",
    writesEnabled: async () => true,
    liveUpdatesEnabled: async () => false,
  };
  await expect(appRouter.createCaller(context).forum.list({})).rejects.toThrow(
    "disabled",
  );
  const caller = appRouter.createCaller({
    ...context,
    forumEnabled: async () => true,
    writesEnabled: async () => false,
  });
  const writable = appRouter.createCaller({
    ...context,
    forumEnabled: async () => true,
  });
  const post = await notice();
  await expect(
    writable.forum.update({
      actor,
      id: post.id,
      expectedRevision: post.revision,
      exitCondition: null,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await caller.forum.search({ query: "nothing-matches" })).toMatchObject(
    { total: 0 },
  );
  await expect(
    caller.forum.create({
      actor,
      kind: "discussion",
      title: "Question",
      body: "body",
    }),
  ).rejects.toThrow("paused");
});
