import { expect, test } from "vitest";
import { ReportAiModelPreviewSummarySchema } from "@scout-for-lol/data";
import {
  inspectExploreToolCall,
  inspectExploreToolResult,
} from "#src/explore/tool-inspection.ts";

test("records the total query row count in Explore trace details", () => {
  const preview = ReportAiModelPreviewSummarySchema.parse({
    columns: [{ key: "games", label: "Games", format: "integer" }],
    rows: Array.from({ length: 10 }, (_, index) => ({
      label: `Row ${index.toString()}`,
      values: [{ column: "games", value: index }],
    })),
    rowsReturned: 11,
    rowsScanned: 42,
    renderKind: "TABLE",
  });

  const inspection = inspectExploreToolResult(
    "run_report_query",
    { queryText: "FROM matches SELECT games" },
    {
      ok: true,
      message: "Returned 11 rows.",
      formattedQueryText: "FROM matches SELECT games",
      preview,
    },
  );

  expect(inspection.details).toEqual({
    kind: "execution",
    queryText: "FROM matches SELECT games",
    ok: true,
    rowsReturned: 11,
    rowsScanned: 42,
    renderKind: "TABLE",
  });
});

test("feature read tools reach the trace with their input and output", () => {
  // Unregistered, a Hall or competition read left rawInput and rawOutput
  // null: the trace hid what the model was told, and the replay judge had
  // no evidence for any figure these tools supplied.
  for (const [toolName, input, output] of [
    [
      "get_hall_of_fame",
      { queueFamily: "aram" },
      { kind: "hall_of_fame", message: "ok", data: [] },
    ],
    [
      "list_competitions",
      { activeOnly: true },
      { kind: "competitions", message: "ok", data: [] },
    ],
    [
      "challenge_leaderboard",
      { limit: 5 },
      { kind: "challenge_leaderboard", message: "ok", data: [] },
    ],
  ] as const) {
    expect(inspectExploreToolCall(toolName, input).rawInput).toEqual(input);
    const result = inspectExploreToolResult(toolName, input, output);
    expect(result.succeeded).toBe(true);
    expect(result.rawOutput).toEqual(output);
  }
});

test("a server-scoped query is inspected, with its servers kept out of the trace", () => {
  // The strict shared input schema once rejected `servers` and failed the
  // whole turn. Servers stay out of the trace: share links are public.
  const input = {
    queryText: "FROM matches SELECT games",
    servers: ["123456789012345678"],
  };
  expect(inspectExploreToolCall("run_report_query", input).rawInput).toEqual({
    queryText: "FROM matches SELECT games",
    scope: "one server",
  });
  const result = inspectExploreToolResult("run_report_query", input, {
    ok: false,
    message: "The user is not in some of those servers.",
    formattedQueryText: null,
    preview: null,
  });
  expect(result.details).toMatchObject({
    kind: "execution",
    queryText: "FROM matches SELECT games",
  });
  expect(JSON.stringify(result)).not.toContain("123456789012345678");
});

test("list_my_servers never reaches a shared trace", () => {
  const call = inspectExploreToolCall("list_my_servers", { search: "rift" });
  expect(call.rawInput).toBeNull();
});
