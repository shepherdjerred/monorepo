import { describe, expect, test } from "vitest";
import { groupActors } from "./actor-order.ts";
import { branchName, issueUrl, joinLines } from "./copy-formats.ts";
import {
  emptySelection,
  extendSelection,
  selectAll,
  selectedInOrder,
  selectionScope,
  selectionStore,
  toggleSelected,
} from "./selection.ts";

const order = ["AI-1", "AI-2", "AI-3", "AI-4", "AI-5"];
const ids = (selection: { ids: ReadonlySet<string> }) =>
  selectedInOrder({ ...emptySelection, ...selection }, order);

describe("selection", () => {
  test("x toggles one issue and anchors the next range there", () => {
    const one = toggleSelected(emptySelection, "AI-2");
    expect(ids(one)).toEqual(["AI-2"]);
    expect(one.anchor).toBe("AI-2");
    expect(ids(toggleSelected(one, "AI-2"))).toEqual([]);
  });

  test("Shift extends from the anchor and shrinks when it turns back", () => {
    const start = toggleSelected(emptySelection, "AI-2");
    const down = extendSelection(start, order, "AI-2", "AI-4");
    expect(ids(down)).toEqual(["AI-2", "AI-3", "AI-4"]);
    const back = extendSelection(down, order, "AI-4", "AI-3");
    expect(ids(back)).toEqual(["AI-2", "AI-3"]);
    const past = extendSelection(back, order, "AI-3", "AI-1");
    expect(ids(past)).toEqual(["AI-1", "AI-2"]);
  });

  test("a range keeps what was picked before it", () => {
    const picked = toggleSelected(emptySelection, "AI-5");
    const range = extendSelection(
      { ...picked, anchor: undefined },
      order,
      "AI-1",
      "AI-2",
    );
    expect(ids(range)).toEqual(["AI-1", "AI-2", "AI-5"]);
  });

  test("an extension without an anchor starts at the focused issue", () => {
    expect(ids(extendSelection(emptySelection, order, "AI-3", "AI-4"))).toEqual(
      ["AI-3", "AI-4"],
    );
    // An issue the list no longer shows cannot anchor a range.
    expect(extendSelection(emptySelection, order, "AI-9", "AI-4")).toBe(
      emptySelection,
    );
  });

  test("select all picks every shown issue, in order", () => {
    expect(ids(selectAll(order))).toEqual(order);
  });

  test("a selection belongs to its list, not to a peek on it", () => {
    expect(selectionScope("/issues", "?team=AI&peek=AI-1")).toBe(
      selectionScope("/issues", "?team=AI"),
    );
    expect(selectionScope("/issues", "?team=SJ")).not.toBe(
      selectionScope("/issues", "?team=AI"),
    );
    selectionStore.update("a", (value) => toggleSelected(value, "AI-1"));
    expect(ids(selectionStore.read("a"))).toEqual(["AI-1"]);
    expect(selectionStore.read("b")).toBe(emptySelection);
    selectionStore.update("a", () => emptySelection);
  });
});

const actor = (
  key: string,
  kind: string,
  name: string,
  lastSeenAt: string,
) => ({
  key,
  kind,
  name,
  lastSeenAt,
});

describe("actor order", () => {
  const actors = [
    actor("claude-code:old", "agent", "Claude", "2026-01-01"),
    actor("human:alex", "human", "Alex", "2026-01-02"),
    actor("claude-code:new", "agent", "Claude", "2026-03-01"),
    actor("codex:only", "agent", "Codex", "2026-02-01"),
    actor("human:jerred", "human", "Jerred", "2026-04-01"),
    actor("claude-code:mid", "agent", "Claude", "2026-02-15"),
  ];

  test("people come first, then each harness with its newest session", () => {
    const groups = groupActors(actors, { query: "", expanded: new Set() });
    expect(groups.map(({ key }) => key)).toEqual([
      "people",
      "claude-code",
      "codex",
    ]);
    expect(groups[0]?.actors.map(({ key }) => key)).toEqual([
      "human:jerred",
      "human:alex",
    ]);
    expect(groups[1]?.actors.map(({ key }) => key)).toEqual([
      "claude-code:new",
    ]);
    expect(groups[1]?.hidden).toBe(2);
    expect(groups[2]?.hidden).toBe(0);
  });

  test("an expanded harness or a query shows every session", () => {
    const expanded = groupActors(actors, {
      query: "",
      expanded: new Set(["claude-code"]),
    });
    expect(expanded[1]?.actors.map(({ key }) => key)).toEqual([
      "claude-code:new",
      "claude-code:mid",
      "claude-code:old",
    ]);
    const searched = groupActors(actors, {
      query: "claude",
      expanded: new Set(),
    });
    expect(searched.map(({ key }) => key)).toEqual(["claude-code"]);
    expect(searched[0]?.actors).toHaveLength(3);
  });
});

describe("copy formats", () => {
  test("a branch name is the identifier and title in kebab case", () => {
    expect(branchName("AI-12", "Polish the issue creation flow")).toBe(
      "ai-12-polish-the-issue-creation-flow",
    );
    expect(branchName("AI-3", "Café: résumé & naïve — “quotes”!")).toBe(
      "ai-3-cafe-resume-naive-quotes",
    );
  });

  test("a long title is cut at a word to at most 60 characters", () => {
    const branch = branchName(
      "AI-104",
      "Investigate worker restart during reconciliation of every namespace in the cluster",
    );
    expect(branch.length).toBeLessThanOrEqual(60);
    expect(branch).toBe(
      "ai-104-investigate-worker-restart-during-reconciliation-of",
    );
    expect(branchName("AI-1", "a".repeat(80))).toBe("ai-1");
  });

  test("links and lists of several issues", () => {
    expect(issueUrl("https://tracker.example", "AI-1")).toBe(
      "https://tracker.example/issues/AI-1",
    );
    expect(joinLines(["AI-1", "AI-2"])).toBe("AI-1\nAI-2");
  });
});
