import { describe, expect, test } from "vitest";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import { reportAgentInstructions } from "#src/reports/ai/report-query-agent.ts";
import { scoutQlFieldGuideSection } from "#src/reports/ai/scoutql-field-guide.ts";
import { scoutQlLanguageReference } from "#src/reports/ai/scoutql-tools.ts";

describe("exploreAgentInstructions", () => {
  test("includes the generated ScoutQL reference without requiring a tool call", () => {
    const instructions = exploreAgentInstructions({ bucks: null });

    expect(instructions).toContain("## ScoutQL reference");
    expect(instructions).toContain(JSON.stringify(scoutQlLanguageReference()));
    expect(instructions).not.toContain("Call get_report_language");
    expect(instructions).toContain("Based on N games");
    expect(instructions).toContain("N games in Scout's data");
    expect(instructions).toContain(
      "Fewer than 10 games — treat this rate as indicative only.",
    );
    expect(instructions).toContain(
      "Follow-up suggestions (`followUps`) are offered as clickable chips",
    );
    expect(instructions).toContain(
      "NEVER phrased as the bot asking the user a question",
    );
    expect(instructions).not.toContain("sample size");
    expect(instructions).toContain("includeVisualization");
    expect(instructions).toContain(
      "Never attach a visualization just because a query ran",
    );
    expect(instructions).not.toContain("Always choose an output render kind");
  });

  test("appends the Bryan Bucks section only for a bucks-capable turn", () => {
    const plain = exploreAgentInstructions({ bucks: null });
    const withBucks = exploreAgentInstructions({
      bucks: { currentTime: "2026-08-29T00:00:00.000Z" },
    });

    expect(plain).not.toContain("## Bryan Bucks");
    expect(withBucks).toContain("## Bryan Bucks");
    // The injected timestamp anchors relative-date questions.
    expect(withBucks).toContain("2026-08-29T00:00:00.000Z");
    // The load-bearing definitions ported from the retired /bb ask agent.
    expect(withBucks).toContain(
      "Current balance, ledger delta, and betting P&L are different measures.",
    );
    expect(withBucks).toContain("private to the asker");
    // A bucks-only answer runs no ScoutQL.
    expect(withBucks).toContain("set queryText to null");
    // Both variants still carry the whole ScoutQL contract.
    expect(withBucks).toContain("## ScoutQL reference");
  });

  test("keeps Discord answers self-contained instead of selecting web cards", () => {
    const instructions = exploreAgentInstructions({
      bucks: null,
      surface: "discord",
    });

    expect(instructions).toContain("Set matchCards to []");
    expect(instructions).toContain("fully self-contained");
    expect(instructions).not.toContain(
      "Choose S for a compact score reference",
    );
  });

  test("appends the creation section only when the creation tools exist", () => {
    const plain = exploreAgentInstructions({ bucks: null });
    const withCreation = exploreAgentInstructions({
      bucks: null,
      creation: true,
    });

    expect(plain).not.toContain("## Creating reports");
    expect(plain).not.toContain("list_creation_targets");
    expect(withCreation).toContain(
      "## Creating reports, tracked players and competitions",
    );
    // The load-bearing rules: discover before proposing, ask which server,
    // confirm the fields, and never claim an entity exists.
    expect(withCreation).toContain(
      "Call list_creation_targets before proposing any creation",
    );
    expect(withCreation).toContain("ask which one they mean");
    expect(withCreation).toContain(
      "Confirm every required field with the user",
    );
    expect(withCreation).toContain("NOTHING HAS BEEN CREATED YET");
    expect(withCreation).toContain("expires in ten minutes");
    expect(withCreation).toContain(
      "NEVER say that a report, tracked player or competition exists",
    );
    // An outage is never reported as a denial — the same rule the tools enforce.
    expect(withCreation).toContain("Do NOT say they lack permission");
  });

  test("appends the challenges section only when challenges are enabled", () => {
    const plain = exploreAgentInstructions({ bucks: null });
    const withChallenges = exploreAgentInstructions({
      bucks: null,
      challenges: true,
    });

    expect(plain).not.toContain("## Community challenge contracts");
    expect(plain).not.toContain("draft_challenge_contract");
    expect(withChallenges).toContain("## Community challenge contracts");
    expect(withChallenges).toContain(
      "New challenges are authored from scratch without a source template",
    );
    expect(withChallenges).toContain("catalog: 'current_champions'");
    expect(withChallenges).toContain("draft_challenge_contract");
  });

  test("carries no v1 clause the language no longer has", () => {
    const instructions = exploreAgentInstructions({ bucks: null });

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
    expect(exploreAgentInstructions({ bucks: null })).toContain(section);
    expect(reportAgentInstructions()).toContain(section);
  });
});
