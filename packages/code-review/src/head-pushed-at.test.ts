import { describe, expect, test } from "bun:test";
import {
  parseActivityPage,
  parseHeadRepo,
  pickRefUpdateTime,
  reactionBoundToHead,
  resolveHeadPushedAt,
} from "./head-pushed-at.ts";

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** Build a `data.repository` record matching HEAD_REF_UPDATED_AT_QUERY. */
function repository(input: {
  forcePushes?: { createdAt: string; afterCommit: string }[];
}): Record<string, unknown> {
  return {
    pullRequest: {
      headRefName: "feature/x",
      headRepository: { nameWithOwner: "octocat/repo" },
      timelineItems: {
        nodes: (input.forcePushes ?? []).map((f) => ({
          createdAt: f.createdAt,
          afterCommit: { oid: f.afterCommit },
        })),
      },
    },
  };
}

describe("resolveHeadPushedAt", () => {
  test("uses the activity ref-update time when it is the only signal", () => {
    // The ordinary fast-forward case: the Activity-API timestamp is the real
    // head-push time. (Previously null → the at-head 👍 could never bind.)
    expect(
      resolveHeadPushedAt(repository({}), HEAD, "2026-07-26T23:30:00Z"),
    ).toBe("2026-07-26T23:30:00Z");
  });

  test("uses a matching force-push event when there is no ref-update time", () => {
    expect(
      resolveHeadPushedAt(
        repository({
          forcePushes: [
            { createdAt: "2026-07-26T23:45:00Z", afterCommit: HEAD },
          ],
        }),
        HEAD,
        null,
      ),
    ).toBe("2026-07-26T23:45:00Z");
  });

  test("takes the LATEST of the ref-update time and a force-push event", () => {
    expect(
      resolveHeadPushedAt(
        repository({
          forcePushes: [
            { createdAt: "2026-07-26T23:45:00Z", afterCommit: HEAD },
          ],
        }),
        HEAD,
        "2026-07-26T22:00:00Z",
      ),
    ).toBe("2026-07-26T23:45:00Z");
  });

  test("ignores a force-push event whose afterCommit is a different sha", () => {
    expect(
      resolveHeadPushedAt(
        repository({
          forcePushes: [
            { createdAt: "2026-07-26T23:45:00Z", afterCommit: OTHER },
          ],
        }),
        HEAD,
        null,
      ),
    ).toBeNull();
  });

  test("returns null (unbound) when no ref-update signal is available", () => {
    // Must NOT fall back to any commit-embedded timestamp: staying unbound is
    // the safe direction (gate keeps reviewing) vs. a false completion.
    expect(resolveHeadPushedAt(repository({}), HEAD, null)).toBeNull();
    expect(resolveHeadPushedAt(null, HEAD, null)).toBeNull();
  });

  test("honors the ref-update time even when the repository record is null", () => {
    expect(resolveHeadPushedAt(null, HEAD, "2026-07-26T23:30:00Z")).toBe(
      "2026-07-26T23:30:00Z",
    );
  });
});

describe("pickRefUpdateTime", () => {
  test("returns the latest timestamp whose `after` equals the head", () => {
    expect(
      pickRefUpdateTime(
        [
          {
            after: HEAD,
            timestamp: "2026-07-26T23:00:00Z",
            activity_type: "push",
          },
          {
            after: HEAD,
            timestamp: "2026-07-26T23:30:00Z",
            activity_type: "force_push",
          },
          {
            after: OTHER,
            timestamp: "2026-07-27T00:00:00Z",
            activity_type: "push",
          },
        ],
        HEAD,
      ),
    ).toBe("2026-07-26T23:30:00Z");
  });

  test("ignores rows with a null `after` (e.g. branch_deletion)", () => {
    expect(
      pickRefUpdateTime(
        [
          { after: null, timestamp: "2026-07-27T00:00:00Z" },
          { after: HEAD, timestamp: "2026-07-26T23:00:00Z" },
        ],
        HEAD,
      ),
    ).toBe("2026-07-26T23:00:00Z");
  });

  test("returns null when no activity targets the head", () => {
    expect(
      pickRefUpdateTime(
        [{ after: OTHER, timestamp: "2026-07-26T23:00:00Z" }],
        HEAD,
      ),
    ).toBeNull();
    expect(pickRefUpdateTime([], HEAD)).toBeNull();
  });
});

describe("parseActivityPage", () => {
  test("accepts a valid page (extra keys stripped), a null `after`, and an empty page", () => {
    expect(
      parseActivityPage([
        {
          after: HEAD,
          timestamp: "2026-07-26T23:00:00Z",
          activity_type: "push",
          ref: "refs/heads/x",
        },
        { after: null, timestamp: "2026-07-26T22:00:00Z" },
      ]),
    ).toEqual([
      { after: HEAD, timestamp: "2026-07-26T23:00:00Z" },
      { after: null, timestamp: "2026-07-26T22:00:00Z" },
    ]);
    expect(parseActivityPage([])).toEqual([]);
  });

  test("throws on a non-array payload (contract regression)", () => {
    expect(() => parseActivityPage({ message: "Not Found" })).toThrow();
    expect(() => parseActivityPage(null)).toThrow();
  });

  test("throws on an item missing a required field", () => {
    // A missing `after` KEY (vs. an explicit null) is still a contract
    // regression, as is a missing timestamp.
    expect(() => parseActivityPage([{ after: HEAD }])).toThrow();
    expect(() =>
      parseActivityPage([{ timestamp: "2026-07-26T23:00:00Z" }]),
    ).toThrow();
  });
});

describe("parseHeadRepo", () => {
  test("returns nameWithOwner for a valid head repository", () => {
    expect(parseHeadRepo({ nameWithOwner: "octocat/fork" })).toBe(
      "octocat/fork",
    );
  });

  test("returns null when the head repo is gone (null)", () => {
    expect(parseHeadRepo(null)).toBeNull();
  });

  test("throws on a malformed head-repository shape (contract regression)", () => {
    expect(() => parseHeadRepo({ full_name: "octocat/fork" })).toThrow();
    expect(() => parseHeadRepo({ nameWithOwner: 123 })).toThrow();
    expect(() => parseHeadRepo("octocat/fork")).toThrow();
  });
});

describe("reactionBoundToHead", () => {
  const headPushedAt = "2026-07-26T23:30:00Z";

  test("a 👍 created before the real head-push time stays stale (does NOT bind)", () => {
    expect(reactionBoundToHead("2026-07-26T23:00:00Z", headPushedAt)).toBe(
      false,
    );
  });

  test("a 👍 created at/after the head-push time binds", () => {
    expect(reactionBoundToHead("2026-07-26T23:53:00Z", headPushedAt)).toBe(
      true,
    );
    expect(reactionBoundToHead(headPushedAt, headPushedAt)).toBe(true);
  });

  test("a null head-push time never binds", () => {
    expect(reactionBoundToHead("2026-07-26T23:53:00Z", null)).toBe(false);
  });

  test("a null or unparseable reaction time never binds", () => {
    expect(reactionBoundToHead(null, headPushedAt)).toBe(false);
    expect(reactionBoundToHead("not-a-date", headPushedAt)).toBe(false);
  });
});
