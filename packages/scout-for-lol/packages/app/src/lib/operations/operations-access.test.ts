import { describe, expect, test } from "vitest";
import {
  operationsAccessNotice,
  operationsNavVisible,
  resolveOperationsAccess,
} from "#src/lib/operations/operations-access.ts";
import { consumerNavigationItems } from "#src/lib/routes/app-navigation.ts";

/**
 * The console's two gates are not the same gate, and these keep them apart:
 * the flag can only hide, and the allowlist is what refuses. A non-operator is
 * refused with the flag in any state, so a hidden console never implies the
 * reader would otherwise have been let in.
 */

function trpcError(code: string, message = "nope"): unknown {
  return { message, data: { code } };
}

const CONSUMER_NAV = {
  exploreAvailable: false,
  profilesAvailable: false,
  challengesAvailable: false,
  bucksAvailable: false,
};

describe("reading the probe", () => {
  test("an answer opens the console", () => {
    expect(resolveOperationsAccess({ hasData: true, error: null })).toEqual({
      kind: "open",
    });
  });

  test("a flagged-off console is hidden, not refused", () => {
    expect(
      resolveOperationsAccess({
        hasData: false,
        error: trpcError("NOT_FOUND"),
      }),
    ).toEqual({ kind: "hidden" });
  });

  test("a non-operator is refused", () => {
    expect(
      resolveOperationsAccess({
        hasData: false,
        error: trpcError("FORBIDDEN"),
      }),
    ).toEqual({ kind: "not-authorized" });
  });

  test("no session is its own answer", () => {
    expect(
      resolveOperationsAccess({
        hasData: false,
        error: trpcError("UNAUTHORIZED"),
      }),
    ).toEqual({ kind: "signed-out" });
  });

  test("an unreadable failure keeps the server's message", () => {
    expect(
      resolveOperationsAccess({
        hasData: false,
        error: trpcError("INTERNAL_SERVER_ERROR", "boom"),
      }),
    ).toEqual({ kind: "unreadable", message: "boom" });
  });

  test("an answer outlives a later failure", () => {
    // react-query keeps the last data alongside a refetch error; shutting a
    // working console on a transient failure would be the wrong reading.
    expect(
      resolveOperationsAccess({
        hasData: true,
        error: trpcError("INTERNAL_SERVER_ERROR"),
      }),
    ).toEqual({ kind: "open" });
  });

  test("nothing yet is loading", () => {
    expect(resolveOperationsAccess({ hasData: false, error: null })).toEqual({
      kind: "loading",
    });
  });
});

describe("the sidebar", () => {
  test("offers Operations only when the server would serve it", () => {
    expect(
      consumerNavigationItems({
        ...CONSUMER_NAV,
        operationsAvailable: operationsNavVisible({ kind: "open" }),
      }),
    ).toEqual([{ label: "Operations", to: "/operations/matches" }]);
  });

  test("hides the link when the flag is off", () => {
    expect(operationsNavVisible({ kind: "hidden" })).toBe(false);
    expect(
      consumerNavigationItems({
        ...CONSUMER_NAV,
        operationsAvailable: operationsNavVisible({ kind: "hidden" }),
      }),
    ).toEqual([]);
  });

  test("hides the link for every other answer too", () => {
    for (const access of [
      { kind: "not-authorized" },
      { kind: "signed-out" },
      { kind: "loading" },
      { kind: "unreadable", message: "boom" },
    ] as const) {
      expect(operationsNavVisible(access)).toBe(false);
    }
  });

  test("an app with no operations answer looks exactly as it did before", () => {
    expect(
      consumerNavigationItems({ ...CONSUMER_NAV, exploreAvailable: true }),
    ).toEqual([{ label: "Explore", to: "/explore" }]);
  });
});

describe("what the route says instead", () => {
  test("open and loading say nothing", () => {
    expect(operationsAccessNotice({ kind: "open" })).toBeNull();
    expect(operationsAccessNotice({ kind: "loading" })).toBeNull();
  });

  test("a refusal is stated plainly, without implying hiding is security", () => {
    const notice = operationsAccessNotice({ kind: "not-authorized" });
    expect(notice?.title).toBe("You are not a Scout operator");
    expect(notice?.message).toContain("Git-managed operator list");
  });

  test("a hidden console says only that it is unavailable here", () => {
    const notice = operationsAccessNotice({ kind: "hidden" });
    expect(notice?.message).toBe(
      "The match operations console is not available here.",
    );
    // Never naming the flag, the stage, or the allowlist: identical bytes ship
    // everywhere and this answer is what a stranger sees.
    expect(notice?.message).not.toContain("flag");
    expect(notice?.message).not.toContain("operator");
  });
});
