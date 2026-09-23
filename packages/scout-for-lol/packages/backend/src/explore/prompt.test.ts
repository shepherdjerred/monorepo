import { describe, expect, test } from "vitest";
import { queuesWithoutPostMatchData } from "@scout-for-lol/data";
import {
  LAKE_COVERAGE_RULE,
  LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH,
} from "#src/explore/lake-coverage.ts";
import { judgeSystemPrompt } from "#src/explore/replay/judge.ts";
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

describe("data Scout has that Explore cannot query", () => {
  test("names each unreachable dataset and the rule about it", () => {
    // The agent used to infer "I cannot query bans" and then tell the user
    // "Scout records champion selections, not bans" — against 229,330 ban rows.
    const instructions = exploreAgentInstructions({ bucks: null });

    for (const entry of LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH) {
      expect(instructions).toContain(entry);
    }
    expect(instructions).toContain(LAKE_COVERAGE_RULE);
  });

  test("the judge grades against the same list the agent is given", () => {
    // Two copies would drift, and the two halves would then disagree about
    // what Scout holds — the exact failure this list exists to stop.
    expect(judgeSystemPrompt()).toContain(
      LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH[0],
    );
  });
});

describe("team objectives", () => {
  test("points at match_teams and bounds what it can claim", () => {
    const instructions = exploreAgentInstructions({ bucks: null });
    expect(instructions).toContain("match_teams holds one row per team");
    // The trap this exists for: answering "do we win more with first dragon?"
    // from a source that covers the whole lake, as if it were their record.
    expect(instructions).toContain("never present it as this server's record");
  });

  test("no longer calls first-objective flags unreachable", () => {
    // They were on the unreachable list until match_teams became a source.
    // Leaving them there would have Explore decline what it can now answer.
    const listed = LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH.join(" ");
    expect(listed).not.toContain("team-level objective counts");
    expect(listed).toContain("WHEN an objective was taken");
  });
});

describe("gated-off capabilities", () => {
  test("every capability says so when it is off, not only when it is on", () => {
    // A guild without the feature used to get silence: the tool vanished, the
    // skill was filtered out, and the model invented a data reason.
    const off = exploreAgentInstructions({
      bucks: null,
      mvpVotes: null,
      dares: false,
      challenges: false,
      clash: false,
      surface: "web",
    });

    for (const phrase of [
      "Bryan Bucks",
      "MVP votes are not switched on",
      "Dares",
      "challenges",
      "Clash tools are not switched on",
    ]) {
      expect(off).toContain(phrase);
    }
    expect(off).toContain("not switched on for the servers in scope");
  });

  test("says Bryan Bucks is a feature and not a person", () => {
    // Three chips read it as a player name: "I can report on Bryan Bucks's
    // recorded League matches instead, if that's the player you meant".
    const off = exploreAgentInstructions({ bucks: null });
    expect(off).toContain("not a player");
  });

  test("forbids improvising a dare when dares are off", () => {
    // With dares gated off, a turn answered "I dare our mid laner to lock in
    // an assassin and win lane—or buy the team snacks."
    const off = exploreAgentInstructions({ bucks: null, dares: false });
    expect(off).toContain("Never draft, invent, or word a dare yourself");
  });

  test("keeps the enabled wording when a capability is on", () => {
    const on = exploreAgentInstructions({
      bucks: { currentTime: "now" },
      mvpVotes: { currentTime: "now" },
      dares: true,
      challenges: true,
      clash: true,
    });
    expect(on).toContain("dedicated bucks tools");
    expect(on).not.toContain("not switched on for the servers in scope");
  });
});

describe("unresolved concepts", () => {
  test("defines who 'our' and 'we' mean", () => {
    // ~23 turns asked for a Riot ID and ~16 declined, for a referent no reader
    // would have found ambiguous.
    const instructions = exploreAgentInstructions({ bucks: null });
    expect(instructions).toContain("the players this server tracks");
    expect(instructions).toContain("Do not ask which players they meant");
  });

  test("defines the Hall of Fame, which was once read as a player name", () => {
    const instructions = exploreAgentInstructions({ bucks: null });
    expect(instructions).toContain("Hall of Fame");
    expect(instructions).toContain("all-time record board");
    expect(instructions).toContain("not a player");
  });
});

describe("queues Riot sends no results for", () => {
  test("fences the list so a prefix cannot be generalised", () => {
    // "aram clash" was read as all ARAM, and every ARAM question refused —
    // against 2,830 ordinary ARAM matches in the prod lake.
    const instructions = exploreAgentInstructions({ bucks: null });
    expect(instructions).toContain("and only these queues");
    expect(instructions).toContain("ordinary 'aram' games do have results");
    for (const queue of queuesWithoutPostMatchData()) {
      expect(instructions).toContain(queue);
    }
  });
});
