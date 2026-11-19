import { describe, expect, test } from "vitest";
import { issueFixture, workspaceFixture } from "#client/data/testing.ts";
import {
  compareIssuesBySort,
  defaultSortDirection,
  oppositeSortDirection,
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

  test("urgency, impact and effort groups order from strongest or smallest to missing", () => {
    const sized = [
      issueFixture(1, { urgency: "low", impact: null, effort: "xl" }),
      issueFixture(2, { urgency: null, impact: "high", effort: "xs" }),
      issueFixture(3, { urgency: "high", impact: "medium", effort: null }),
      issueFixture(4, { urgency: "medium", impact: "low", effort: "m" }),
    ];
    expect(
      buildRows(sized, {
        groupBy: "urgency",
        collapsed: new Set(),
        states: workspaceFixture.states,
        today: "2026-11-11",
      })
        .rows.filter(({ kind }) => kind === "group")
        .map((row) => describeRow(row)),
    ).toEqual(["# High 1", "# Medium 1", "# Low 1", "# No urgency 1"]);
    expect(
      buildRows(sized, {
        groupBy: "impact",
        collapsed: new Set(),
        states: workspaceFixture.states,
        today: "2026-11-11",
      })
        .rows.filter(({ kind }) => kind === "group")
        .map((row) => describeRow(row)),
    ).toEqual(["# High 1", "# Medium 1", "# Low 1", "# No impact 1"]);
    expect(
      buildRows(sized, {
        groupBy: "effort",
        collapsed: new Set(),
        states: workspaceFixture.states,
        today: "2026-11-11",
      })
        .rows.filter(({ kind }) => kind === "group")
        .map((row) => describeRow(row)),
    ).toEqual(["# XS 1", "# M 1", "# XL 1", "# No effort 1"]);
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
    const effortDisplay = readDisplay(
      writeDisplay(new URLSearchParams(), {
        groupBy: "effort",
        hidden: new Set(["effort"]),
        sort: "effort",
      }),
    );
    expect(effortDisplay.groupBy).toBe("effort");
    expect(effortDisplay.sort).toBe("effort");
    expect([...effortDisplay.hidden]).toEqual(["effort"]);
  });

  test("sort direction omits defaults, reverses cleanly and keeps missing values last", () => {
    expect(defaultSortDirection("updated")).toBe("desc");
    expect(defaultSortDirection("priority")).toBe("asc");
    expect(defaultSortDirection("title")).toBe("asc");
    expect(defaultSortDirection("number")).toBe("desc");
    expect(oppositeSortDirection("asc")).toBe("desc");

    const reversedUpdated = writeDisplay(new URLSearchParams("team=AI"), {
      sortDir: "asc",
    });
    expect(reversedUpdated.toString()).toBe("team=AI&dir=asc");
    expect(readDisplay(reversedUpdated)).toMatchObject({
      sort: "updated",
      sortDir: "asc",
    });

    // Switching sort resets dir unless explicitly supplied.
    const toEffort = writeDisplay(reversedUpdated, { sort: "effort" });
    expect(toEffort.toString()).toBe("team=AI&sort=effort");
    const reversedEffort = writeDisplay(toEffort, { sortDir: "desc" });
    expect(reversedEffort.toString()).toBe("team=AI&sort=effort&dir=desc");
    expect(readDisplay(reversedEffort)).toMatchObject({
      sort: "effort",
      sortDir: "desc",
      boardSort: "effort",
      boardSortDir: "desc",
    });

    // Board manual sort omits both sort and dir.
    expect(
      writeDisplay(reversedEffort, { boardSort: "board" }).toString(),
    ).toBe("team=AI");

    // Direction-only changes on a list URL with a raw board sort fall back to updated.
    expect(
      writeDisplay(new URLSearchParams("sort=board"), {
        sortDir: "asc",
      }).toString(),
    ).toBe("dir=asc");

    // Active text searches preserve explicit Updated ordering instead of falling back to relevance.
    const searched = new URLSearchParams("team=AI&q=login");
    expect(readDisplay(searched).hasExplicitSort).toBe(false);
    const searchExplicitUpdated = writeDisplay(searched, { sort: "updated" });
    expect(searchExplicitUpdated.toString()).toBe(
      "team=AI&q=login&sort=updated",
    );
    expect(readDisplay(searchExplicitUpdated)).toMatchObject({
      sort: "updated",
      sortDir: "desc",
      hasExplicitSort: true,
    });
    const searchUpdatedAsc = writeDisplay(searchExplicitUpdated, {
      sortDir: "asc",
    });
    expect(searchUpdatedAsc.toString()).toBe(
      "team=AI&q=login&sort=updated&dir=asc",
    );
    const searchUpdatedBackToDesc = writeDisplay(searchUpdatedAsc, {
      sortDir: "desc",
    });
    expect(searchUpdatedBackToDesc.toString()).toBe(
      "team=AI&q=login&sort=updated",
    );
    expect(readDisplay(searchUpdatedBackToDesc).hasExplicitSort).toBe(true);
    expect(
      writeDisplay(searchUpdatedBackToDesc, { clearSort: true }).toString(),
    ).toBe("team=AI&q=login");

    const sample = [
      issueFixture(1, {
        title: "charlie",
        priority: 0,
        effort: null,
        dueDate: null,
        voteCount: 2,
      }),
      issueFixture(2, {
        title: "Alpha",
        priority: 3,
        effort: "xl",
        dueDate: "2026-12-10",
        voteCount: 5,
      }),
      issueFixture(3, {
        title: "bravo",
        priority: 1,
        effort: "xs",
        dueDate: "2026-12-01",
        voteCount: 1,
      }),
    ];
    const orderBy = (
      sort: Parameters<typeof compareIssuesBySort>[2],
      dir: "asc" | "desc",
    ) =>
      sample
        .toSorted((a, b) => compareIssuesBySort(a, b, sort, dir))
        .map(({ identifier }) => identifier);

    // Missing priority, effort and due date stay last in both directions.
    expect(orderBy("priority", "asc")).toEqual(["AI-3", "AI-2", "AI-1"]);
    expect(orderBy("priority", "desc")).toEqual(["AI-2", "AI-3", "AI-1"]);
    expect(orderBy("effort", "asc")).toEqual(["AI-3", "AI-2", "AI-1"]);
    expect(orderBy("effort", "desc")).toEqual(["AI-2", "AI-3", "AI-1"]);
    expect(orderBy("due", "asc")).toEqual(["AI-3", "AI-2", "AI-1"]);
    expect(orderBy("due", "desc")).toEqual(["AI-2", "AI-3", "AI-1"]);
    expect(orderBy("title", "asc")).toEqual(["AI-2", "AI-3", "AI-1"]);
    expect(orderBy("title", "desc")).toEqual(["AI-1", "AI-3", "AI-2"]);
    expect(orderBy("number", "asc")).toEqual(["AI-1", "AI-2", "AI-3"]);
    expect(orderBy("number", "desc")).toEqual(["AI-3", "AI-2", "AI-1"]);
    expect(orderBy("votes", "desc")).toEqual(["AI-2", "AI-1", "AI-3"]);
    expect(orderBy("votes", "asc")).toEqual(["AI-3", "AI-1", "AI-2"]);
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
    const sizingParams = new URLSearchParams(
      "urgency=high&impact=none&effort=xs&effort=s",
    );
    expect(
      filterChips(sizingParams, workspaceFixture).map(({ text }) => text),
    ).toEqual(["Urgency is High", "Impact is No impact", "Effort is XS, S"]);
    expect(
      viewPrefill(new URLSearchParams("urgency=high&impact=none&effort=xs"), {
        teamKey: "AI",
        projectSlug: undefined,
        me: "human:jerred",
      }),
    ).toEqual({ teamKey: "AI", urgency: "high", effort: "xs" });
  });
});
