import { describe, expect, test } from "bun:test";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import { scoutQlLanguageReference } from "#src/reports/ai/scoutql-tools.ts";

describe("exploreAgentInstructions", () => {
  test("includes the generated ScoutQL reference without requiring a tool call", () => {
    const instructions = exploreAgentInstructions();

    expect(instructions).toContain("## ScoutQL reference");
    expect(instructions).toContain(JSON.stringify(scoutQlLanguageReference()));
    expect(instructions).not.toContain("Call get_report_language");
  });
});
