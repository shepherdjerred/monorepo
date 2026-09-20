import { describe, expect, test } from "vitest";
import {
  dareSkillBody,
  EXPLORE_SKILLS,
  enabledExploreSkills,
  exploreSkillIndexSection,
  renderExploreSkillBody,
  type ExploreSkillContext,
} from "#src/explore/skills/registry.ts";
import { scoutQlFieldGuideSection } from "#src/reports/ai/scoutql-field-guide.ts";
import { scoutQlLanguageReference } from "#src/reports/ai/scoutql-tools.ts";

const WEB_CONTEXT: ExploreSkillContext = { bucks: null, surface: "web" };

function skill(name: string) {
  const found = EXPLORE_SKILLS.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`missing skill '${name}'`);
  }
  return found;
}

describe("enabledExploreSkills", () => {
  test("a plain web turn gets only the always-on skills", () => {
    const names = enabledExploreSkills({ bucks: null, surface: "web" }).map(
      (candidate) => candidate.name,
    );
    expect(names).toContain("scoutql");
    expect(names).toContain("visualization");
    expect(names).toContain("match-cards");
    expect(names).not.toContain("dares");
    expect(names).not.toContain("challenges");
    expect(names).not.toContain("clash");
    expect(names).not.toContain("creation");
    expect(names).not.toContain("bryan-bucks");
    expect(names).not.toContain("mvp-votes");
  });

  test("capability flags gate their skills", () => {
    const names = enabledExploreSkills({
      bucks: { currentTime: "2026-08-29T00:00:00.000Z" },
      mvpVotes: { currentTime: "2026-08-29T00:00:00.000Z" },
      dares: true,
      challenges: true,
      clash: true,
      creation: true,
      surface: "web",
    }).map((candidate) => candidate.name);
    expect(names).toContain("bryan-bucks");
    expect(names).toContain("mvp-votes");
    expect(names).toContain("dares");
    expect(names).toContain("challenges");
    expect(names).toContain("clash");
    expect(names).toContain("creation");
  });

  test("discord never offers the web-only skills", () => {
    const names = enabledExploreSkills({
      bucks: null,
      creation: true,
      surface: "discord",
    }).map((candidate) => candidate.name);
    expect(names).not.toContain("match-cards");
    // Creation is web-only structurally; the skill file must agree.
    expect(names).not.toContain("creation");
    expect(names).toContain("scoutql");
  });
});

describe("skill bodies", () => {
  test("every enabled body renders without an unresolved placeholder", () => {
    const context: ExploreSkillContext = {
      bucks: { currentTime: "2026-08-29T00:00:00.000Z" },
      surface: "web",
    };
    for (const candidate of EXPLORE_SKILLS) {
      const body = renderExploreSkillBody(candidate, context);
      expect(body).not.toMatch(/\{\{[a-z][a-z0-9]*\}\}/i);
      expect(body.length).toBeGreaterThan(0);
    }
  });

  test("scoutql carries the shared field guide verbatim and the reference", () => {
    // The same anti-fork guarantee prompt.test.ts used to assert on the
    // system prompt: the field guide is shared with the report-query agent,
    // so Explore must serve it byte-identically, just from a skill now.
    const body = renderExploreSkillBody(skill("scoutql"), WEB_CONTEXT);
    expect(body).toContain(scoutQlFieldGuideSection());
    expect(body).toContain(JSON.stringify(scoutQlLanguageReference()));
  });

  test("mvp-votes interpolates the turn timestamp and keeps the ScoutQL tripwire", () => {
    const body = renderExploreSkillBody(skill("mvp-votes"), {
      bucks: null,
      mvpVotes: { currentTime: "2026-08-29T00:00:00.000Z" },
      surface: "web",
    });
    expect(body).toContain("2026-08-29T00:00:00.000Z");
    expect(body).toContain("not Riot honors");
    expect(body).toContain("set queryText to null");
  });

  test("bryan-bucks interpolates the turn timestamp and keeps definitions", () => {
    const body = renderExploreSkillBody(skill("bryan-bucks"), {
      bucks: { currentTime: "2026-08-29T00:00:00.000Z" },
      surface: "web",
    });
    expect(body).toContain("2026-08-29T00:00:00.000Z");
    expect(body).toContain(
      "Current balance, ledger delta, and betting P&L are different measures.",
    );
    expect(body).toContain("private to the asker");
    expect(body).toContain("set queryText to null");
  });

  test("bryan-bucks refuses to render without a bucks context", () => {
    expect(() =>
      renderExploreSkillBody(skill("bryan-bucks"), WEB_CONTEXT),
    ).toThrow(/currentTime/);
  });

  test("creation keeps its load-bearing rules", () => {
    const body = renderExploreSkillBody(skill("creation"), WEB_CONTEXT);
    expect(body).toContain(
      "Call list_creation_targets before proposing any creation",
    );
    expect(body).toContain("ask which one they mean");
    expect(body).toContain("Confirm every required field with the user");
    expect(body).toContain("NOTHING HAS BEEN CREATED YET");
    expect(body).toContain("expires in ten minutes");
    expect(body).toContain(
      "NEVER say that a report, tracked player or competition exists",
    );
    expect(body).toContain("Do NOT say they lack permission");
  });

  test("challenges keeps its load-bearing rules", () => {
    const body = renderExploreSkillBody(skill("challenges"), WEB_CONTEXT);
    expect(body).toContain(
      "New challenges are authored from scratch without a source template",
    );
    expect(body).toContain("catalog: 'current_champions'");
    expect(body).toContain("draft_challenge_contract");
  });

  test("clash keeps its load-bearing rules", () => {
    const body = renderExploreSkillBody(skill("clash"), WEB_CONTEXT);
    expect(body).toContain("get_clash_schedule");
    expect(body).toContain("get_clash_roster");
    expect(body).toContain("get_clash_history");
    expect(body).toContain("Do not answer win rates");
    expect(body).toContain("queue = 'clash'");
    expect(body).toContain("set queryText to null");
  });

  test("the dare body renders the frozen prompt version", () => {
    // The paraphrase eval hashes this text; the version marker proves the
    // placeholder resolved rather than shipping literally.
    const body = dareSkillBody();
    expect(body).toContain("Legacy translator prompt version: explore-dare-");
    expect(body).toContain("game-set CTE");
    expect(body).toContain("get_dare_language");
  });

  test("no body carries a v1 clause the language no longer has", () => {
    const context: ExploreSkillContext = {
      bucks: { currentTime: "2026-08-29T00:00:00.000Z" },
      surface: "web",
    };
    for (const candidate of EXPLORE_SKILLS) {
      const body = renderExploreSkillBody(candidate, context);
      for (const clause of ["DURING", "ANALYZE", "BUCKET BY", "COMPARE TO"]) {
        expect(body).not.toContain(clause);
      }
    }
  });
});

describe("exploreSkillIndexSection", () => {
  test("lists each enabled skill once with its description and tripwires", () => {
    const skills = enabledExploreSkills({ bucks: null, surface: "web" });
    const index = exploreSkillIndexSection(skills);
    expect(index).toContain("## Skills");
    for (const candidate of skills) {
      expect(index).toContain(`- ${candidate.name}:`);
      for (const tripwire of candidate.tripwires) {
        expect(index).toContain(tripwire);
      }
    }
    expect(index).toContain("load_skill");
  });
});
