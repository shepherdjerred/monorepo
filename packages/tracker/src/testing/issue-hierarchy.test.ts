import { expect, it } from "vitest";
import { MAX_ISSUE_DEPTH } from "#domain/issue.ts";
import { TrackerError } from "#domain/error.ts";
import {
  CreateIssueSchema,
  IssueListSchema,
  UpdateIssueSchema,
} from "#shared/schema.ts";
import { useTrackerSuite } from "./suite.ts";

const suite = useTrackerSuite("hierarchy");
const list = (input: Record<string, unknown>) =>
  suite.issues.list(IssueListSchema.parse(input));
const identifiers = async (input: Record<string, unknown>) => {
  const page = await list(input);
  return page.items.map(({ identifier }) => identifier);
};
const child = (title: string, parentIdentifier: string) =>
  suite.create(title, { parentIdentifier });
const reparent = (identifier: string, parentIdentifier: string | null) =>
  suite.update(identifier, { parentIdentifier });
const parentChange = async (identifier: string) => {
  const events = await suite.database.event.findMany({
    where: { issueIdentifier: identifier, entityType: "issue" },
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
  });
  return events.find(({ changes }) =>
    JSON.stringify(changes).includes('"parentId"'),
  )?.changes;
};
async function badRequest(work: Promise<unknown>, message: string) {
  const failure: unknown = await work.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(TrackerError);
  expect(failure).toMatchObject({ code: "BAD_REQUEST" });
  expect(String(failure)).toContain(message);
}

it("links sub-issues, reports parents, children and progress, and audits each change", async () => {
  const parent = await suite.create("Hierarchy parent");
  const first = await child("Hierarchy first child", parent.identifier);
  expect(first.parent).toEqual({
    identifier: parent.identifier,
    title: "Hierarchy parent",
  });
  const second = await suite.create("Hierarchy second child", {
    stateType: "completed",
  });
  const linked = await reparent(second.identifier, parent.identifier);
  expect(linked.parentId).toBe(parent.id);
  expect(linked.revision).toBe(second.revision + 1);
  const archived = await child("Hierarchy archived child", parent.identifier);
  await suite.update(archived.identifier, { archived: true });

  const created = await suite.database.event.findFirstOrThrow({
    where: { issueId: first.id, action: "created" },
  });
  expect(created.after).toMatchObject({
    parentId: parent.id,
    parent: { identifier: parent.identifier },
  });
  expect(await parentChange(second.identifier)).toMatchObject({
    parentId: { from: null, to: parent.id },
    parent: { from: null, to: { identifier: parent.identifier } },
  });

  const detail = await suite.issues.byIdentifier(parent.identifier);
  expect(detail.parent).toBeNull();
  expect(detail.childCount).toBe(2);
  expect(detail.completedChildCount).toBe(1);
  // Board order: workflow position first, so the open child precedes Done.
  expect(detail.children).toMatchObject([
    {
      identifier: first.identifier,
      title: "Hierarchy first child",
      priority: 0,
      assignee: null,
      state: { type: "triage" },
    },
    { identifier: second.identifier, state: { type: "completed" } },
  ]);
  const found = await list({ search: parent.identifier });
  expect(found.items[0]).toMatchObject({
    childCount: 2,
    completedChildCount: 1,
  });

  expect(await identifiers({ parentIdentifier: parent.identifier })).toEqual(
    expect.arrayContaining([first.identifier, second.identifier]),
  );
  expect(
    await identifiers({
      parentIdentifier: parent.identifier,
      includeArchived: true,
    }),
  ).toHaveLength(3);
  const children = await identifiers({ hasParent: true });
  expect(children).toContain(first.identifier);
  expect(children).not.toContain(parent.identifier);
  const roots = await identifiers({ hasParent: false, limit: "all" });
  expect(roots).toContain(parent.identifier);
  expect(roots).not.toContain(first.identifier);

  const detached = await reparent(second.identifier, null);
  expect(detached.parent).toBeNull();
  expect(await parentChange(second.identifier)).toMatchObject({
    parentId: { from: parent.id, to: null },
  });
  const untouched = await suite.update(first.identifier, { title: "Renamed" });
  expect(untouched.parentId).toBe(parent.id);
});

it("rejects self-parenting, cycles, other teams, unknown and archived parents", async () => {
  const top = await suite.create("Cycle top");
  const middle = await child("Cycle middle", top.identifier);
  const bottom = await child("Cycle bottom", middle.identifier);
  await badRequest(reparent(top.identifier, top.identifier), "own parent");
  await badRequest(
    reparent(top.identifier, middle.identifier),
    "own descendant",
  );
  await badRequest(
    reparent(top.identifier, bottom.identifier),
    "own descendant",
  );
  const foreign = await suite.issues.create(
    CreateIssueSchema.parse({
      actor: suite.actor,
      teamKey: "SJ",
      title: "Other team",
    }),
    "foreign",
  );
  await badRequest(
    reparent(bottom.identifier, foreign.identifier),
    "same team",
  );
  await badRequest(child("Cross-team child", foreign.identifier), "same team");
  await badRequest(child("Orphan", "AI-999999"), "Unknown parent issue");
  await badRequest(
    reparent(bottom.identifier, "AI-999999"),
    "Unknown parent issue",
  );
  await suite.update(middle.identifier, { archived: true });
  await badRequest(child("Late child", middle.identifier), "archived");
  const loose = await suite.create("Loose issue");
  await badRequest(reparent(loose.identifier, middle.identifier), "archived");
  // An archived parent keeps the sub-issues it already has.
  const kept = await suite.update(bottom.identifier, {
    parentIdentifier: middle.identifier,
    title: "Cycle bottom, renamed",
  });
  expect(kept.parent?.identifier).toBe(middle.identifier);
  expect(
    await suite.database.event.count({
      where: { issueId: { in: [top.id, loose.id] }, action: "updated" },
    }),
  ).toBe(0);
});

it("caps nesting depth for new children and for moved subtrees", async () => {
  const {
    top: root,
    bottom: deepest,
    issues,
  } = await chain("Depth", MAX_ISSUE_DEPTH);
  await badRequest(child("Too deep", deepest.identifier), "levels deep");
  const pair = await suite.create("Pair top");
  await child("Pair bottom", pair.identifier);
  const fourth = issues[3];
  const third = issues[2];
  if (fourth === undefined || third === undefined)
    throw new Error("Missing chain");
  // A two-level subtree fits under level 3 but not under level 4.
  await badRequest(reparent(pair.identifier, fourth.identifier), "levels deep");
  const moved = await reparent(pair.identifier, third.identifier);
  expect(moved.parent?.identifier).toBe(third.identifier);
  // The whole chain cannot hang below another issue.
  const extra = await suite.create("Extra root");
  await badRequest(reparent(root.identifier, extra.identifier), "levels deep");
});

it("detaches sub-issues when their parent is deleted", async () => {
  const parent = await suite.create("Doomed parent");
  const first = await child("Surviving child A", parent.identifier);
  const second = await child("Surviving child B", parent.identifier);
  await suite.issues.delete(
    {
      actor: suite.actor,
      identifier: parent.identifier,
      expectedRevision: parent.revision,
    },
    "delete-parent",
  );
  for (const survivor of [first, second]) {
    const detail = await suite.issues.byIdentifier(survivor.identifier);
    expect(detail.parentId).toBeNull();
    expect(detail.parent).toBeNull();
  }
  const deleted = await suite.database.event.findFirstOrThrow({
    where: { requestId: "delete-parent", action: "deleted" },
  });
  expect(JSON.stringify(deleted.before)).toContain("Surviving child A");
});

/** Creates a chain of issues, each the parent of the next. */
async function chain(name: string, length: number, stateType = "triage") {
  const issues = [await suite.create(`${name} 1`, { stateType })];
  for (let level = 2; level <= length; level += 1) {
    const above = issues.at(-1);
    if (above === undefined) throw new Error("Missing chain");
    issues.push(await child(`${name} ${String(level)}`, above.identifier));
  }
  const [top, bottom] = [issues[0], issues.at(-1)];
  if (top === undefined || bottom === undefined)
    throw new Error("Missing chain");
  return { top, bottom, issues };
}
/**
 * A mutation first updates its actor's row and then locks the edited issue's
 * workflow state, either of which would serialize two transactions on its
 * own. Racing transactions therefore use distinct actors and edit issues in
 * different states.
 */
const racing = (session: string, identifier: string, parent: string) =>
  suite.issues.update(
    UpdateIssueSchema.parse({
      actor: { ...suite.actor, key: `codex:racer-${session}` },
      identifier,
      parentIdentifier: parent,
    }),
    crypto.randomUUID(),
  );
const fulfilled = (results: PromiseSettledResult<unknown>[]) =>
  results.filter(({ status }) => status === "fulfilled").length;

it("never lets concurrent re-parenting build a cycle or exceed the depth cap", async () => {
  for (let round = 0; round < 4; round += 1) {
    // The two transactions lock the same pair of issues.
    const a = await suite.create(`Race A ${String(round)}`, {
      stateType: "backlog",
    });
    const b = await suite.create(`Race B ${String(round)}`, {
      stateType: "started",
    });
    const direct = await Promise.allSettled([
      racing("one", a.identifier, b.identifier),
      racing("two", b.identifier, a.identifier),
    ]);
    expect(fulfilled(direct)).toBe(1);

    // Each is valid alone and they lock disjoint issues, but together they
    // would close the loop X1 > Y2 > Y1 > X2 > X1.
    const x = await chain(`Race X ${String(round)}`, 2, "backlog");
    const y = await chain(`Race Y ${String(round)}`, 2, "started");
    const loop = await Promise.allSettled([
      racing("one", x.top.identifier, y.bottom.identifier),
      racing("two", y.top.identifier, x.bottom.identifier),
    ]);
    expect(fulfilled(loop)).toBe(1);
    const tops = await suite.database.issue.findMany({
      where: { id: { in: [x.top.id, y.top.id] } },
    });
    expect(tops.filter(({ parentId }) => parentId !== null)).toHaveLength(1);

    // Each fits alone (3 + 2 and 2 + 2 levels); both would make seven.
    const upper = await chain(`Race upper ${String(round)}`, 3);
    const middle = await chain(`Race middle ${String(round)}`, 2, "backlog");
    const lower = await chain(`Race lower ${String(round)}`, 2, "started");
    const stacked = await Promise.allSettled([
      racing("one", middle.top.identifier, upper.bottom.identifier),
      racing("two", lower.top.identifier, middle.bottom.identifier),
    ]);
    expect(fulfilled(stacked)).toBe(1);
    const depth = await suite.database.$queryRaw<{ depth: number }[]>`
      WITH RECURSIVE tree AS (
        SELECT "id", 1 AS depth FROM "Issue" WHERE "id" = ${upper.top.id}
        UNION ALL
        SELECT i."id", tree.depth + 1 FROM "Issue" i JOIN tree ON i."parentId" = tree."id"
      ) SELECT max(depth)::int AS "depth" FROM tree`;
    expect(depth[0]?.depth).toBeLessThanOrEqual(MAX_ISSUE_DEPTH);
  }
});
