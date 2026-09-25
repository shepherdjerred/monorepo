import { exploreScoutQlReference } from "#src/explore/scoutql-reference.ts";
import { describe, expect, test } from "vitest";
import {
  COMPETITIVE_PROGRESSION_CATALOG,
  queuesWithoutPostMatchData,
} from "@scout-for-lol/data";
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
  test("carries ScoutQL itself, compact, last; domain skills stay on demand", () => {
    const instructions = exploreAgentInstructions({ bucks: null });

    expect(instructions).toContain("## Skills");
    expect(instructions).toContain("load_skill");
    // Loaded as a skill, the reference landed after the user's question,
    // where no two turns share a cached prefix: ~30k uncached tokens a turn.
    // In the prompt it is part of one cached prefix. The field guide is
    // shared with the report-query agent and must stay byte-identical.
    expect(instructions).toContain(scoutQlFieldGuideSection());
    expect(instructions.endsWith(exploreScoutQlReference())).toBe(true);
    // Compact text, not the report agent's JSON catalog.
    expect(instructions).not.toContain(
      JSON.stringify(scoutQlLanguageReference()),
    );
    expect(instructions).not.toContain("Load the scoutql skill");
  });

  test("keeps the answer-shaping rules that apply to every turn", () => {
    const instructions = exploreAgentInstructions({ bucks: null });
    // Claims the judge found wider than their query: an unstated 10-game
    // floor, an alphabetical "top", player-games reported as games.
    expect(instructions).toContain("must ORDER BY that measure");
    expect(instructions).toContain("among players with at least 10 games");
    expect(instructions).toContain("COUNT(DISTINCT match_id)");
    expect(
      exploreAgentInstructions({ bucks: null, challenges: true }),
    ).toContain("Scout challenges carry no reward");

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

describe("sample sizes on records", () => {
  test("a single extreme value is not given a corpus-sized sample", () => {
    // "52 kills in a single game, across 25,442 games in Scout's data" — the
    // count was the corpus, not the games holding that record, and the judge
    // was right to call the figure unsupported.
    const instructions = exploreAgentInstructions({ bucks: null });
    expect(instructions).toContain("A single extreme value");
    expect(instructions).toContain(
      "never as 'across N games' beside the record",
    );
    // The rule it qualifies has to survive: it is what grounds every rate.
    expect(instructions).toContain("'N games in Scout's data'");
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
    // Objective timings left too, when timeline_events became a source.
    expect(listed).not.toContain("objective");
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
      hallOfFame: true,
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
    expect(instructions).toContain("the players the user's servers track");
    expect(instructions).toContain("Do not ask which players they meant");
  });

  test("says how to choose servers, and asks only when it cannot tell", () => {
    const instructions = exploreAgentInstructions({ bucks: null });
    // Servers are opt-in: over-scoping answered "who has the most" from one
    // server's handful of games and declined 16 answerable prod chips.
    expect(instructions).toContain("Set servers to null by default");
    expect(instructions).toContain("fewer than 10 games");
    expect(instructions).toContain("run it again with servers null");
    expect(instructions).toContain("call list_my_servers");
    expect(instructions).toContain("if it lists one server, use it");
    expect(instructions).toContain("'all my servers'");
    expect(instructions).toContain("otherwise ask which server");
  });

  test("player_groups is allowed with servers and never globally", () => {
    const instructions = exploreAgentInstructions({ bucks: null });
    expect(instructions).toContain("player_groups reads groups");
    expect(instructions).toContain("never runs without them");
    expect(instructions).not.toContain("must never be queried: player_groups");
    // Teammates are reachable now; opponents are still a stated limit.
    const listed = LAKE_HOLDS_BUT_SCOUTQL_CANNOT_REACH.join(" ");
    expect(listed).not.toContain("plays well together");
    expect(listed).toContain("head-to-head");
  });

  test("defines the Hall of Fame, which was once read as a player name", () => {
    const instructions = exploreAgentInstructions({ bucks: null });
    expect(instructions).toContain("Hall of Fame");
    expect(instructions).toContain("not a player");
  });

  test("names every Hall record and queue family, from the catalog", () => {
    // The loose definition made any extreme a record, so "the kill
    // participation record" was attempted rather than recognised as absent,
    // and "who is in the Hall of Fame?" had no finite answer.
    const instructions = exploreAgentInstructions({ bucks: null });
    const { records, queueFamilies } = COMPETITIVE_PROGRESSION_CATALOG.hall;
    for (const record of records) expect(instructions).toContain(record.label);
    for (const family of queueFamilies) {
      expect(instructions).toContain(family.label);
    }
    expect(instructions).toContain("these records and no others");
    // The count is left out on purpose: stated only in the prompt, it reached
    // answers as a figure no query produced.
    expect(instructions).not.toContain(`${records.length.toString()} records`);
    expect(instructions).toContain("never by role, position or champion");
    expect(instructions).toContain("never ask which record they meant");
  });
});

describe("reading features rather than re-deriving them", () => {
  test("the Hall is read from the board when it is on, and called off when not", () => {
    const on = exploreAgentInstructions({ bucks: null, hallOfFame: true });
    expect(on).toContain(
      "Use get_hall_of_fame for every Hall of Fame question",
    );
    expect(on).not.toContain("The Hall of Fame is not switched on");
    const off = exploreAgentInstructions({ bucks: null, hallOfFame: false });
    expect(off).toContain("The Hall of Fame is not switched on");
    // Off is not a refusal: even board questions are reconstructed.
    expect(off).toContain("Answer anyway by reconstructing it from match data");
    expect(off).toContain("'broken this month'");
    expect(off).not.toContain("get_hall_of_fame");
  });

  test("competitions can be read whatever the creation flag says", () => {
    // Reading used to be impossible and was blamed on the query surface;
    // creation being off says nothing about reading.
    for (const creation of [true, false]) {
      const instructions = exploreAgentInstructions({
        bucks: null,
        creation,
        surface: "web",
      });
      expect(instructions).toContain("list_competitions");
      expect(instructions).toContain("get_competition_standings");
      // Membership is the gate: no permission for the model to blame.
      expect(instructions).toContain("Every member of a server can read");
      expect(instructions).not.toContain("competitions:read");
    }
    expect(
      exploreAgentInstructions({
        bucks: null,
        creation: false,
        surface: "web",
      }),
    ).toContain("Reading existing competitions is unaffected");
  });

  test("challenge runs can be read when challenges are on", () => {
    const on = exploreAgentInstructions({ bucks: null, challenges: true });
    expect(on).toContain("list_my_challenge_runs");
    expect(on).toContain("challenge_leaderboard");
  });
});

describe("assumptions instead of clarifying questions", () => {
  test("a missing threshold is chosen and stated, not asked for", () => {
    const instructions = exploreAgentInstructions({ bucks: null });
    expect(instructions).toContain("choose the sensible reading yourself");
    expect(instructions).toContain("Do not ask them to choose first");
  });

  test("no corpus-wide total without a query that returned it", () => {
    const instructions = exploreAgentInstructions({ bucks: null });
    expect(instructions).toContain(
      "unless a query in this turn returned that exact count",
    );
  });

  test("challenges are said to have no end date when they are on", () => {
    expect(
      exploreAgentInstructions({ bucks: null, challenges: true }),
    ).toContain("Scout challenges have no end date");
    expect(
      exploreAgentInstructions({ bucks: null, challenges: false }),
    ).not.toContain("Scout challenges have no end date");
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
