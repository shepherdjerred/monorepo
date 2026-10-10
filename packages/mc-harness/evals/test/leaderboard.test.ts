import { describe, expect, it } from "vitest";
import {
  judgeFingerprint,
  rubricAxisIds,
  scoreFingerprint,
} from "#build/judge.ts";
import {
  ScoreRecordSchema,
  type Entry,
  type ScoreRecord,
  type TournamentFile,
} from "#evals/bench/lib/entries.ts";
import {
  leaderboardIndex,
  renderLeaderboard,
} from "#evals/bench/lib/leaderboard.ts";

/** A micro score of 3 on every axis but depth; the total follows from the axes. */
function score(model: string, depth: number): ScoreRecord {
  const ids = rubricAxisIds("micro");
  const axes = Object.fromEntries(
    ids.map((id) => [id, id === "depth" ? depth : 3]),
  );
  return {
    at: "2026-10-07T00:00:00.000Z",
    model,
    judge: scoreFingerprint("micro"),
    rubric: "micro",
    sheetSha256: "s",
    axes,
    overallAesthetic: 2,
    total: ids.reduce((sum, id) => sum + (axes[id] ?? 0), 0),
    max: 5 * ids.length,
    notes: [],
  };
}

function entry(id: string, anchor = false): Entry {
  return {
    dir: `/bench/${id}`,
    sheet: `/bench/${id}/sheet.jpg`,
    sheetSha256: "s",
    scores: anchor
      ? []
      : [
          // Another model's score of the same sheet: not this board's judge.
          { ...score("other", 1), judge: scoreFingerprint("micro") },
          score("stub", 3),
        ],
    meta: {
      id,
      task: "e2",
      rubric: "micro",
      anchor,
      weak: anchor,
      head: "abcdef0123",
      agent: anchor ? null : "codex",
      model: null,
      runId: anchor ? null : "run1",
      collectedAt: "2026-10-07T00:00:00.000Z",
      source: null,
      licence: null,
      seconds: anchor ? null : 300,
      usage: anchor
        ? null
        : {
            inputTokens: 1_200_000,
            cachedInputTokens: 0,
            outputTokens: 40_000,
          },
      checks: { passed: 4, total: 4 },
      lint: { errors: 0, warnings: 2, codes: ["W_MONOTONE"] },
      gridHash: "h",
      size: { x: 10, y: 10, z: 10 },
      blocks: 500,
      repetition: 0.1,
      schematic: null,
    },
  };
}

const tournament: TournamentFile = {
  at: "2026-10-07T01:00:00.000Z",
  task: "e2",
  rubric: "micro",
  model: "stub",
  judge: judgeFingerprint("micro"),
  entries: ["anchor-watchtower", "abcdef0123-codex-run1"],
  anchors: ["anchor-watchtower"],
  sheets: { "anchor-watchtower": "s", "abcdef0123-codex-run1": "s" },
  pairs: [
    {
      a: "anchor-watchtower",
      b: "abcdef0123-codex-run1",
      winner: "a",
      confidence: 0.8,
      agreed: true,
      reasons: [],
    },
  ],
  ratings: {
    "anchor-watchtower": { rating: 1000, lo: 980, hi: 1020, games: 1, wins: 1 },
    "abcdef0123-codex-run1": {
      rating: 900,
      lo: 850,
      hi: 950,
      games: 1,
      wins: 0,
    },
  },
};

describe("leaderboard", () => {
  it.each(["add", "remove", "reclassify"])(
    "invalidates ratings on anchor %s but preserves independent scores",
    (change) => {
      const agent = entry("abcdef0123-codex-run1");
      const anchor = entry("anchor-watchtower", true);
      const entries =
        change === "add"
          ? [agent, anchor, entry("anchor-new", true)]
          : change === "remove"
            ? [agent]
            : [agent, entry("anchor-watchtower")];
      const board = {
        task: "e2",
        rubric: "micro" as const,
        entries,
        tournament,
      };
      const indexed = leaderboardIndex([board])[0]?.entries;
      expect(indexed?.every((item) => item.rating === null)).toBe(true);
      expect(
        indexed?.find((item) => item.id === agent.meta.id)?.absolute?.total,
      ).toBe(24);
      expect(renderLeaderboard([board])).toContain("anchors changed");
    },
  );

  it("retains ratings when anchors only change order", () => {
    const extra = entry("anchor-new", true);
    const board = {
      task: "e2",
      rubric: "micro" as const,
      entries: [
        extra,
        entry("anchor-watchtower", true),
        entry("abcdef0123-codex-run1"),
      ],
      tournament: {
        ...tournament,
        anchors: ["anchor-watchtower", "anchor-new"],
        sheets: { ...tournament.sheets, "anchor-new": "s" },
      },
    };
    expect(
      leaderboardIndex([board])[0]?.entries.find(
        (item) => item.id === "abcdef0123-codex-run1",
      )?.rating?.rating,
    ).toBe(900);
  });
  it("renders anchors bold, ranks by rating and shows the axes in rubric order", () => {
    const markdown = renderLeaderboard([
      {
        task: "e2",
        rubric: "micro",
        entries: [
          entry("abcdef0123-codex-run1"),
          entry("anchor-watchtower", true),
        ],
        tournament,
      },
    ]);
    const lines = markdown.split("\n");
    const anchorRow = lines.findIndex((line) =>
      line.startsWith("| **anchor-watchtower** (weak)"),
    );
    const agentRow = lines.findIndex((line) =>
      line.startsWith("| abcdef0123-codex-run1"),
    );
    expect(anchorRow).toBeGreaterThan(0);
    expect(agentRow).toBeGreaterThan(anchorRow);
    expect(lines[agentRow]).toContain("900 [850, 950] (0/1)");
    expect(lines[agentRow]).toContain("24/40 · æ 2");
    expect(lines[agentRow]).toContain("1200k/40k");
    expect(markdown).toContain(
      "lighting siteFit proportion palette texture depth detail silhouette",
    );
  });

  it("withholds a rating and score taken of a sheet that has since changed", () => {
    const replaced = { ...entry("abcdef0123-codex-run1"), sheetSha256: "t" };
    const board = {
      task: "e2",
      rubric: "micro" as const,
      entries: [replaced, entry("anchor-watchtower", true)],
      tournament,
    };
    const lines = renderLeaderboard([board]).split("\n");
    const agentRow = lines.find((line) =>
      line.startsWith("| abcdef0123-codex-run1"),
    );
    expect(agentRow).toContain("sheet changed");
    expect(agentRow).not.toContain("900 [850, 950]");
    expect(agentRow).not.toContain("24/40");
    const index = leaderboardIndex([board]);
    const indexed = index[0]?.entries.find(
      (item) => item.id === "abcdef0123-codex-run1",
    );
    expect(indexed?.rating).toBeNull();
    expect(indexed?.absolute).toBeNull();
  });

  it("withholds every rating when another sheet in the round has changed", () => {
    // The anchor was regenerated: the agent's own sheet is unchanged, but its
    // rating was fitted against the old anchor pixels, so it is stale too.
    const board = {
      task: "e2",
      rubric: "micro" as const,
      entries: [
        entry("abcdef0123-codex-run1"),
        { ...entry("anchor-watchtower", true), sheetSha256: "t" },
      ],
      tournament,
    };
    const lines = renderLeaderboard([board]).split("\n");
    const agentRow = lines.find((line) =>
      line.startsWith("| abcdef0123-codex-run1"),
    );
    expect(agentRow).toContain("a sheet in the round changed");
    expect(agentRow).not.toContain("900 [850, 950]");
    // Its own absolute score was taken of its own, unchanged sheet.
    expect(agentRow).toContain("24/40");
    const anchorRow = lines.find((line) =>
      line.startsWith("| **anchor-watchtower**"),
    );
    expect(anchorRow).toContain("sheet changed");
    expect(
      leaderboardIndex([board])[0]?.entries.every(
        (item) => item.rating === null,
      ),
    ).toBe(true);
  });

  it("withholds ratings from a tournament judged under an earlier prompt", () => {
    const board = {
      task: "e2",
      rubric: "micro" as const,
      entries: [
        entry("abcdef0123-codex-run1"),
        entry("anchor-watchtower", true),
      ],
      tournament: { ...tournament, judge: "0ldjudge0000" },
    };
    const agentRow = renderLeaderboard([board])
      .split("\n")
      .find((line) => line.startsWith("| abcdef0123-codex-run1"));
    expect(agentRow).toContain("judge changed");
    expect(agentRow).not.toContain("900 [850, 950]");
    const indexed = leaderboardIndex([board])[0]?.entries.find(
      (item) => item.id === "abcdef0123-codex-run1",
    );
    expect(indexed?.rating).toBeNull();
  });

  it("rejects a score record whose axes are not exactly the rubric's", () => {
    const good = score("stub", 3);
    expect(ScoreRecordSchema.parse(good)).toEqual(good);
    const { depth: _depth, ...fewer } = good.axes;
    expect(() => ScoreRecordSchema.parse({ ...good, axes: fewer })).toThrow(
      /missing depth/u,
    );
    expect(() =>
      ScoreRecordSchema.parse({ ...good, axes: { ...good.axes, extra: 1 } }),
    ).toThrow(/unknown extra/u);
    expect(() =>
      ScoreRecordSchema.parse({ ...good, total: good.total + 1 }),
    ).toThrow(/not the sum of its axes/u);
    expect(() => ScoreRecordSchema.parse({ ...good, max: 45 })).toThrow(
      /is not 5/u,
    );
  });

  it("indexes the same ranking as JSON", () => {
    const index = leaderboardIndex([
      {
        task: "e2",
        rubric: "micro",
        entries: [
          entry("abcdef0123-codex-run1"),
          entry("anchor-watchtower", true),
        ],
        tournament,
      },
    ]);
    expect(index[0]?.entries.map((item) => item.id)).toEqual([
      "anchor-watchtower",
      "abcdef0123-codex-run1",
    ]);
  });
});
