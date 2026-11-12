import { describe, expect, test } from "vitest";
import { ViewParamsSchema } from "#shared/schema.ts";
import { workspaceFixture } from "#client/data/testing.ts";
import {
  hasViewParams,
  moveView,
  reorderTo,
  scopedParams,
  viewMatches,
  viewParamsFrom,
  viewUrl,
  visibleViews,
  type SavedView,
} from "./view-params.ts";

const me = "human:jerred";

function creator() {
  const actor = workspaceFixture.actors[0];
  if (actor === undefined) {
    throw new Error("The fixture has no actors");
  }
  return actor;
}

function view(
  id: string,
  position: number,
  fields: Partial<SavedView> = {},
): SavedView {
  return {
    id,
    name: id,
    icon: "list",
    params: {},
    teamKey: null,
    position,
    createdBy: creator(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...fields,
  };
}

describe("view parameters", () => {
  test("a list address becomes allowed issues.list names", () => {
    const search = new URLSearchParams(
      "team=AI&state=Todo&state=Backlog&label=bug&mine=true&priority=1&q=crash&archived=true&subissues=hide&due=overdue&sort=due&group=priority&collapsed=1&hide=labels&peek=AI-3",
    );
    const params = viewParamsFrom(search, { board: false, teamKey: "AI", me });
    expect(params).toEqual({
      teamKey: "AI",
      states: ["Backlog", "Todo"],
      labels: ["bug"],
      assigneeKey: me,
      priority: "1",
      search: "crash",
      includeArchived: "true",
      hasParent: "false",
      overdue: "true",
      sort: "due",
      group: "priority",
    });
    // The server's allow-list accepts every key built here.
    expect(ViewParamsSchema.safeParse(params).success).toBe(true);
  });

  test("relative due filters are stored as words, and come back", () => {
    for (const due of ["overdue", "today", "week", "none", "2026-12-01"]) {
      const params = viewParamsFrom(new URLSearchParams({ due }), {
        board: true,
        teamKey: "AI",
        me,
      });
      expect(ViewParamsSchema.safeParse(params).success).toBe(true);
      const url = new URL(
        viewUrl({ id: "v", params }, { teamKey: "AI", me }),
        "https://tracker.test",
      );
      expect(url.pathname).toBe("/board");
      expect(url.searchParams.get("due")).toBe(due);
    }
  });

  test("a view opens its own page and filters, with the viewer as me", () => {
    const url = new URL(
      viewUrl(
        {
          id: "v1",
          params: {
            teamKey: "SJ",
            states: ["Todo"],
            assigneeKey: me,
            hasParent: "false",
          },
        },
        { teamKey: "AI", me },
      ),
      "https://tracker.test",
    );
    expect(url.pathname).toBe("/issues");
    expect(url.searchParams.get("team")).toBe("SJ");
    expect(url.searchParams.getAll("state")).toEqual(["Todo"]);
    expect(url.searchParams.get("mine")).toBe("true");
    expect(url.searchParams.get("subissues")).toBe("hide");
    expect(url.searchParams.get("saved")).toBe("v1");
    // A global view opens in the team in view.
    const global = new URL(
      viewUrl({ id: "v2", params: { priority: "1" } }, { teamKey: "AI", me }),
      "https://tracker.test",
    );
    expect(global.searchParams.get("team")).toBe("AI");
  });

  test("matching ignores the team only for a global view, and the order of values", () => {
    const current = viewParamsFrom(
      new URLSearchParams("state=Todo&state=Backlog&priority=2"),
      { board: false, teamKey: "AI", me },
    );
    expect(
      viewMatches(
        view("global", 0, {
          params: { states: ["Todo", "Backlog"], priority: "2" },
        }),
        current,
      ),
    ).toBe(true);
    expect(
      viewMatches(
        view("team", 0, {
          teamKey: "SJ",
          params: { teamKey: "SJ", states: ["Backlog", "Todo"], priority: "2" },
        }),
        current,
      ),
    ).toBe(false);
    expect(viewMatches(view("other", 0, { params: {} }), current)).toBe(false);
    expect(hasViewParams({ teamKey: "AI" })).toBe(false);
    expect(hasViewParams(current)).toBe(true);
    expect(scopedParams(current, null)).not.toHaveProperty("teamKey");
    expect(scopedParams(current, "SJ")).toMatchObject({ teamKey: "SJ" });
  });
});

describe("view order", () => {
  const views = [
    view("a", 0, { teamKey: "AI" }),
    view("b", 1, { teamKey: "SJ" }),
    view("c", 2),
    view("d", 3, { teamKey: "AI" }),
  ];

  test("a team sees its own views and the global ones, in order", () => {
    expect(visibleViews(views, "AI").map(({ id }) => id)).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  test("moving among the shown views keeps every view in the full order", () => {
    const shown = visibleViews(views, "AI");
    expect(moveView(views, shown, "a", 1)).toEqual(["b", "c", "a", "d"]);
    expect(moveView(views, shown, "d", -1)).toEqual(["a", "b", "d", "c"]);
    expect(moveView(views, shown, "a", -1)).toBeUndefined();
    expect(moveView(views, shown, "d", 1)).toBeUndefined();
    expect(reorderTo(views, "d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(reorderTo(views, "a", "a")).toBeUndefined();
  });
});
