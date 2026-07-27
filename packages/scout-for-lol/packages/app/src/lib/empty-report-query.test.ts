import { describe, expect, test } from "bun:test";
import { compileReportQuery, parseReportQuery } from "@scout-for-lol/data";
import {
  EMPTY_REPORT_STATE,
  STARTER_REPORT_QUERY,
} from "#src/components/report-form-fields.tsx";

describe("starter report query", () => {
  test("is the default query for a fresh form", () => {
    expect(EMPTY_REPORT_STATE.queryText).toBe(STARTER_REPORT_QUERY);
  });

  test("parses with no error diagnostics", () => {
    const { diagnostics } = parseReportQuery(STARTER_REPORT_QUERY);
    const errors = diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    );
    expect(errors).toEqual([]);
  });

  test("compiles to a leaderboard plan", () => {
    const { ast } = parseReportQuery(STARTER_REPORT_QUERY);
    const plan = compileReportQuery(ast);
    expect(plan.source).toBe("match_participants");
    expect(plan.groupBy).toBe("player");
    expect(plan.metrics).toEqual(["games", "win_rate"]);
    expect(plan.orderBy).toBe("games");
    expect(plan.limit).toBe(10);
  });
});
