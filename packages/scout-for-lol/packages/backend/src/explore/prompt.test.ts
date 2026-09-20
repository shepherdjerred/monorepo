import { describe, expect, test } from "vitest";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";
import { reportAgentInstructions } from "#src/reports/ai/report-query-agent.ts";
import { scoutQlFieldGuideSection } from "#src/reports/ai/scoutql-field-guide.ts";
import { scoutQlLanguageReference } from "#src/reports/ai/scoutql-tools.ts";

describe("exploreAgentInstructions", () => {
  test("is a lean core: skills index instead of inlined domain sections", () => {
    const instructions = exploreAgentInstructions({ bucks: null });

    expect(instructions).toContain("## Skills");
    expect(instructions).toContain("load_skill");
    // The ScoutQL language reference and field guide moved into the scoutql
    // skill; the prompt must not carry either any more.
    expect(instructions).not.toContain("## ScoutQL reference");
    expect(instructions).not.toContain(
      JSON.stringify(scoutQlLanguageReference()),
    );
    expect(instructions).not.toContain(scoutQlFieldGuideSection());
    expect(instructions).toContain("Load the scoutql skill");
  });

  test("keeps the answer-shaping rules that apply to every turn", () => {
    const instructions = exploreAgentInstructions({ bucks: null });

    expect(instructions).toContain(
      "NEVER state a statistic you did not read from a tool result",
    );
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
    // The worst-looking viz failure keeps a standing rule via the
    // visualization skill's tripwire even when the skill is never loaded.
    expect(instructions).toContain(
      "Never use a line or area chart when the x axis is a category",
    );
  });

  test("lists capability skills only when the capability exists", () => {
    const plain = exploreAgentInstructions({ bucks: null });
    const everything = exploreAgentInstructions({
      bucks: { currentTime: "2026-08-29T00:00:00.000Z" },
      mvpVotes: { currentTime: "2026-08-29T00:00:00.000Z" },
      dares: true,
      challenges: true,
      creation: true,
      surface: "web",
    });

    for (const name of [
      "bryan-bucks",
      "dares",
      "challenges",
      "creation",
      "mvp-votes",
    ]) {
      expect(plain).not.toContain(`- ${name}:`);
      expect(everything).toContain(`- ${name}:`);
    }
  });

  test("carries tripwires but not skill bodies", () => {
    const everything = exploreAgentInstructions({
      bucks: { currentTime: "2026-08-29T00:00:00.000Z" },
      mvpVotes: { currentTime: "2026-08-29T00:00:00.000Z" },
      dares: true,
      challenges: true,
      creation: true,
      surface: "web",
    });

    // Tripwires: the rules that must hold even if a skill is never loaded.
    expect(everything).toContain("a proposal, not an entity");
    expect(everything).toContain("Never publish a challenge from Explore");
    expect(everything).toContain("private to the asker");
    expect(everything).toContain("queryText to null");
    expect(everything).toContain("ScoutQL cannot answer Discord MVP ballots");

    // Bodies stay out: one marker line per moved section.
    expect(everything).not.toContain("game-set CTE");
    expect(everything).not.toContain("Betting P&L is gross payout minus stake");
    expect(everything).not.toContain("catalog: 'current_champions'");
    expect(everything).not.toContain("NOTHING HAS BEEN CREATED YET");
    expect(everything).not.toContain("RENDER kpi_card");
    // The per-turn timestamp lives in the bryan-bucks skill body now, so the
    // prompt stays byte-stable across turns for the provider prompt cache.
    expect(everything).not.toContain("2026-08-29T00:00:00.000Z");
  });

  test("keeps Discord answers self-contained instead of selecting web cards", () => {
    const instructions = exploreAgentInstructions({
      bucks: null,
      surface: "discord",
    });

    expect(instructions).toContain("Set matchCards to []");
    expect(instructions).toContain("fully self-contained");
    expect(instructions).not.toContain("- match-cards:");
  });

  test("offers match cards on the web surface via the skill index", () => {
    const instructions = exploreAgentInstructions({
      bucks: null,
      surface: "web",
    });

    expect(instructions).toContain("- match-cards:");
    expect(instructions).not.toContain("fully self-contained");
  });

  test("voice keeps a full saved answer and a separate spoken rendering", () => {
    const instructions = exploreAgentInstructions({
      bucks: null,
      surface: "voice",
    });
    expect(instructions).toContain("- voice-response:");
    expect(instructions).toContain("complete private Explore answer");
    expect(instructions).toContain("one-to-three-sentence summary");
    expect(instructions).toContain("- visualization:");
    expect(instructions).toContain("- match-cards:");
    expect(instructions).not.toContain("Set includeVisualization to false");
  });

  test("carries no v1 clause the language no longer has", () => {
    const instructions = exploreAgentInstructions({ bucks: null });

    for (const clause of ["DURING", "ANALYZE", "BUCKET BY", "COMPARE TO"]) {
      expect(instructions).not.toContain(clause);
    }
  });
});

describe("ScoutQL field guide", () => {
  test("still reaches the report-query agent verbatim", () => {
    // Explore now serves the guide through its scoutql skill (asserted in
    // skills/registry.test.ts); the report-query agent keeps it inline. Both
    // read the same generated section, so the two agents cannot be taught
    // different languages.
    const section = scoutQlFieldGuideSection();

    expect(section.length).toBeGreaterThan(0);
    expect(reportAgentInstructions()).toContain(section);
  });
});
