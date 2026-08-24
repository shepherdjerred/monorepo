import { describe, expect, test } from "vitest";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import { reportAgentInstructions } from "#src/reports/ai/report-query-agent.ts";
import { scoutQlFieldGuideSection } from "#src/reports/ai/scoutql-field-guide.ts";
import { scoutQlLanguageReference } from "#src/reports/ai/scoutql-tools.ts";

describe("exploreAgentInstructions", () => {
  test("includes the generated ScoutQL reference without requiring a tool call", () => {
    const instructions = exploreAgentInstructions();

    expect(instructions).toContain("## ScoutQL reference");
    expect(instructions).toContain(JSON.stringify(scoutQlLanguageReference()));
    expect(instructions).not.toContain("Call get_report_language");
  });

  test("carries no v1 clause the language no longer has", () => {
    const instructions = exploreAgentInstructions();

    for (const clause of ["DURING", "ANALYZE", "BUCKET BY", "COMPARE TO"]) {
      expect(instructions).not.toContain(clause);
    }
  });
});

describe("ScoutQL field guide", () => {
  test("is identical in both agent prompts", () => {
    // The two agents teach the same language. A rule stated one way in Explore
    // and another way in the report editor is invisible until a user gets two
    // different answers to the same question, so the section is shared
    // verbatim rather than written twice.
    const section = scoutQlFieldGuideSection();

    expect(section.length).toBeGreaterThan(0);
    expect(exploreAgentInstructions()).toContain(section);
    expect(reportAgentInstructions()).toContain(section);
  });
});
