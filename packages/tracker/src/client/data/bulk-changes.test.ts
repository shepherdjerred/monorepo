import { describe, expect, test } from "vitest";
import {
  bulkLabelChange,
  bulkSummary,
  groupEdits,
  planBulk,
} from "./bulk-changes.ts";
import { issueFixture, workspaceFixture } from "./testing.ts";

const label = (name: string) => {
  const found = workspaceFixture.labels.find((item) => item.name === name);
  if (found === undefined) {
    throw new Error(`No ${name} label`);
  }
  return found;
};

describe("bulk edits", () => {
  test("one change becomes per-issue edits whose inverses restore each issue", () => {
    const issues = [
      issueFixture(1, { priority: 0 }),
      issueFixture(2, { priority: 3 }),
      issueFixture(3, { priority: 1 }),
    ];
    const { changes, inverses } = planBulk(issues, {
      kind: "priority",
      priority: 1,
    });
    expect(changes.map(([identifier]) => identifier)).toEqual(["AI-1", "AI-2"]);
    expect(inverses).toEqual([
      ["AI-1", { kind: "priority", priority: 0 }],
      ["AI-2", { kind: "priority", priority: 3 }],
    ]);
  });

  test("issues the change would not alter are left out of the edit and its undo", () => {
    const assigned = issueFixture(1, {
      assignee: workspaceFixture.actors[0] ?? null,
    });
    const { changes, inverses } = planBulk([assigned, issueFixture(2)], {
      kind: "assignee",
      assigneeKey: "human:jerred",
    });
    expect(changes.map(([identifier]) => identifier)).toEqual(["AI-2"]);
    expect(inverses).toEqual([
      ["AI-2", { kind: "assignee", assigneeKey: null }],
    ]);
  });

  test("a label is added unless every issue has it, and then removed", () => {
    const bug = label("bug");
    const some = [issueFixture(1, { labels: [bug] }), issueFixture(2)];
    expect(bulkLabelChange(some, "bug")).toEqual({
      kind: "label",
      name: "bug",
      add: true,
    });
    const all = [
      issueFixture(1, { labels: [bug] }),
      issueFixture(2, { labels: [bug] }),
    ];
    const change = bulkLabelChange(all, "bug");
    expect(change).toEqual({ kind: "label", name: "bug", add: false });
    expect(planBulk(all, change).inverses).toEqual([
      ["AI-1", { kind: "label", name: "bug", add: true }],
      ["AI-2", { kind: "label", name: "bug", add: true }],
    ]);
  });

  test("the toast names the change and how many issues it covers", () => {
    expect(
      bulkSummary(
        { kind: "state", stateName: "In progress" },
        12,
        workspaceFixture,
      ),
    ).toBe("Set 12 issues to In progress");
    expect(
      bulkSummary({ kind: "priority", priority: 1 }, 3, workspaceFixture),
    ).toBe("Set 3 issues to Urgent");
    expect(
      bulkSummary(
        { kind: "assignee", assigneeKey: "human:jerred" },
        2,
        workspaceFixture,
      ),
    ).toBe("Assigned 2 issues to Jerred");
    expect(
      bulkSummary({ kind: "archive", archived: true }, 1, workspaceFixture),
    ).toBe("Archived 1 issue");
  });

  test("an undo sends one request per distinct previous value", () => {
    const { inverses } = planBulk(
      [
        issueFixture(1, { priority: 0 }),
        issueFixture(2, { priority: 3 }),
        issueFixture(3, { priority: 0 }),
      ],
      { kind: "priority", priority: 1 },
    );
    expect(groupEdits(inverses)).toEqual([
      {
        change: { kind: "priority", priority: 0 },
        identifiers: ["AI-1", "AI-3"],
      },
      { change: { kind: "priority", priority: 3 }, identifiers: ["AI-2"] },
    ]);
  });
});
