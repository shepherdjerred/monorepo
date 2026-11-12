import { describe, expect, test } from "vitest";
import type { IssueDetailData } from "#client/data/api.ts";
import {
  cachedIssue,
  invalidateIssue,
  issueKey,
  parentsOf,
  patchIssue,
  type IssueListData,
} from "#client/data/cache.ts";
import {
  changePatch,
  changeSlice,
  changeSummary,
  inverseChange,
} from "#client/data/issue-changes.ts";
import { bulkSummary, planBulk } from "#client/data/bulk-changes.ts";
import {
  cacheFixture,
  detailFixture,
  issueFixture,
  workspaceFixture,
} from "#client/data/testing.ts";

const done = workspaceFixture.states[2];

describe("parent and due date edits", () => {
  const child = issueFixture(5, {
    parentId: "issue-1",
    parent: { identifier: "AI-1", title: "Issue 1" },
    dueDate: "2026-11-20",
  });
  const catalog = {
    ...workspaceFixture,
    issue: (identifier: string) =>
      identifier === "AI-2" ? issueFixture(2) : undefined,
  };

  test("a new parent shows by identifier and, when cached, its title", () => {
    expect(
      changePatch(child, { kind: "parent", parentIdentifier: "AI-2" }, catalog),
    ).toEqual({
      parent: { identifier: "AI-2", title: "Issue 2" },
      parentId: "issue-2",
    });
    expect(
      changePatch(child, { kind: "parent", parentIdentifier: "AI-9" }, catalog),
    ).toEqual({
      parent: { identifier: "AI-9", title: "" },
      parentId: "optimistic-AI-9",
    });
    expect(
      changePatch(child, { kind: "parent", parentIdentifier: null }, catalog),
    ).toEqual({ parent: null, parentId: null });
  });

  test("each is undone by restoring the value it replaced", () => {
    expect(
      inverseChange(child, { kind: "parent", parentIdentifier: "AI-2" }),
    ).toEqual({ kind: "parent", parentIdentifier: "AI-1" });
    expect(inverseChange(child, { kind: "due", dueDate: null })).toEqual({
      kind: "due",
      dueDate: "2026-11-20",
    });
    expect(
      inverseChange(issueFixture(6), { kind: "due", dueDate: "2026-12-01" }),
    ).toEqual({ kind: "due", dueDate: null });
    expect(changeSlice(child, { kind: "due", dueDate: null })).toEqual({
      dueDate: "2026-11-20",
    });
    expect(
      changePatch(child, { kind: "due", dueDate: "2026-12-01" }, catalog),
    ).toEqual({ dueDate: "2026-12-01" });
  });

  test("toasts say what changed", () => {
    expect(
      changeSummary({ kind: "parent", parentIdentifier: "AI-2" }, catalog),
    ).toBe("moved under AI-2");
    expect(
      changeSummary({ kind: "parent", parentIdentifier: null }, catalog),
    ).toBe("parent removed");
    expect(changeSummary({ kind: "due", dueDate: null }, catalog)).toBe(
      "due date cleared",
    );
  });

  test("a bulk due date skips issues already due then and undoes to each one's date", () => {
    const issues = [
      child,
      issueFixture(6, { dueDate: "2026-12-01" }),
      issueFixture(7),
    ];
    const { changes, inverses } = planBulk(issues, {
      kind: "due",
      dueDate: "2026-12-01",
    });
    expect(changes.map(([identifier]) => identifier)).toEqual(["AI-5", "AI-7"]);
    expect(inverses).toEqual([
      ["AI-5", { kind: "due", dueDate: "2026-11-20" }],
      ["AI-7", { kind: "due", dueDate: null }],
    ]);
    expect(bulkSummary({ kind: "due", dueDate: null }, 2, catalog)).toBe(
      "Cleared the due date of 2 issues",
    );
    expect(
      bulkSummary({ kind: "parent", parentIdentifier: "AI-1" }, 3, catalog),
    ).toBe("Moved 3 issues under AI-1");
  });
});

/** AI-1 as a parent with AI-2 under it, cached as a detail and in lists. */
function parentFixture() {
  const client = cacheFixture();
  const child = issueFixture(2, {
    parentId: "issue-1",
    parent: { identifier: "AI-1", title: "Issue 1" },
  });
  client.setQueryData<IssueDetailData>(issueKey("AI-1"), {
    ...detailFixture(issueFixture(1, { childCount: 1 })),
    children: [
      {
        identifier: "AI-2",
        title: child.title,
        state: child.state,
        priority: 0,
        assignee: null,
      },
    ],
  });
  client.setQueryData<IssueListData>(["issues", { teamKey: "AI" }], {
    pages: [
      {
        items: [issueFixture(1, { childCount: 1 }), child, issueFixture(3)],
        nextCursor: null,
      },
    ],
    pageParams: [undefined],
  });
  return client;
}

const parentDetail = (client: ReturnType<typeof cacheFixture>) =>
  client.getQueryData<IssueDetailData>(issueKey("AI-1"));
const parentRow = (client: ReturnType<typeof cacheFixture>) =>
  client
    .getQueryData<IssueListData>(["issues", { teamKey: "AI" }])
    ?.pages[0]?.items.find(({ identifier }) => identifier === "AI-1");

describe("a cached parent follows its sub-issues", () => {
  test("completing a sub-issue moves the parent's progress at once", () => {
    const client = parentFixture();
    if (done === undefined) {
      throw new Error("The fixture has no completed state");
    }
    patchIssue(client, "AI-2", { state: done, stateId: done.id });
    expect(parentDetail(client)?.children[0]?.state.name).toBe("Done");
    expect(parentDetail(client)?.completedChildCount).toBe(1);
    expect(parentRow(client)?.completedChildCount).toBe(1);
  });

  test("a sub-issue moved away or archived leaves the list; one moved in joins it", () => {
    const client = parentFixture();
    patchIssue(client, "AI-2", { parent: null, parentId: null });
    expect(parentDetail(client)?.children).toEqual([]);
    expect(parentRow(client)?.childCount).toBe(0);
    patchIssue(client, "AI-3", {
      parent: { identifier: "AI-1", title: "Issue 1" },
      parentId: "issue-1",
    });
    expect(
      parentDetail(client)?.children.map(({ identifier }) => identifier),
    ).toEqual(["AI-3"]);
    patchIssue(client, "AI-3", { archivedAt: "2026-11-11T00:00:00.000Z" });
    expect(parentDetail(client)?.childCount).toBe(0);
  });

  test("an edit to a sub-issue refetches its cached parent", () => {
    const client = parentFixture();
    expect(parentsOf(client, "AI-2")).toEqual(["AI-1"]);
    invalidateIssue(client, "AI-2");
    expect(client.getQueryState(issueKey("AI-1"))?.isInvalidated).toBe(true);
    expect(cachedIssue(client, "AI-3")?.parent).toBeNull();
    expect(parentsOf(client, "AI-3")).toEqual([]);
  });
});
