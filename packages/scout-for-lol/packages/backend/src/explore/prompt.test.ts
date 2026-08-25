import { describe, expect, test } from "vitest";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import { scoutQlLanguageReference } from "#src/reports/ai/scoutql-tools.ts";

describe("exploreAgentInstructions", () => {
  test("includes the generated ScoutQL reference without requiring a tool call", () => {
    const instructions = exploreAgentInstructions();

    expect(instructions).toContain("## ScoutQL reference");
    expect(instructions).toContain(JSON.stringify(scoutQlLanguageReference()));
    expect(instructions).not.toContain("Call get_report_language");
    expect(instructions).toContain("Based on N games");
    expect(instructions).toContain("N games in Scout's data");
    expect(instructions).toContain(
      "Fewer than 10 games — treat this rate as indicative only.",
    );
    expect(instructions).not.toContain("sample size");
  });
});
