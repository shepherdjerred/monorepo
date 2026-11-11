import { expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { TrackerError } from "#domain/error.ts";
import { Attachments } from "#infrastructure/attachments.ts";
import { Collaboration } from "#infrastructure/collaboration.ts";
import { appRouter } from "#server/router.ts";
import { BulkUpdateIssuesSchema } from "#shared/schema.ts";
import { memoryObjectStore } from "./memory-object-store.ts";
import { useTrackerSuite } from "./suite.ts";

const suite = useTrackerSuite("bulk-update");
const bulk = (
  identifiers: string[],
  patch: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  requestId: string = crypto.randomUUID(),
) =>
  suite.issues.bulkUpdate(
    BulkUpdateIssuesSchema.parse({
      actor: suite.actor,
      identifiers,
      patch,
      ...extra,
    }),
    requestId,
  );
const created = async (count: number, title: string, teamKey = "AI") => {
  const issues = [];
  for (let index = 0; index < count; index += 1)
    issues.push(
      await suite.create(`${title} ${String(index)}`, { teamKey, priority: 4 }),
    );
  return issues;
};
const snapshot = async (ids: string[]) => {
  const rows = await suite.database.issue.findMany({
    where: { id: { in: ids } },
    include: { labels: true },
    orderBy: { id: "asc" },
  });
  return { rows, events: await suite.database.event.count() };
};
async function rejected(work: Promise<unknown>, code: string, text: string[]) {
  const failure: unknown = await work.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(TrackerError);
  expect(failure).toMatchObject({ code });
  for (const part of text) expect(String(failure)).toContain(part);
}

it("applies one patch to many issues with one event each under one request", async () => {
  await suite.catalog.label(
    { actor: suite.actor, teamKey: "AI", name: "bulk-applied" },
    "create",
    "bulk-label",
  );
  const issues = await created(4, "Bulk apply");
  const order = [3, 0, 2, 1].map((index) => issues[index]?.identifier ?? "");
  const requestId = crypto.randomUUID();
  const result = await bulk(
    order,
    {
      stateType: "started",
      priority: 1,
      addLabels: ["bulk-applied"],
      dueDate: "2026-12-01",
      projectSlug: "toolkit",
    },
    {},
    requestId,
  );
  expect(result.items.map(({ identifier }) => identifier)).toEqual(order);
  for (const [index, item] of result.items.entries()) {
    const original = issues.find(({ id }) => id === item.id);
    expect(item).toMatchObject({
      identifier: order[index],
      priority: 1,
      dueDate: "2026-12-01",
      state: { type: "started" },
      project: { slug: "toolkit" },
      labels: [{ name: "bulk-applied" }],
      revision: (original?.revision ?? 0) + 1,
      childCount: 0,
    });
    expect(item.startedAt).not.toBeNull();
  }
  const events = await suite.database.event.findMany({ where: { requestId } });
  expect(events).toHaveLength(4);
  expect(events.every(({ action }) => action === "updated")).toBe(true);
  expect(new Set(events.map(({ issueId }) => issueId))).toEqual(
    new Set(issues.map(({ id }) => id)),
  );
  for (const event of events)
    expect(event.changes).toMatchObject({
      priority: { from: 4, to: 1 },
    });
});

it("rolls back every issue when one expected revision is stale", async () => {
  const issues = await created(3, "Bulk stale");
  const [first, second, third] = issues.map(({ identifier }) => identifier);
  if (first === undefined || second === undefined || third === undefined)
    throw new Error("Bulk stale fixtures are missing");
  await suite.update(second, { title: "Moved on" });
  const before = await snapshot(issues.map(({ id }) => id));
  await rejected(
    bulk(
      [first, second, third],
      { priority: 2 },
      {
        expectedRevisions: {
          [first]: issues[0]?.revision,
          [second]: issues[1]?.revision,
        },
      },
    ),
    "CONFLICT",
    [second, "changed"],
  );
  expect(await snapshot(issues.map(({ id }) => id))).toEqual(before);
  const fresh = await bulk(
    [first, second],
    { priority: 2 },
    {
      expectedRevisions: {
        [first]: issues[0]?.revision,
        [second]: (issues[1]?.revision ?? 0) + 1,
      },
    },
  );
  expect(fresh.items.map(({ priority }) => priority)).toEqual([2, 2]);
});

it("rejects a state or label missing from one issue's team without applying any", async () => {
  await suite.catalog.label(
    { actor: suite.actor, teamKey: "AI", name: "bulk-ai-only" },
    "create",
    "bulk-team",
  );
  await suite.catalog.state(
    {
      actor: suite.actor,
      teamKey: "AI",
      name: "Bulk review",
      type: "started",
      color: "#123456",
      position: 7,
    },
    "bulk-team",
  );
  const [ai] = await created(1, "Bulk team AI");
  const [sj] = await created(1, "Bulk team SJ", "SJ");
  if (ai === undefined || sj === undefined)
    throw new Error("Bulk team fixtures are missing");
  const before = await snapshot([ai.id, sj.id]);
  await rejected(
    bulk([ai.identifier, sj.identifier], { addLabels: ["bulk-ai-only"] }),
    "BAD_REQUEST",
    [sj.identifier, "Unknown label bulk-ai-only"],
  );
  await rejected(
    bulk([ai.identifier, sj.identifier], { stateName: "Bulk review" }),
    "BAD_REQUEST",
    [sj.identifier, "Unknown workflow state"],
  );
  expect(await snapshot([ai.id, sj.id])).toEqual(before);
  // A state name both teams share resolves to each team's own state.
  const shared = await bulk([ai.identifier, sj.identifier], {
    stateName: "Done",
  });
  expect(shared.items.map(({ stateId }) => stateId)).toEqual([
    "team-ai-completed",
    "team-sj-completed",
  ]);
});

it("names every unknown identifier and changes nothing", async () => {
  const [known] = await created(1, "Bulk known");
  if (known === undefined) throw new Error("Bulk known fixture is missing");
  const before = await snapshot([known.id]);
  await rejected(
    bulk([known.identifier, "AI-999998", "SJ-999999"], { priority: 1 }),
    "NOT_FOUND",
    ["Issues AI-999998, SJ-999999 not found"],
  );
  expect(await snapshot([known.id])).toEqual(before);
});

it("applies sub-issue rules to each issue and rolls back on a cycle", async () => {
  const [parent, first, second] = await created(3, "Bulk hierarchy");
  if (parent === undefined || first === undefined || second === undefined)
    throw new Error("Bulk hierarchy fixtures are missing");
  const linked = await bulk([first.identifier, second.identifier], {
    parentIdentifier: parent.identifier,
  });
  expect(linked.items.map((item) => item.parent?.identifier)).toEqual([
    parent.identifier,
    parent.identifier,
  ]);
  const before = await snapshot([parent.id, first.id, second.id]);
  await rejected(
    bulk([second.identifier, parent.identifier], {
      parentIdentifier: first.identifier,
    }),
    "BAD_REQUEST",
    [parent.identifier, "own descendant"],
  );
  expect(await snapshot([parent.id, first.id, second.id])).toEqual(before);
  const detached = await bulk([first.identifier, second.identifier], {
    parentIdentifier: null,
  });
  expect(detached.items.map((item) => item.parent)).toEqual([null, null]);
});

it("validates the request shape at the API boundary", async () => {
  const caller = appRouter.createCaller({
    issues: suite.issues,
    catalog: suite.catalog,
    collaboration: new Collaboration(suite.database, suite.unit),
    attachments: new Attachments(
      suite.database,
      suite.unit,
      memoryObjectStore(),
    ),
    requestId: "bulk-shape",
    writesEnabled: () => Promise.resolve(true),
    liveUpdatesEnabled: () => Promise.resolve(false),
  });
  const [issue] = await created(1, "Bulk shape");
  if (issue === undefined) throw new Error("Bulk shape fixture is missing");
  const invalid = [
    {
      identifiers: Array.from(
        { length: 251 },
        (_, index) => `AI-${String(index + 1)}`,
      ),
      patch: { priority: 1 },
    },
    { identifiers: [], patch: { priority: 1 } },
    {
      identifiers: [issue.identifier, issue.identifier],
      patch: { priority: 1 },
    },
    { identifiers: [issue.identifier], patch: { title: "Same for all" } },
    { identifiers: [issue.identifier], patch: { attachmentIds: ["file"] } },
    { identifiers: [issue.identifier], patch: {} },
    { identifiers: [issue.identifier], patch: { addLabels: [] } },
    {
      identifiers: [issue.identifier],
      patch: { priority: 1 },
      expectedRevisions: { "AI-999999": 1 },
    },
    { identifiers: [issue.identifier], patch: { priority: 1 }, title: "x" },
  ];
  for (const input of invalid) {
    const failure: unknown = await caller.issues
      .bulkUpdate({ actor: suite.actor, ...input })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TRPCError);
    expect(failure).toMatchObject({ code: "BAD_REQUEST" });
  }
  const exact = await caller.issues.bulkUpdate({
    actor: suite.actor,
    identifiers: [issue.identifier],
    patch: { archived: true },
  });
  expect(exact.items[0]?.archivedAt).not.toBeNull();
});

it("runs alongside single updates of the same issues without deadlocking", async () => {
  // Neither side changes state, so neither can lose to a state move: the
  // bulk takes the team, state and issue locks, the single update states
  // and one issue.
  for (let round = 0; round < 5; round += 1) {
    const [parent, ...issues] = await created(7, `Bulk race ${String(round)}`);
    const shared = issues[round % issues.length];
    if (parent === undefined || shared === undefined)
      throw new Error("Bulk race fixtures are missing");
    const [bulkResult, singleResult] = await Promise.allSettled([
      bulk(
        issues.map(({ identifier }) => identifier),
        { priority: 1, parentIdentifier: parent.identifier },
      ),
      suite.update(shared.identifier, { priority: 3, dueDate: "2027-01-01" }),
    ]);
    expect(bulkResult.status).toBe("fulfilled");
    expect(singleResult.status).toBe("fulfilled");
    const final = await suite.database.issue.findUniqueOrThrow({
      where: { id: shared.id },
    });
    expect(final.revision).toBe(shared.revision + 2);
    expect(final.parentId).toBe(parent.id);
    expect(final.dueDate?.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect([1, 3]).toContain(final.priority);
    // The event that produced the final revision describes the final row.
    const events = await suite.database.event.findMany({
      where: { issueId: shared.id, action: "updated" },
    });
    expect(events).toHaveLength(2);
    expect(events.map(({ after }) => after)).toContainEqual(
      expect.objectContaining({
        revision: final.revision,
        priority: final.priority,
      }),
    );
  }
});
