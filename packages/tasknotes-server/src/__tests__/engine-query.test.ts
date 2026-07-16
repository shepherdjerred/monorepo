import { describe, expect, test } from "bun:test";
import { resolveModelConfig } from "tasknotes-types/v2";
import type { TaskInfo } from "tasknotes-types/v2";

import { FilterQuerySchema, evaluateQuery } from "../engine/query.ts";

const config = resolveModelConfig();

function task(overrides: Partial<TaskInfo> & { path: string }): TaskInfo {
  return {
    title: overrides.path,
    status: "open",
    priority: "normal",
    archived: false,
    ...overrides,
  };
}

const TASKS: TaskInfo[] = [
  task({
    path: "a.md",
    title: "Water plants",
    status: "open",
    due: "2026-07-01",
    tags: ["task", "home"],
    priority: "high",
  }),
  task({
    path: "b.md",
    title: "File taxes",
    status: "done",
    due: "2026-07-10",
    projects: ["Finance"],
  }),
  task({ path: "c.md", title: "Idea dump", status: "open" }),
];

function query(children: unknown[], extra: Record<string, unknown> = {}) {
  return FilterQuerySchema.parse({
    type: "group",
    id: "root",
    conjunction: "and",
    children,
    ...extra,
  });
}

function condition(
  property: string,
  operator: string,
  value: unknown = null,
): Record<string, unknown> {
  return { type: "condition", id: "c", property, operator, value };
}

describe("FilterQuerySchema", () => {
  test("rejects unknown properties and operators (route turns this into 400)", () => {
    expect(
      FilterQuerySchema.safeParse(
        query([]) && {
          type: "group",
          id: "r",
          conjunction: "and",
          children: [condition("bogus", "is", "x")],
        },
      ).success,
    ).toBe(false);
    expect(
      FilterQuerySchema.safeParse({
        type: "group",
        id: "r",
        conjunction: "and",
        children: [condition("status", "resembles", "x")],
      }).success,
    ).toBe(false);
  });

  test("accepts user-mapped properties (user:effort)", () => {
    expect(
      FilterQuerySchema.safeParse({
        type: "group",
        id: "r",
        conjunction: "and",
        children: [condition("user:effort", "is", "high")],
      }).success,
    ).toBe(true);
  });
});

describe("evaluateQuery", () => {
  test("empty group matches everything", () => {
    expect(evaluateQuery(query([]), TASKS, config)).toHaveLength(3);
  });

  test("condition + conjunctions + nested groups", () => {
    const q = query(
      [
        condition("status", "is", "open"),
        {
          type: "group",
          id: "g",
          conjunction: "or",
          children: [
            condition("tags", "contains", "home"),
            condition("title", "contains", "idea"),
          ],
        },
      ],
      {},
    );
    const hits = evaluateQuery(q, TASKS, config).map((t) => t.path);
    expect(hits.sort()).toEqual(["a.md", "c.md"]);
  });

  test("date operators compare the date part", () => {
    const q = query([condition("due", "is-on-or-before", "2026-07-05")]);
    expect(evaluateQuery(q, TASKS, config).map((t) => t.path)).toEqual([
      "a.md",
    ]);
  });

  test("is-empty / status.isCompleted / is-not", () => {
    const noDue = evaluateQuery(
      query([condition("due", "is-empty")]),
      TASKS,
      config,
    );
    expect(noDue.map((t) => t.path)).toEqual(["c.md"]);

    const completed = evaluateQuery(
      query([condition("status.isCompleted", "is-checked")]),
      TASKS,
      config,
    );
    expect(completed.map((t) => t.path)).toEqual(["b.md"]);

    const notOpen = evaluateQuery(
      query([condition("status", "is-not", "open")]),
      TASKS,
      config,
    );
    expect(notOpen.map((t) => t.path)).toEqual(["b.md"]);
  });

  test("sorting by due asc puts undefined last; desc reverses", () => {
    const asc = evaluateQuery(
      query([], { sortKey: "due", sortDirection: "asc" }),
      TASKS,
      config,
    );
    expect(asc.map((t) => t.path)).toEqual(["a.md", "b.md", "c.md"]);
    const desc = evaluateQuery(
      query([], { sortKey: "due", sortDirection: "desc" }),
      TASKS,
      config,
    );
    expect(desc.map((t) => t.path)).toEqual(["b.md", "a.md", "c.md"]);
  });
});
