import { describe, expect, test } from "vitest";
import {
  cachedIssue,
  cachedRows,
  forgetIssue,
  issueKey,
  optimistic,
  patchIssue,
  type IssueListData,
} from "./cache.ts";
import {
  boardSlot,
  changePatch,
  changeSummary,
  inverseChange,
} from "./issue-changes.ts";
import {
  cacheFixture,
  cacheSnapshot,
  detailFixture,
  issueFixture,
  workspaceFixture,
} from "./testing.ts";

const list = (client: ReturnType<typeof cacheFixture>) =>
  client.getQueryData<IssueListData>(["issues", { teamKey: "AI" }]);

describe("issue cache", () => {
  test("a patch reaches the detail and each list page that holds the issue", () => {
    const client = cacheFixture();
    const before = list(client);
    patchIssue(client, "AI-1", { title: "Renamed" });
    expect(client.getQueryData(issueKey("AI-1"))).toMatchObject({
      title: "Renamed",
      comments: [],
    });
    expect(list(client)?.pages[0]?.items[0]?.title).toBe("Renamed");
    // The page without the issue is the very same object as before.
    expect(list(client)?.pages[1]).toBe(before?.pages[1]);
    expect(list(client)?.pageParams).toEqual([undefined, "issue-2"]);
  });

  test("patching an issue no list holds leaves every list untouched", () => {
    const client = cacheFixture();
    const before = list(client);
    patchIssue(client, "AI-99", { title: "Nowhere" });
    expect(list(client)).toBe(before);
  });

  test("the newest cached copy of an issue wins", () => {
    const client = cacheFixture();
    client.setQueryData<IssueListData>(["issues", { teamKey: "AI" }], {
      pages: [
        {
          items: [issueFixture(1, { revision: 4, title: "Newer row" })],
          nextCursor: null,
        },
      ],
      pageParams: [undefined],
    });
    expect(cachedIssue(client, "AI-1")?.title).toBe("Newer row");
    expect(cachedRows(client).map((row) => row.revision)).toEqual([4]);
  });

  test("forgetting an issue removes its rows, detail and nothing else", () => {
    const client = cacheFixture();
    forgetIssue(client, "AI-1");
    expect(client.getQueryData(issueKey("AI-1"))).toBeUndefined();
    expect(
      list(client)?.pages.map((page) =>
        page.items.map((row) => row.identifier),
      ),
    ).toEqual([["AI-2"], ["AI-3"]]);
  });

  test("an optimistic step that fails is taken back and still settles", async () => {
    const client = cacheFixture();
    const before = cacheSnapshot(client);
    let settled = 0;
    const outcome = await optimistic({
      apply: () => {
        patchIssue(client, "AI-1", { priority: 1 });
        return () => {
          patchIssue(client, "AI-1", { priority: 0 });
        };
      },
      run: async () => {
        expect(cachedIssue(client, "AI-1")?.priority).toBe(1);
        throw new Error("refused");
      },
      settle: () => {
        settled += 1;
      },
    });
    expect(outcome.ok).toBe(false);
    expect(cacheSnapshot(client)).toEqual(before);
    expect(settled).toBe(1);
  });
});

describe("issue changes", () => {
  const issue = issueFixture(1);

  test("each undoable change has an inverse that restores the previous value", () => {
    expect(inverseChange(issue, { kind: "priority", priority: 2 })).toEqual({
      kind: "priority",
      priority: 0,
      priorityManual: false,
    });
    const pinned = issueFixture(2, {
      priority: 4,
      priorityManual: true,
      impact: "high",
      urgency: "high",
    });
    expect(inverseChange(pinned, { kind: "priorityAuto" })).toEqual({
      kind: "priority",
      priority: 4,
      priorityManual: true,
    });
    expect(inverseChange(pinned, { kind: "urgency", urgency: null })).toEqual({
      kind: "urgency",
      urgency: "high",
    });
    expect(inverseChange(pinned, { kind: "impact", impact: "low" })).toEqual({
      kind: "impact",
      impact: "high",
    });
    expect(inverseChange(issue, { kind: "effort", effort: "m" })).toEqual({
      kind: "effort",
      effort: null,
    });
    expect(
      inverseChange(issue, { kind: "assignee", assigneeKey: "agent:helper" }),
    ).toEqual({ kind: "assignee", assigneeKey: null });
    expect(
      inverseChange(issue, { kind: "project", projectSlug: "toolkit" }),
    ).toEqual({ kind: "project", projectSlug: null });
    expect(
      inverseChange(issue, { kind: "label", name: "bug", add: true }),
    ).toEqual({ kind: "label", name: "bug", add: false });
    expect(inverseChange(issue, { kind: "archive", archived: true })).toEqual({
      kind: "archive",
      archived: false,
    });
    expect(inverseChange(issue, { kind: "title", title: "x" })).toBeUndefined();
  });

  test("urgency, impact, votes and manual overrides resolve priority optimistically", () => {
    const withImpact = {
      ...issue,
      ...changePatch(
        issue,
        { kind: "impact", impact: "high" },
        workspaceFixture,
      ),
    };
    expect(withImpact).toMatchObject({
      impact: "high",
      priority: 2,
      priorityManual: false,
    });
    const withUrgency = {
      ...withImpact,
      ...changePatch(
        withImpact,
        { kind: "urgency", urgency: "high" },
        workspaceFixture,
      ),
    };
    expect(withUrgency).toMatchObject({
      urgency: "high",
      priority: 1,
      priorityManual: false,
    });
    const overridden = {
      ...withUrgency,
      ...changePatch(
        withUrgency,
        { kind: "priority", priority: 4 },
        workspaceFixture,
      ),
    };
    expect(overridden).toMatchObject({ priority: 4, priorityManual: true });
    // While pinned manually, changing urgency does not move priority.
    expect(
      changePatch(
        overridden,
        { kind: "urgency", urgency: "low" },
        workspaceFixture,
      ),
    ).toEqual({ urgency: "low", priority: 4, priorityManual: true });
    expect(
      changeSummary({ kind: "priorityAuto" }, workspaceFixture, overridden),
    ).toBe("priority set to auto (Urgent)");
    expect(
      changePatch(overridden, { kind: "priorityAuto" }, workspaceFixture),
    ).toEqual({ priority: 1, priorityManual: false });
    // Votes promote an auto-sized issue once they cross the threshold.
    const lowSized = detailFixture(
      issueFixture(3, {
        impact: "low",
        urgency: "low",
        priority: 4,
        voteCount: 7,
      }),
    );
    expect(
      changePatch(lowSized, { kind: "vote", voted: true }, workspaceFixture),
    ).toEqual({
      voteCount: 8,
      viewerVoted: true,
      priority: 2,
      priorityManual: false,
    });
  });

  test("a change resolves the records it names from the workspace", () => {
    expect(
      changePatch(
        issue,
        { kind: "assignee", assigneeKey: "agent:helper" },
        workspaceFixture,
      ),
    ).toMatchObject({
      assigneeId: "actor-agent:helper",
      assignee: { name: "Helper" },
    });
    expect(
      changePatch(
        issue,
        { kind: "label", name: "bug", add: true },
        workspaceFixture,
      ).labels?.map(({ name }) => name),
    ).toEqual(["bug"]);
    expect(() =>
      changePatch(
        issue,
        { kind: "state", stateName: "Nonexistent" },
        workspaceFixture,
      ),
    ).toThrow("The workspace has no state Nonexistent");
  });

  test("a card's slot is the pair of cards it sits between in its column", () => {
    const column = [issueFixture(1), issueFixture(2), issueFixture(3)];
    expect(
      boardSlot(column, {
        id: "moved",
        stateId: "state-unstarted",
        boardOrder: 2500,
      }),
    ).toEqual({ beforeId: "issue-2", afterId: "issue-3" });
    expect(
      boardSlot(column, {
        id: "moved",
        stateId: "state-unstarted",
        boardOrder: 1,
      }),
    ).toEqual({ afterId: "issue-1" });
    expect(
      boardSlot(column, {
        id: "moved",
        stateId: "state-completed",
        boardOrder: 1,
      }),
    ).toEqual({});
  });
});
