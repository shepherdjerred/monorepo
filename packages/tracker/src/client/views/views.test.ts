import { describe, expect, test } from "vitest";
import { issueFixture, workspaceFixture } from "#client/data/testing.ts";
import {
  readDisplay,
  toggleCollapsed,
  writeDisplay,
} from "./display-options.ts";
import {
  filterChips,
  filterValues,
  setFilter,
  toggleFilterValue,
  viewPrefill,
} from "./filters.ts";
import { buildRows, type ListRow } from "./grouping.ts";

const [todo, started, done] = workspaceFixture.states;
if (todo === undefined || started === undefined || done === undefined) {
  throw new Error("The fixture workspace has three states");
}
const project = workspaceFixture.projects[0] ?? null;
const items = [
  issueFixture(1, { state: started, stateId: started.id, priority: 2 }),
  issueFixture(2, { priority: 1, project }),
  issueFixture(3, { state: started, stateId: started.id, priority: 0 }),
  issueFixture(4, { priority: 2 }),
];
const describeRow = (row: ListRow) =>
  row.kind === "group"
    ? `# ${row.label} ${String(row.count)}${row.collapsed ? " (collapsed)" : ""}`
    : `${String(row.position)} ${row.issue.identifier}`;

describe("grouping", () => {
  test("status groups follow the workflow and show empty statuses", () => {
    const { rows, issues } = buildRows(items, {
      groupBy: "status",
      collapsed: new Set(),
      states: [done, started, todo],
      today: "2026-11-11",
    });
    expect(rows.map((row) => describeRow(row))).toEqual([
      "# Todo 2",
      "1 AI-2",
      "2 AI-4",
      "# In progress 2",
      "3 AI-1",
      "4 AI-3",
      "# Done 0",
    ]);
    expect(rows.at(-1)).toMatchObject({ kind: "group", empty: true });
    expect(issues.map(({ identifier }) => identifier)).toEqual([
      "AI-2",
      "AI-4",
      "AI-1",
      "AI-3",
    ]);
  });

  test("a collapsed group keeps its count, and its rows leave the positions", () => {
    const { rows, issues } = buildRows(items, {
      groupBy: "priority",
      collapsed: new Set(["2"]),
      states: workspaceFixture.states,
      today: "2026-11-11",
    });
    expect(rows.map((row) => describeRow(row))).toEqual([
      "# Urgent 1",
      "1 AI-2",
      "# High 2 (collapsed)",
      "# No priority 1",
      "2 AI-3",
    ]);
    expect(issues).toHaveLength(2);
  });

  test("project and assignee groups put the missing value last", () => {
    const { rows } = buildRows(items, {
      groupBy: "project",
      collapsed: new Set(),
      states: workspaceFixture.states,
      today: "2026-11-11",
    });
    expect(
      rows
        .filter(({ kind }) => kind === "group")
        .map((row) => describeRow(row)),
    ).toEqual(["# Toolkit 1", "# No project 3"]);
    const ungrouped = buildRows(items, {
      groupBy: "none",
      collapsed: new Set(),
      states: workspaceFixture.states,
      today: "2026-11-11",
    });
    expect(ungrouped.rows.map((row) => describeRow(row))).toEqual([
      "1 AI-1",
      "2 AI-2",
      "3 AI-3",
      "4 AI-4",
    ]);
  });
});

describe("display options", () => {
  test("defaults stay out of the address", () => {
    const params = new URLSearchParams("team=AI");
    expect(readDisplay(params)).toMatchObject({
      groupBy: "status",
      sort: "updated",
    });
    const written = writeDisplay(params, {
      groupBy: "status",
      sort: "updated",
    });
    expect(written.toString()).toBe("team=AI");
  });

  test("grouping, collapsed groups and hidden properties round-trip", () => {
    let params = writeDisplay(new URLSearchParams("team=AI"), {
      groupBy: "priority",
      hidden: new Set(["date", "labels"]),
      sort: "created",
    });
    params = toggleCollapsed(params, "2");
    params = toggleCollapsed(params, "0");
    expect(params.toString()).toBe(
      "team=AI&group=priority&hide=labels&hide=date&sort=created&collapsed=0&collapsed=2",
    );
    const display = readDisplay(params);
    expect(display.groupBy).toBe("priority");
    expect([...display.collapsed].sort()).toEqual(["0", "2"]);
    expect([...display.hidden]).toEqual(["labels", "date"]);
    // Another grouping has other groups.
    expect(
      readDisplay(writeDisplay(params, { groupBy: "project" })).collapsed.size,
    ).toBe(0);
    expect(readDisplay(new URLSearchParams("group=bogus")).groupBy).toBe(
      "status",
    );
  });
});

describe("filters", () => {
  test("chips read the filter parameters links have always used", () => {
    const params = new URLSearchParams(
      "team=AI&state=In+progress&state=Todo&label=bug&mine=true&priority=1&project=toolkit&archived=true&creator=agent%3Ahelper",
    );
    expect(
      filterChips(params, workspaceFixture).map(({ text }) => text),
    ).toEqual([
      "Status is In progress, Todo",
      "Priority is Urgent",
      "Assignee is me",
      "Creator is Helper",
      "Label has bug",
      "Project is Toolkit",
      "Archived issues included",
    ]);
    const labels = new URLSearchParams("label=bug&label=feature");
    expect(filterChips(labels, workspaceFixture)[0]?.text).toBe(
      "Labels have bug and feature",
    );
  });

  test("removing a chip removes exactly its parameters", () => {
    const params = new URLSearchParams(
      "team=AI&state=Todo&mine=true&sort=created&peek=AI-1",
    );
    expect(setFilter(params, "assignee", []).toString()).toBe(
      "team=AI&state=Todo&sort=created",
    );
    expect(setFilter(params, "state", []).toString()).toBe(
      "team=AI&mine=true&sort=created",
    );
  });

  test("multi-value filters toggle; single ones swap", () => {
    let params = new URLSearchParams("team=AI");
    params = toggleFilterValue(params, "state", "Todo");
    params = toggleFilterValue(params, "state", "Done");
    expect(filterValues(params, "state")).toEqual(["Todo", "Done"]);
    params = toggleFilterValue(params, "state", "Todo");
    expect(filterValues(params, "state")).toEqual(["Done"]);
    params = toggleFilterValue(params, "priority", "1");
    params = toggleFilterValue(params, "priority", "3");
    expect(params.getAll("priority")).toEqual(["3"]);
    params = toggleFilterValue(params, "assignee", "me");
    expect(params.get("mine")).toBe("true");
    params = toggleFilterValue(params, "assignee", "agent:helper");
    expect(params.has("mine")).toBe(false);
    expect(params.get("assignee")).toBe("agent:helper");
  });

  test("a new issue starts with what the view filters on", () => {
    const params = new URLSearchParams(
      "state=Todo&label=bug&mine=true&priority=2",
    );
    expect(
      viewPrefill(params, {
        teamKey: "AI",
        projectSlug: "toolkit",
        me: "human:jerred",
      }),
    ).toEqual({
      teamKey: "AI",
      stateName: "Todo",
      priority: 2,
      projectSlug: "toolkit",
      labels: ["bug"],
      assigneeKey: "human:jerred",
    });
    // Two statuses leave the status to the team's default.
    expect(
      viewPrefill(new URLSearchParams("state=Todo&state=Done"), {
        teamKey: "AI",
        projectSlug: undefined,
        me: "human:jerred",
      }),
    ).toEqual({ teamKey: "AI" });
  });
});
