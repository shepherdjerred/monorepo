import { expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { Attachments } from "#infrastructure/attachments.ts";
import { Collaboration } from "#infrastructure/collaboration.ts";
import { appRouter } from "#server/router.ts";
import { CreateViewSchema } from "#shared/schema.ts";
import { memoryObjectStore } from "./memory-object-store.ts";
import { useTrackerSuite } from "./suite.ts";

const suite = useTrackerSuite("views");
const caller = (writesEnabled = true) =>
  appRouter.createCaller({
    issues: suite.issues,
    catalog: suite.catalog,
    collaboration: new Collaboration(suite.database, suite.unit),
    attachments: new Attachments(
      suite.database,
      suite.unit,
      memoryObjectStore(),
    ),
    requestId: "views",
    writesEnabled: () => Promise.resolve(writesEnabled),
  });
async function failure(work: Promise<unknown>, code: string) {
  const thrown: unknown = await work.catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(TRPCError);
  expect(thrown).toMatchObject({ code });
}
const events = (action: string) =>
  suite.database.event.findMany({
    where: { entityType: "view", action },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });

it("creates, lists, updates, reorders and deletes views with an audit trail", async () => {
  const api = caller();
  const { actor } = suite;
  expect(await api.views.list()).toEqual([]);
  const mine = await api.views.create({
    actor,
    name: "  My open work  ",
    icon: "inbox",
    params: {
      assigneeKey: "human:jerred",
      states: ["started", "unstarted"],
      sort: "due",
      group: "state",
      view: "board",
    },
  });
  expect(mine).toMatchObject({
    name: "My open work",
    icon: "inbox",
    teamKey: null,
    position: 0,
    params: { states: ["started", "unstarted"], group: "state" },
    createdBy: { key: actor.key },
  });
  const team = await api.views.create({
    actor,
    name: "Agent triage",
    icon: "🤖",
    params: { states: ["triage"] },
    teamKey: "AI",
  });
  const other = await api.views.create({
    actor,
    name: "Jerred's backlog",
    icon: "list",
    params: {},
    teamKey: "SJ",
  });
  expect([team.position, other.position]).toEqual([1, 2]);
  expect(team.teamKey).toBe("AI");

  const ids = async (teamKey?: string) => {
    const views = await api.views.list(
      teamKey === undefined ? {} : { teamKey },
    );
    return views.map(({ id }) => id);
  };
  expect(await ids()).toEqual([mine.id, team.id, other.id]);
  // A team sees its own views and the global ones.
  expect(await ids("AI")).toEqual([mine.id, team.id]);
  expect(await ids("SJ")).toEqual([mine.id, other.id]);
  const bootstrap = await api.meta.bootstrap();
  expect(bootstrap.views.map(({ id }) => id)).toEqual(await ids());

  const updated = await api.views.update({
    actor,
    id: team.id,
    name: "Triage",
    params: { states: ["triage"], overdue: "true" },
    teamKey: null,
  });
  expect(updated).toMatchObject({
    name: "Triage",
    icon: "🤖",
    teamKey: null,
    position: 1,
    params: { overdue: "true" },
  });
  const renamed = await api.views.update({ actor, id: team.id, icon: "flag" });
  expect(renamed).toMatchObject({
    name: "Triage",
    icon: "flag",
    teamKey: null,
  });

  expect(
    await api.views.reorder({ actor, ids: [other.id, mine.id, team.id] }),
  ).toEqual({ reordered: true });
  expect(await ids()).toEqual([other.id, mine.id, team.id]);
  for (const bad of [
    [other.id, mine.id],
    [other.id, mine.id, mine.id],
    [other.id, mine.id, "missing"],
    [other.id, mine.id, team.id, "missing"],
  ])
    await failure(api.views.reorder({ actor, ids: bad }), "BAD_REQUEST");
  expect(await ids()).toEqual([other.id, mine.id, team.id]);

  expect(await api.views.delete({ actor, id: mine.id })).toEqual({
    deleted: true,
  });
  expect(await ids()).toEqual([other.id, team.id]);
  await failure(api.views.delete({ actor, id: mine.id }), "NOT_FOUND");
  await failure(
    api.views.update({ actor, id: mine.id, name: "Gone" }),
    "NOT_FOUND",
  );
  const next = await api.views.create({
    actor,
    name: "Newest",
    icon: "star",
    params: {},
  });
  expect(next.position).toBe(3);

  expect(await events("created")).toHaveLength(4);
  const [first, second] = await events("updated");
  expect(first?.entityId).toBe(team.id);
  expect(first?.changes).toMatchObject({
    name: { from: "Agent triage", to: "Triage" },
    teamKey: { from: "AI", to: null },
    params: { to: { states: ["triage"], overdue: "true" } },
  });
  expect(second?.changes).toEqual({
    icon: { from: "🤖", to: "flag" },
    updatedAt: expect.anything() as unknown,
  });
  const [reordered, ...rejected] = await events("reordered");
  expect(rejected).toEqual([]);
  expect(reordered).toMatchObject({
    before: { ids: [mine.id, team.id, other.id] },
    after: { ids: [other.id, mine.id, team.id] },
  });
  const [deleted] = await events("deleted");
  expect(deleted).toMatchObject({
    entityId: mine.id,
    before: { name: "My open work", params: { sort: "due" } },
    after: null,
  });
});

it("validates view fields and parameters structurally and honours the write gate", async () => {
  const api = caller();
  const { actor } = suite;
  const base = { actor, name: "View", icon: "dot", params: {} };
  const before = await suite.database.view.count();
  for (const input of [
    { ...base, params: { cursor: "abc" } },
    { ...base, params: { limit: "all" } },
    { ...base, params: { today: "2026-01-01" } },
    { ...base, params: { unknown: "value" } },
    { ...base, params: { states: [1, 2] } },
    { ...base, params: { priority: 2 } },
    { ...base, params: { includeArchived: true } },
    { ...base, params: { search: { nested: "object" } } },
    { ...base, params: { search: "x".repeat(501) } },
    { ...base, params: ["states"] },
    { ...base, params: "states=triage" },
    { ...base, name: "   " },
    { ...base, icon: "" },
    { ...base, icon: "x".repeat(33) },
    { ...base, teamKey: "ai" },
    { name: "No actor", icon: "dot", params: {} },
  ])
    expect(CreateViewSchema.safeParse(input).success).toBe(false);
  await failure(
    api.views.create({ ...base, params: { cursor: "abc" } }),
    "BAD_REQUEST",
  );
  await failure(api.views.create({ ...base, teamKey: "NOPE" }), "BAD_REQUEST");
  expect(await suite.database.view.count()).toBe(before);

  const every = await api.views.create({
    ...base,
    params: {
      teamKey: "AI",
      projectSlug: "scout",
      states: ["started"],
      labels: ["bug", "feature"],
      assigneeKey: "human:jerred",
      creatorKey: "human:jerred",
      priority: "1",
      search: "text",
      includeArchived: "true",
      parentIdentifier: "AI-1",
      hasParent: "false",
      dueBefore: "2026-12-31",
      dueAfter: "2026-01-01",
      overdue: "true",
      sort: "priority",
      group: "assignee",
      view: "list",
    },
  });
  expect(Object.keys(every.params)).toHaveLength(17);
  await failure(
    api.views.update({ actor, id: every.id, params: { cursor: "abc" } }),
    "BAD_REQUEST",
  );
  await failure(
    api.views.update({ actor, id: every.id, teamKey: "NOPE" }),
    "BAD_REQUEST",
  );

  const paused = caller(false);
  await failure(paused.views.create(base), "FORBIDDEN");
  await failure(paused.views.delete({ actor, id: every.id }), "FORBIDDEN");
  await failure(paused.views.reorder({ actor, ids: [every.id] }), "FORBIDDEN");
  expect(await paused.views.list()).toHaveLength(before + 1);
});
