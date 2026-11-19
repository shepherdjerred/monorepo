import { Forum } from "#infrastructure/forum.ts";
import { expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { Attachments } from "#infrastructure/attachments.ts";
import { Collaboration } from "#infrastructure/collaboration.ts";
import { appRouter } from "#server/router.ts";
import {
  IssueListSchema,
  type Effort,
  type Impact,
  type Urgency,
} from "#shared/schema.ts";
import { memoryObjectStore } from "./memory-object-store.ts";
import { useTrackerSuite } from "./suite.ts";

const suite = useTrackerSuite("keyset");
const list = (input: Record<string, unknown>) =>
  suite.issues.list(IssueListSchema.parse(input));
const total = async (input: Record<string, unknown>) => {
  const page = await list(input);
  return page.total;
};
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** Follows cursors to the end and returns every ID served. */
async function pages(input: Record<string, unknown>, limit: number) {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await list({ ...input, limit, cursor });
    expect(page.items.length).toBeLessThanOrEqual(limit);
    ids.push(...page.items.map(({ id }) => id));
    if (page.nextCursor === null) return { ids, total: page.total };
    cursor = page.nextCursor;
  }
  throw new Error("Paging did not terminate");
}

async function seedProject(slug: string, count: number) {
  await suite.catalog.project(
    { actor: suite.actor, slug, name: slug },
    true,
    slug,
  );
  const created = [];
  for (let index = 0; index < count; index += 1)
    created.push(
      await suite.create(`Keyset candidate ${slug} ${String(index)}`, {
        projectSlug: slug,
        priority: index % 5,
        stateType: index % 2 === 0 ? "backlog" : "started",
      }),
    );
  return created;
}

it("serves every issue exactly once, in the unpaged order, for every sort and for search", async () => {
  const created = await seedProject("keyset-sorts", 13);
  for (const [index, issue] of created.entries()) {
    for (let voter = 0; voter < index % 4; voter += 1)
      await suite.issues.vote(
        {
          actor: { ...suite.actor, key: `codex:voter-${String(voter)}` },
          identifier: issue.identifier,
        },
        false,
        "votes",
      );
    if (index % 3 === 0)
      await suite.update(issue.identifier, { description: "Touched" });
  }
  // Collapse most timestamps so the ID tie-breaker carries the ordering.
  await suite.database.issue.updateMany({
    where: { id: { in: created.slice(0, 8).map(({ id }) => id) } },
    data: {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    },
  });
  for (const input of [
    { sort: "updated" },
    { sort: "created" },
    { sort: "priority" },
    { sort: "votes" },
    { sort: "board" },
    { sort: "updated", search: "keyset candidate" },
  ]) {
    const filter = { ...input, projectSlug: "keyset-sorts" };
    const all = await list({ ...filter, limit: "all" });
    expect(all.items).toHaveLength(13);
    expect(all.total).toBe(13);
    expect(all.nextCursor).toBeNull();
    for (const limit of [1, 3, 13, 50]) {
      const paged = await pages(filter, limit);
      expect(paged.ids).toEqual(all.items.map(({ id }) => id));
      expect(paged.total).toBe(13);
    }
  }
  const byPriority = await list({
    projectSlug: "keyset-sorts",
    sort: "priority",
    limit: "all",
  });
  expect([
    ...new Set(byPriority.items.map(({ priority }) => priority)),
  ]).toEqual([1, 2, 3, 4, 0]);
  const byVotes = await list({
    projectSlug: "keyset-sorts",
    sort: "votes",
    limit: "all",
  });
  const votes = byVotes.items.map(({ voteCount }) => voteCount);
  expect(votes).toEqual(votes.toSorted((a, b) => b - a));
  expect(new Set(votes).size).toBe(4);
});

it("neither repeats nor skips issues that are edited between pages", async () => {
  const created = await seedProject("keyset-edits", 9);
  for (const [index, issue] of created.entries())
    await suite.database.issue.update({
      where: { id: issue.id },
      data: { updatedAt: new Date(Date.UTC(2026, 0, 1 + index)) },
    });
  const filter = { projectSlug: "keyset-edits", sort: "updated" };
  const before = await list({ ...filter, limit: "all" });
  const order = before.items.map(({ id }) => id);
  const first = await list({ ...filter, limit: 3 });
  expect(first.items.map(({ id }) => id)).toEqual(order.slice(0, 3));
  const served = first.items[0];
  const pending = before.items[6];
  if (served === undefined || pending === undefined)
    throw new Error("Missing seeded issues");
  // One already-served issue and one not-yet-served issue jump to the top.
  await suite.update(served.identifier, { title: "Edited after being served" });
  await suite.update(pending.identifier, { title: "Edited before its page" });
  const rest: string[] = [];
  let cursor = first.nextCursor;
  while (cursor !== null) {
    const page = await list({ ...filter, limit: 3, cursor });
    rest.push(...page.items.map(({ id }) => id));
    cursor = page.nextCursor;
  }
  expect(rest).toEqual(order.slice(3).filter((id) => id !== pending.id));
});

it("continues from a cursor whose issue was deleted", async () => {
  await seedProject("keyset-deletes", 6);
  for (const sort of ["updated", "priority"]) {
    const filter = { projectSlug: "keyset-deletes", sort };
    const { items: order } = await list({ ...filter, limit: "all" });
    const first = await list({ ...filter, limit: 2 });
    const last = first.items.at(-1);
    if (last === undefined) throw new Error("Missing first page");
    await suite.issues.delete(
      {
        actor: suite.actor,
        identifier: last.identifier,
        expectedRevision: last.revision,
      },
      "delete",
    );
    const next = await list({ ...filter, limit: 50, cursor: first.nextCursor });
    expect(next.items.map(({ id }) => id)).toEqual(
      order.slice(2).map(({ id }) => id),
    );
    expect(next.total).toBe(order.length - 1);
  }
});

it("rejects malformed and mismatched cursors as a bad request", async () => {
  await seedProject("keyset-cursors", 3);
  const filter = { projectSlug: "keyset-cursors", limit: 1 };
  const priority = await list({ ...filter, sort: "priority" });
  if (priority.nextCursor === null) throw new Error("Missing next page");
  const caller = appRouter.createCaller({
    issues: suite.issues,
    catalog: suite.catalog,
    collaboration: new Collaboration(suite.database, suite.unit),
    attachments: new Attachments(
      suite.database,
      suite.unit,
      memoryObjectStore(),
    ),
    requestId: "cursors",
    writesEnabled: () => Promise.resolve(true),
    forum: new Forum(suite.database, suite.unit),
    forumEnabled: async () => true,
    liveUpdatesEnabled: () => Promise.resolve(false),
  });
  for (const cursor of [
    "not a cursor",
    crypto.randomUUID(),
    encode("text"),
    encode({ o: "updated", k: [], id: "x" }),
    encode({ o: "updated", k: ["2026-01-01"], id: "x" }),
    encode({ o: "updated", k: [12], id: "x" }),
    encode({ o: "updated", k: ["1"], id: "" }),
    encode({ o: "updated", k: ["1"], id: "x", extra: true }),
    encode({ o: "search", k: [0.5, true, "1"], id: "x" }),
    // A cursor issued for another ordering.
    priority.nextCursor,
  ]) {
    const failure: unknown = await caller.issues
      .list({ sort: "updated", cursor })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TRPCError);
    expect(failure).toMatchObject({ code: "BAD_REQUEST" });
  }
  const valid = await caller.issues.list({
    ...filter,
    sort: "priority",
    cursor: priority.nextCursor,
  });
  expect(valid.items).toHaveLength(1);
  expect(valid.items[0]?.id).not.toBe(priority.items[0]?.id);
});

it("counts every match of the filter regardless of cursor and limit", async () => {
  const created = await seedProject("keyset-totals", 7);
  await suite.catalog.label(
    { actor: suite.actor, teamKey: "AI", name: "keyset-total" },
    "create",
    "totals",
  );
  for (const issue of created.slice(0, 4))
    await suite.update(issue.identifier, { addLabels: ["keyset-total"] });
  const archived = created[0];
  if (archived === undefined) throw new Error("Missing seeded issue");
  await suite.update(archived.identifier, { archived: true });
  const filter = { projectSlug: "keyset-totals" };
  expect(await total({ ...filter, limit: 2 })).toBe(6);
  expect(await total({ ...filter, includeArchived: true, limit: 2 })).toBe(7);
  expect(await total({ ...filter, states: ["backlog"], limit: 1 })).toBe(3);
  expect(
    await total({ ...filter, states: ["In progress", "backlog"], limit: 1 }),
  ).toBe(6);
  expect(await total({ ...filter, states: ["No such state"] })).toBe(0);
  expect(await total({ ...filter, labels: ["keyset-total"], limit: 1 })).toBe(
    3,
  );
  expect(await total({ ...filter, priority: 0, limit: 1 })).toBe(1);
  expect(await total({ ...filter, teamKey: "SJ" })).toBe(0);
  expect(await total({ ...filter, creatorKey: suite.actor.key })).toBe(6);
  expect(await total({ ...filter, assigneeKey: "human:nobody" })).toBe(0);
  const paged = await pages({ ...filter, labels: ["keyset-total"] }, 2);
  expect(paged.ids).toHaveLength(3);
  expect(paged.total).toBe(3);
  expect(await total({ ...filter, search: "keyset candidate", limit: 2 })).toBe(
    6,
  );
  expect(
    await total({ search: archived.identifier, includeArchived: true }),
  ).toBe(1);
  expect(await list({ search: "!!!" })).toEqual({
    items: [],
    nextCursor: null,
    total: 0,
  });
});

it("filters multi-value urgencies, impacts and efforts (including none) and paginates urgency, impact and effort sorts", async () => {
  const slug = "keyset-grooming";
  await suite.catalog.project(
    { actor: suite.actor, slug, name: slug },
    true,
    slug,
  );
  const specs: {
    urgency: Urgency | null;
    impact: Impact | null;
    effort: Effort | null;
  }[] = [
    { urgency: "high", impact: "high", effort: "xs" },
    { urgency: "high", impact: "low", effort: "s" },
    { urgency: "medium", impact: "high", effort: "m" },
    { urgency: "medium", impact: null, effort: "l" },
    { urgency: "low", impact: "medium", effort: "xl" },
    { urgency: "low", impact: "low", effort: null },
    { urgency: null, impact: "medium", effort: "xs" },
    { urgency: null, impact: null, effort: null },
    { urgency: "high", impact: "medium", effort: "m" },
  ];
  const seeded: Awaited<ReturnType<typeof suite.create>>[] = [];
  for (const [index, spec] of specs.entries()) {
    seeded.push(
      await suite.create(`Grooming list ${String(index)}`, {
        projectSlug: slug,
        urgency: spec.urgency,
        impact: spec.impact,
        effort: spec.effort,
      }),
    );
  }

  for (const sort of ["urgency", "impact", "effort"] as const) {
    const filter = { projectSlug: slug, sort };
    const all = await list({ ...filter, limit: "all" });
    expect(all.items).toHaveLength(specs.length);
    expect(all.total).toBe(specs.length);
    for (const limit of [1, 2, 4, 50]) {
      const paged = await pages(filter, limit);
      expect(paged.ids).toEqual(all.items.map(({ id }) => id));
      expect(paged.total).toBe(specs.length);
    }
  }

  const byUrgency = await list({
    projectSlug: slug,
    sort: "urgency",
    limit: "all",
  });
  expect([...new Set(byUrgency.items.map(({ urgency }) => urgency))]).toEqual([
    "high",
    "medium",
    "low",
    null,
  ]);

  const byImpact = await list({
    projectSlug: slug,
    sort: "impact",
    limit: "all",
  });
  expect([...new Set(byImpact.items.map(({ impact }) => impact))]).toEqual([
    "high",
    "medium",
    "low",
    null,
  ]);

  const byEffort = await list({
    projectSlug: slug,
    sort: "effort",
    limit: "all",
  });
  expect([...new Set(byEffort.items.map(({ effort }) => effort))]).toEqual([
    "xs",
    "s",
    "m",
    "l",
    "xl",
    null,
  ]);

  const matchingIds = (predicate: (spec: (typeof specs)[number]) => boolean) =>
    seeded
      .filter((_, index) => {
        const spec = specs[index];
        return spec !== undefined && predicate(spec);
      })
      .map(({ id }) => id)
      .sort((a, b) => a.localeCompare(b));

  const queriedIds = async (extra: Record<string, unknown>) => {
    const page = await list({ projectSlug: slug, limit: "all", ...extra });
    expect(page.total).toBe(page.items.length);
    return page.items.map(({ id }) => id).sort((a, b) => a.localeCompare(b));
  };

  expect(await queriedIds({ efforts: ["xs", "s"] })).toEqual(
    matchingIds((s) => s.effort === "xs" || s.effort === "s"),
  );
  expect(await queriedIds({ efforts: ["none"] })).toEqual(
    matchingIds((s) => s.effort === null),
  );
  expect(await queriedIds({ efforts: ["xs", "none"] })).toEqual(
    matchingIds((s) => s.effort === "xs" || s.effort === null),
  );
  expect(await queriedIds({ urgencies: ["high", "low"] })).toEqual(
    matchingIds((s) => s.urgency === "high" || s.urgency === "low"),
  );
  expect(await queriedIds({ urgencies: ["none"] })).toEqual(
    matchingIds((s) => s.urgency === null),
  );
  expect(await queriedIds({ impacts: ["high", "none"] })).toEqual(
    matchingIds((s) => s.impact === "high" || s.impact === null),
  );
  expect(
    await queriedIds({
      urgencies: ["high", "none"],
      impacts: ["high", "medium"],
      efforts: ["xs", "m", "none"],
    }),
  ).toEqual(
    matchingIds(
      (s) =>
        (s.urgency === "high" || s.urgency === null) &&
        (s.impact === "high" || s.impact === "medium") &&
        (s.effort === "xs" || s.effort === "m" || s.effort === null),
    ),
  );
});

it("paginates number, title and bidirectional sorts while keeping unset values last", async () => {
  const slug = "keyset-directions";
  await suite.catalog.project(
    { actor: suite.actor, slug, name: slug },
    true,
    slug,
  );
  const rows: {
    title: string;
    priority: number;
    effort: Effort | null;
    dueDate: string | null;
  }[] = [
    { title: "delta task", priority: 0, effort: null, dueDate: null },
    { title: "Alpha task", priority: 3, effort: "xl", dueDate: "2026-12-20" },
    { title: "charlie task", priority: 1, effort: "xs", dueDate: "2026-12-01" },
    { title: "Bravo task", priority: 2, effort: "m", dueDate: "2026-12-10" },
    { title: "echo task", priority: 0, effort: "s", dueDate: null },
  ];
  for (const row of rows) {
    await suite.create(row.title, {
      projectSlug: slug,
      priority: row.priority,
      effort: row.effort,
      ...(row.dueDate === null ? {} : { dueDate: row.dueDate }),
    });
  }

  for (const sort of [
    "updated",
    "created",
    "priority",
    "effort",
    "due",
    "number",
    "title",
  ] as const) {
    for (const dir of ["asc", "desc"] as const) {
      const filter = { projectSlug: slug, sort, dir };
      const all = await list({ ...filter, limit: "all" });
      expect(all.items).toHaveLength(rows.length);
      for (const limit of [1, 2, 5]) {
        const paged = await pages(filter, limit);
        expect(paged.ids).toEqual(all.items.map(({ id }) => id));
      }
    }
  }

  const titleAsc = await list({
    projectSlug: slug,
    sort: "title",
    dir: "asc",
    limit: "all",
  });
  expect(titleAsc.items.map(({ title }) => title)).toEqual([
    "Alpha task",
    "Bravo task",
    "charlie task",
    "delta task",
    "echo task",
  ]);
  const titleDesc = await list({
    projectSlug: slug,
    sort: "title",
    dir: "desc",
    limit: "all",
  });
  expect(titleDesc.items.map(({ title }) => title)).toEqual([
    "echo task",
    "delta task",
    "charlie task",
    "Bravo task",
    "Alpha task",
  ]);

  const numberAsc = await list({
    projectSlug: slug,
    sort: "number",
    dir: "asc",
    limit: "all",
  });
  const numbers = numberAsc.items.map(({ number }) => number);
  expect(numbers).toEqual(numbers.toSorted((a, b) => a - b));

  // Unset priority (0), effort (null) and dueDate (null) stay last in both directions.
  const priorityDesc = await list({
    projectSlug: slug,
    sort: "priority",
    dir: "desc",
    limit: "all",
  });
  expect(priorityDesc.items.map(({ priority }) => priority)).toEqual([
    3, 2, 1, 0, 0,
  ]);

  const effortDesc = await list({
    projectSlug: slug,
    sort: "effort",
    dir: "desc",
    limit: "all",
  });
  expect(effortDesc.items.map(({ effort }) => effort)).toEqual([
    "xl",
    "m",
    "s",
    "xs",
    null,
  ]);

  const dueDesc = await list({
    projectSlug: slug,
    sort: "due",
    dir: "desc",
    limit: "all",
  });
  expect(dueDesc.items.map(({ dueDate }) => dueDate)).toEqual([
    "2026-12-20",
    "2026-12-10",
    "2026-12-01",
    null,
    null,
  ]);

  // Reversing direction produces a distinct cursor order rejected by the opposite direction.
  const ascPage = await list({
    projectSlug: slug,
    sort: "priority",
    dir: "asc",
    limit: 2,
  });
  expect(ascPage.nextCursor).not.toBeNull();
  await expect(
    list({
      projectSlug: slug,
      sort: "priority",
      dir: "desc",
      cursor: ascPage.nextCursor ?? undefined,
    }),
  ).rejects.toThrow();
});
