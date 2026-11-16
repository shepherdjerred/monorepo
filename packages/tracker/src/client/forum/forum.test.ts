import { describe, expect, test } from "vitest";
import {
  expiryDelay,
  fromLocalDateTimeValue,
  groupForumReplies,
  presetLocalDateTime,
  toLocalDateTimeValue,
} from "./data.ts";
import {
  noProjectFilterValue,
  readForumFilters,
  toForumListInput,
  updateForumParams,
} from "./forum-params.ts";

const makeStubReply = (
  id: string,
  parentReplyId: string | null,
  deleted = false,
) => ({
  id,
  parentReplyId,
  deleted,
});

describe("datetime-local conversion", () => {
  test("round-trips local datetime-local input to ISO UTC minute precision", () => {
    const baseIso = "2026-11-20T18:45:00.000Z";
    const local = toLocalDateTimeValue(baseIso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u);
    expect(fromLocalDateTimeValue(local)).toBe(baseIso);
  });

  test("handles empty and invalid inputs cleanly", () => {
    expect(toLocalDateTimeValue(null)).toBe("");
    expect(toLocalDateTimeValue("")).toBe("");
    expect(fromLocalDateTimeValue("")).toBeNull();
    expect(fromLocalDateTimeValue("not-a-date")).toBeNull();
    const preset = presetLocalDateTime(2, Date.parse("2026-11-20T10:00:00Z"));
    expect(fromLocalDateTimeValue(preset)).toBe("2026-11-20T12:00:00.000Z");
  });
});

describe("forum URL filter params", () => {
  test("switches default status from active to all when searching unless explicit", () => {
    const initial = readForumFilters(new URLSearchParams());
    expect(initial.state).toBe("active");
    expect(initial.explicitState).toBe(false);

    const withSearch = readForumFilters(
      updateForumParams(new URLSearchParams(), { q: "dispatcher" }),
    );
    expect(withSearch.state).toBe("all");

    const explicitActive = readForumFilters(
      new URLSearchParams("q=dispatcher&state=active"),
    );
    expect(explicitActive.state).toBe("active");
    expect(explicitActive.explicitState).toBe(true);
  });

  test("maps URL filters to ForumListSchema input", () => {
    const filters = readForumFilters(
      new URLSearchParams(
        `kind=question&state=unanswered&project=${noProjectFilterValue}&scope=ci&sort=votes&inbox=1&unread=1`,
      ),
    );
    expect(toForumListInput(filters, "human:jerred")).toEqual({
      kind: "question",
      scopes: ["ci"],
      state: "unanswered",
      projectSlug: null,
      unreadOnly: true,
      subscribedOnly: true,
      viewerActorKey: "human:jerred",
      sort: "votes",
      limit: 50,
    });
  });
});

describe("two-level reply grouping and expiryDelay", () => {
  test("preserves tombstoned top-level replies and groups child replies beneath", () => {
    const grouped = groupForumReplies([
      makeStubReply("r1", null, true),
      makeStubReply("r2", "r1", false),
      makeStubReply("r3", null, false),
    ]);
    expect(grouped.topLevel.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(grouped.childrenByParent.get("r1")?.map((r) => r.id)).toEqual([
      "r2",
    ]);
  });

  test("computes positive expiry delay for open unexpired notices", () => {
    const checkedAt = "2026-11-16T00:00:00.000Z";
    const expiresAt = "2026-11-16T00:00:05.000Z";
    const delay = expiryDelay(
      [{ state: "open", expired: false, expiresAt }],
      checkedAt,
      Date.now(),
    );
    expect(typeof delay).toBe("number");
  });
});
