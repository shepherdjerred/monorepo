import { expect, it } from "vitest";
import {
  CreateIssueSchema,
  IssueListSchema,
  UpdateIssueSchema,
} from "#shared/schema.ts";
import { useTrackerSuite } from "./suite.ts";

const suite = useTrackerSuite("due-dates");
const list = (input: Record<string, unknown>) =>
  suite.issues.list(
    IssueListSchema.parse({ projectSlug: "due-dates", ...input }),
  );
const titles = async (input: Record<string, unknown>) => {
  const page = await list(input);
  return page.items.map(({ title }) => title);
};

it("accepts only real calendar days", () => {
  const base = { actor: suite.actor, teamKey: "AI", title: "Due" };
  for (const dueDate of ["2026-02-28", "2024-02-29", "0001-01-01", null])
    expect(CreateIssueSchema.safeParse({ ...base, dueDate }).success).toBe(
      true,
    );
  for (const dueDate of [
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-00-10",
    "0000-01-01",
    "2026-1-5",
    "2026-01-05T00:00:00.000Z",
    "tomorrow",
    "",
    20_260_105,
  ]) {
    expect(CreateIssueSchema.safeParse({ ...base, dueDate }).success).toBe(
      false,
    );
    expect(
      UpdateIssueSchema.safeParse({
        actor: suite.actor,
        identifier: "AI-1",
        dueDate,
      }).success,
    ).toBe(false);
    expect(IssueListSchema.safeParse({ dueBefore: dueDate }).success).toBe(
      false,
    );
  }
  expect(IssueListSchema.safeParse({ overdue: true }).success).toBe(false);
  expect(IssueListSchema.safeParse({ overdue: false }).success).toBe(false);
  expect(
    IssueListSchema.safeParse({ overdue: true, today: "2026-02-30" }).success,
  ).toBe(false);
  expect(
    IssueListSchema.safeParse({ overdue: true, today: "2026-03-01" }).success,
  ).toBe(true);
});

it("stores, filters, sorts and audits due dates as calendar days", async () => {
  await suite.catalog.project(
    { actor: suite.actor, slug: "due-dates", name: "Due dates" },
    true,
    "due",
  );
  const make = (title: string, dueDate?: string) =>
    suite.create(title, { projectSlug: "due-dates", dueDate });
  const march = await make("march", "2026-03-10");
  await make("none-a");
  await make("january", "2026-01-31");
  const leap = await make("leap", "2024-02-29");
  await make("march-twin", "2026-03-10");
  await make("none-b");
  await make("december", "2026-12-31");
  expect(march.dueDate).toBe("2026-03-10");
  expect(leap.dueDate).toBe("2024-02-29");
  const stored = await suite.database.$queryRaw<{ day: string }[]>`
    SELECT "dueDate"::text AS "day" FROM "Issue" WHERE "id" = ${march.id}`;
  expect(stored).toEqual([{ day: "2026-03-10" }]);
  const detail = await suite.issues.byIdentifier(march.identifier);
  expect(detail.dueDate).toBe("2026-03-10");
  const created = await suite.database.event.findFirstOrThrow({
    where: { issueId: march.id, action: "created" },
  });
  expect(created.after).toMatchObject({ dueDate: "2026-03-10" });

  // Soonest first, undated last, ties and undated rows ordered by ID.
  const all = await list({ sort: "due", limit: "all" });
  const sorted = all.items.map(({ title }) => title);
  expect(sorted.slice(0, 2)).toEqual(["leap", "january"]);
  expect(sorted.slice(2, 4).toSorted()).toEqual(["march", "march-twin"]);
  expect(sorted[4]).toBe("december");
  expect(sorted.slice(5).toSorted()).toEqual(["none-a", "none-b"]);
  for (const limit of [1, 2, 3]) {
    const paged: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await list({ sort: "due", limit, cursor });
      paged.push(...page.items.map(({ title }) => title));
      expect(page.total).toBe(7);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(paged).toEqual(sorted);
  }

  // Bounds are inclusive and never match an issue without a due date.
  expect(await titles({ sort: "due", dueBefore: "2026-01-31" })).toEqual([
    "leap",
    "january",
  ]);
  expect(await titles({ sort: "due", dueBefore: "2026-01-30" })).toEqual([
    "leap",
  ]);
  expect(await titles({ sort: "due", dueAfter: "2026-03-10" })).toHaveLength(3);
  expect(await titles({ sort: "due", dueAfter: "2026-03-11" })).toEqual([
    "december",
  ]);
  expect(
    await titles({
      sort: "due",
      dueAfter: "2026-01-31",
      dueBefore: "2026-03-10",
    }),
  ).toHaveLength(3);
  expect(await titles({ dueAfter: "2027-01-01" })).toEqual([]);

  // Overdue is strictly before the caller's today.
  const today = "2026-03-10";
  expect(await titles({ sort: "due", overdue: true, today })).toEqual([
    "leap",
    "january",
  ]);
  expect(
    await titles({ sort: "due", overdue: true, today: "2026-03-11" }),
  ).toHaveLength(4);
  expect(
    await titles({ sort: "due", overdue: true, today: "2024-02-29" }),
  ).toEqual([]);
  const current = await list({ sort: "due", overdue: false, today });
  expect(current.total).toBe(5);
  expect(
    current.items
      .map(({ title }) => title)
      .slice(0, 2)
      .toSorted(),
  ).toEqual(["march", "march-twin"]);

  const moved = await suite.update(march.identifier, {
    dueDate: "2026-04-01",
  });
  expect(moved.dueDate).toBe("2026-04-01");
  const cleared = await suite.update(march.identifier, { dueDate: null });
  expect(cleared.dueDate).toBeNull();
  const kept = await suite.update(leap.identifier, { title: "leap day" });
  expect(kept.dueDate).toBe("2024-02-29");
  const events = await suite.database.event.findMany({
    where: { issueId: march.id, action: "updated" },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  expect(events.map(({ changes }) => changes)).toMatchObject([
    { dueDate: { from: "2026-03-10", to: "2026-04-01" } },
    { dueDate: { from: "2026-04-01", to: null } },
  ]);
});
