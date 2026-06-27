import { describe, expect, test } from "bun:test";
import {
  REPORT_DEFAULT_LOOKBACK_DAYS,
  REPORT_DEFAULT_MAX_ROWS,
  REPORT_ACTIVE_LIMIT_PER_OWNER_PER_SERVER,
  REPORT_ACTIVE_LIMIT_PER_SERVER,
  REPORT_MAX_LOOKBACK_DAYS,
  REPORT_MAX_ROWS_LIMIT,
  REPORT_QUERY_MAX_LENGTH,
  DEFAULT_RENDER_SPEC,
  ReportCreateInputSchema,
  ReportIdSchema,
  ReportLookbackDaysSchema,
  ReportMaxRowsSchema,
  ReportOutputFormatSchema,
  ReportRenderSpecSchema,
  ReportRunIdSchema,
  ReportRunStatusSchema,
  ReportRunTriggerSchema,
  ReportSystemSourceSchema,
} from "#src/model/report.ts";

describe("Report branded IDs", () => {
  test("accept valid positive IDs", () => {
    expect(ReportIdSchema.safeParse(1).success).toBe(true);
    expect(ReportRunIdSchema.safeParse(2).success).toBe(true);
  });

  test("reject invalid IDs", () => {
    expect(ReportIdSchema.safeParse(0).success).toBe(false);
    expect(ReportRunIdSchema.safeParse(1.5).success).toBe(false);
  });
});

describe("Report enums", () => {
  test("accept supported output formats", () => {
    expect(ReportOutputFormatSchema.safeParse("LIST").success).toBe(true);
    expect(ReportOutputFormatSchema.safeParse("TABLE").success).toBe(true);
    expect(ReportOutputFormatSchema.safeParse("LEADERBOARD").success).toBe(
      true,
    );
    expect(ReportOutputFormatSchema.safeParse("BAR_CHART").success).toBe(true);
    expect(ReportOutputFormatSchema.safeParse("LINE_CHART").success).toBe(true);
  });

  test("reject unsupported output formats", () => {
    expect(ReportOutputFormatSchema.safeParse("PIE_CHART").success).toBe(false);
  });

  test("accept run statuses and triggers", () => {
    expect(ReportRunStatusSchema.safeParse("RUNNING").success).toBe(true);
    expect(ReportRunStatusSchema.safeParse("SUCCESS").success).toBe(true);
    expect(ReportRunStatusSchema.safeParse("FAILED").success).toBe(true);
    expect(ReportRunTriggerSchema.safeParse("SCHEDULED").success).toBe(true);
    expect(ReportRunTriggerSchema.safeParse("MANUAL").success).toBe(true);
    expect(ReportRunTriggerSchema.safeParse("SHADOW").success).toBe(true);
  });

  test("accept system report sources", () => {
    expect(
      ReportSystemSourceSchema.safeParse("COMMON_DENOMINATOR").success,
    ).toBe(true);
    expect(ReportSystemSourceSchema.safeParse("COMPETITION").success).toBe(
      true,
    );
  });
});

describe("Report limits", () => {
  const missingValue: unknown = undefined;

  test("enforce Discord slash-command query limit", () => {
    const validQuery = "select playerAlias from matches".padEnd(
      REPORT_QUERY_MAX_LENGTH,
      " ",
    );
    const invalidQuery = `${validQuery}x`;

    expect(
      ReportCreateInputSchema.safeParse({
        ...baseInput(),
        queryText: validQuery,
      }).success,
    ).toBe(true);
    expect(
      ReportCreateInputSchema.safeParse({
        ...baseInput(),
        queryText: invalidQuery,
      }).success,
    ).toBe(false);
  });

  test("validates the Discord channel snowflake at the boundary", () => {
    // A valid 17-20 digit snowflake passes.
    expect(
      ReportCreateInputSchema.safeParse({
        ...baseInput(),
        channelId: "12345678901234567",
      }).success,
    ).toBe(true);
    // Malformed channel IDs that the old `z.string().min(1)` accepted (and that
    // then threw a BAD_REQUEST deeper in the handler) are now rejected at the
    // input boundary as a field-level error.
    for (const bad of ["", "123", "not-a-number", "1234567890123456789012"]) {
      expect(
        ReportCreateInputSchema.safeParse({ ...baseInput(), channelId: bad })
          .success,
      ).toBe(false);
    }
  });

  test("default and cap lookback days", () => {
    expect(ReportLookbackDaysSchema.parse(missingValue)).toBe(
      REPORT_DEFAULT_LOOKBACK_DAYS,
    );
    expect(
      ReportLookbackDaysSchema.safeParse(REPORT_MAX_LOOKBACK_DAYS).success,
    ).toBe(true);
    expect(
      ReportLookbackDaysSchema.safeParse(REPORT_MAX_LOOKBACK_DAYS + 1).success,
    ).toBe(false);
  });

  test("default and cap max rows", () => {
    expect(ReportMaxRowsSchema.parse(missingValue)).toBe(
      REPORT_DEFAULT_MAX_ROWS,
    );
    expect(ReportMaxRowsSchema.safeParse(REPORT_MAX_ROWS_LIMIT).success).toBe(
      true,
    );
    expect(
      ReportMaxRowsSchema.safeParse(REPORT_MAX_ROWS_LIMIT + 1).success,
    ).toBe(false);
  });

  test("expose MVP active report caps", () => {
    expect(REPORT_ACTIVE_LIMIT_PER_SERVER).toBe(3);
    expect(REPORT_ACTIVE_LIMIT_PER_OWNER_PER_SERVER).toBe(2);
  });
});

describe("Report render spec", () => {
  test("defaults to a TABLE render", () => {
    expect(DEFAULT_RENDER_SPEC).toEqual({ kind: "TABLE" });
  });

  test("accepts a text kind with no encoding", () => {
    const parsed = ReportRenderSpecSchema.parse({ kind: "LEADERBOARD" });
    expect(parsed).toEqual({ kind: "LEADERBOARD" });
  });

  test("defaults chart encoding and options to empty objects", () => {
    const parsed = ReportRenderSpecSchema.parse({ kind: "BAR_CHART" });
    expect(parsed).toEqual({
      kind: "BAR_CHART",
      encoding: {},
      options: {},
    });
  });

  test("accepts chart channels and options", () => {
    const parsed = ReportRenderSpecSchema.parse({
      kind: "LINE_CHART",
      encoding: { x: "label", y: "win_rate" },
      options: { title: "Win %", yAxisLabel: "Rate" },
    });
    expect(parsed).toEqual({
      kind: "LINE_CHART",
      encoding: { x: "label", y: "win_rate" },
      options: { title: "Win %", yAxisLabel: "Rate" },
    });
  });

  test("rejects unknown channel and option keys", () => {
    expect(
      ReportRenderSpecSchema.safeParse({
        kind: "BAR_CHART",
        encoding: { z: "games" },
      }).success,
    ).toBe(false);
    expect(
      ReportRenderSpecSchema.safeParse({
        kind: "BAR_CHART",
        options: { caption: "nope" },
      }).success,
    ).toBe(false);
  });

  test("rejects an unknown render kind", () => {
    expect(
      ReportRenderSpecSchema.safeParse({ kind: "PIE_CHART" }).success,
    ).toBe(false);
  });
});

function baseInput(): Record<string, unknown> {
  return {
    title: "Weekly leaderboard",
    channelId: "12345678901234567",
    queryText: "select playerAlias, count(*) from matches",
    cronExpression: "0 0 * * 0",
  };
}
