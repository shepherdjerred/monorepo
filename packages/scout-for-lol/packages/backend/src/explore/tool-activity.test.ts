import { describe, expect, test } from "vitest";
import { EXPLORE_ACTIVITY_MAX_LENGTH } from "@scout-for-lol/data";
import {
  toolCallActivity,
  toolResultActivity,
  toolStartActivity,
} from "#src/explore/tool-activity.ts";
import type { ExploreToolResultInspection } from "#src/explore/tool-inspection.ts";

/**
 * Every tool whose calls can reach the status line. The generic phrase each
 * one falls back to is supplied by `stream.ts`; what matters here is that no
 * input shape can make these functions throw, return nothing, or overrun the
 * cap — all three of which fail at the SSE boundary by silently detaching the
 * reader's browser rather than by raising anything visible.
 */
const TOOL_NAMES = [
  "get_report_language",
  "validate_report_query",
  "format_report_query",
  "run_report_query",
  "resolve_player",
  "get_bucks_dataset",
  "query_bucks_accounts",
  "query_bucks_ledger",
  "query_bucks_bets",
  "get_dare_language",
  "validate_dare_contract",
  "validate_dare_scoutql",
  "preview_dare_contract",
  "create_dare_draft",
  "revise_dare_draft",
  "list_dares",
  "inspect_dare",
  "prepare_dare_action",
  "delete_dare_draft",
  "a_tool_that_does_not_exist",
];

const HOSTILE_INPUTS: unknown[] = [
  undefined,
  null,
  {},
  [],
  42,
  "a string",
  { queryText: 42 },
  { query: { nested: true } },
  { queryText: "" },
  { query: "x".repeat(500) },
];

function inspection(
  overrides: Partial<ExploreToolResultInspection> = {},
): ExploreToolResultInspection {
  return { succeeded: true, details: null, rawOutput: null, ...overrides };
}

describe("explore tool activity", () => {
  test("never throws and never returns an unusable string", () => {
    for (const toolName of TOOL_NAMES) {
      for (const input of HOSTILE_INPUTS) {
        const call = toolCallActivity(toolName, input, "Working.");
        const result = toolResultActivity(
          toolName,
          input,
          inspection({ rawOutput: null }),
          "Done.",
        );
        for (const text of [call, result, toolStartActivity("Working.")]) {
          expect(text.length).toBeGreaterThan(0);
          expect(text.length).toBeLessThanOrEqual(EXPLORE_ACTIVITY_MAX_LENGTH);
          expect(text.trim()).toBe(text);
        }
      }
    }
  });

  test("clamps a long player query rather than overrunning the cap", () => {
    // The only user-influenced substring anywhere on this channel. Its own
    // input schema caps it at 100, but the cap here must hold regardless.
    const text = toolCallActivity(
      "resolve_player",
      { query: "y".repeat(400) },
      "Looking up who that is.",
    );
    expect(text.length).toBeLessThanOrEqual(EXPLORE_ACTIVITY_MAX_LENGTH);
    expect(text.endsWith("…")).toBe(true);
  });

  test("falls back rather than echoing an unknown source name", () => {
    const text = toolCallActivity(
      "run_report_query",
      { queryText: "FROM notasource SELECT x" },
      "Querying match data.",
    );
    expect(text).toBe("Querying match data.");
    expect(text).not.toContain("notasource");
  });

  test("reports row counts compactly", () => {
    const text = toolResultActivity(
      "run_report_query",
      { queryText: "FROM match_participants SELECT games" },
      inspection({
        details: {
          kind: "execution",
          queryText: "FROM match_participants SELECT games",
          ok: true,
          rowsReturned: 84,
          rowsScanned: 1_284_000,
          renderKind: "TABLE",
        },
      }),
      "Got results.",
    );
    expect(text).toBe("Scanned 1.3M rows, kept 84");
  });

  test("says so when a query matched nothing", () => {
    const text = toolResultActivity(
      "run_report_query",
      { queryText: "FROM match_participants SELECT games" },
      inspection({
        details: {
          kind: "execution",
          queryText: "FROM match_participants SELECT games",
          ok: true,
          rowsReturned: 0,
          rowsScanned: 4207,
          renderKind: "TABLE",
        },
      }),
      "Got results.",
    );
    expect(text).toBe("Scanned 4,207 rows, none matched");
  });

  test("keeps the generic phrase for a failed tool", () => {
    const text = toolResultActivity(
      "run_report_query",
      { queryText: "FROM match_participants SELECT games" },
      inspection({ succeeded: false }),
      "run_report_query returned an error.",
    );
    expect(text).toBe("run_report_query returned an error.");
  });
});

describe("naming a query's source", () => {
  test("ignores a FROM inside a comment or a string literal", () => {
    // The status line would otherwise name a table the query never reads.
    // Blanking comments and literals first is cheap; the real parser is the
    // full grammar on a hot stream path and its diagnostics carry the query's
    // own text, which is what must not reach this channel.
    expect(
      toolCallActivity(
        "run_report_query",
        {
          queryText:
            "-- from match_participants\nFROM player_groups SELECT games",
        },
        "Querying match data.",
      ),
    ).toBe("Querying player groups");

    expect(
      toolCallActivity(
        "run_report_query",
        {
          queryText:
            "FROM player_groups SELECT games WHERE alias = 'from match_participants'",
        },
        "Querying match data.",
      ),
    ).toBe("Querying player groups");
  });

  test("a block comment before the source does not win", () => {
    expect(
      toolCallActivity(
        "run_report_query",
        {
          queryText:
            "/* from rank_current */ FROM match_participants SELECT games",
        },
        "Querying match data.",
      ),
    ).toBe("Querying match participants");
  });
});
