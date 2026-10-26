import {
  dareSkillBody,
  enabledExploreSkills,
  EXPLORE_SKILLS,
  exploreSkillIndexSection,
  renderExploreSkillBody,
  type ExploreSkillContext,
} from "#src/explore/skills/registry.ts";
import { describe, expect, test } from "vitest";

const WEB_CONTEXT: ExploreSkillContext = { surface: "web" };

function skillsOn(surface: "web" | "discord" | "voice"): string[] {
  return enabledExploreSkills({ surface }).map((candidate) => candidate.name);
}

function skill(name: string) {
  const found = EXPLORE_SKILLS.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`missing skill '${name}'`);
  }
  return found;
}

describe("enabledExploreSkills", () => {
  test("a plain web turn gets only the always-on skills", () => {
    const names = enabledExploreSkills({ surface: "web" }).map(
      (candidate) => candidate.name,
    );
    // ScoutQL is in the system prompt, not a skill.
    expect(names).not.toContain("scoutql");
    expect(names).toContain("visualization");
    expect(names).toContain("match-cards");
    expect(names).toContain("loadouts");
    expect(names).not.toContain("dares");
    expect(names).not.toContain("challenges");
    expect(names).not.toContain("clash");
    expect(names).not.toContain("creation");
    expect(names).not.toContain("bryan-bucks");
    expect(names).not.toContain("mvp-votes");
  });

  test("capability flags gate their skills", () => {
    const names = enabledExploreSkills({
      mvpVotes: { currentTime: "2026-08-29T00:00:00.000Z" },
      dares: true,
      challenges: true,
      clash: true,
      creation: true,
      surface: "web",
    }).map((candidate) => candidate.name);
    expect(names).not.toContain("bryan-bucks");
    expect(names).toContain("mvp-votes");
    expect(names).toContain("dares");
    expect(names).toContain("challenges");
    expect(names).toContain("clash");
    expect(names).toContain("creation");
  });

  test("every surface offers the same capability skills", () => {
    const options = {
      mvpVotes: { currentTime: "2026-08-29T00:00:00.000Z" },
      dares: true,
      challenges: true,
      clash: true,
      creation: true,
    };
    const names = (surface: "web" | "discord" | "voice") =>
      enabledExploreSkills({ ...options, surface })
        .map((candidate) => candidate.name)
        .filter((name) => name !== "voice-response");
    expect(names("discord")).toEqual(names("web"));
    expect(names("voice")).toEqual(names("web"));
    expect(names("discord")).toContain("creation");
    expect(names("discord")).toContain("loadouts");
  });

  test("delivery skills reach only the surface they shape", () => {
    expect(skillsOn("voice")).toContain("voice-response");
    expect(skillsOn("web")).not.toContain("voice-response");
    expect(skillsOn("discord")).not.toContain("voice-response");
  });
});

describe("skill bodies", () => {
  test("every enabled body renders without an unresolved placeholder", () => {
    const context: ExploreSkillContext = {
      mvpVotes: { currentTime: "2026-08-29T00:00:00.000Z" },
      surface: "web",
    };
    for (const candidate of EXPLORE_SKILLS) {
      const body = renderExploreSkillBody(candidate, context);
      expect(body).not.toMatch(/\{\{[a-z][a-z0-9]*\}\}/i);
      expect(body.length).toBeGreaterThan(0);
    }
  });

  test("loadouts separates match inventories from aggregate item queries", () => {
    const body = renderExploreSkillBody(skill("loadouts"), WEB_CONTEXT);
    expect(body).toContain("`item0` through `item6`");
    expect(body).toContain("summoner1_id");
    expect(body).toContain("stat_perk_*");
    expect(body).toContain("For purchase frequency, filter `timeline_events`");
    expect(body).toContain("event_type = 'ITEM_PURCHASED'");
    expect(body).toContain("`keystone` and `spells` from `match_participants`");
    expect(body).toContain("`item_id` from `timeline_events`");
    expect(body).toContain("cannot unpivot the six final-inventory slots");
    expect(body).toContain("exact `(match_id, puuid)` pair");
    expect(body).toContain("acquire_match_timelines");
    expect(skill("loadouts").outputFor).toBeUndefined();
  });

  test("mvp-votes interpolates the turn timestamp and keeps the ScoutQL tripwire", () => {
    const body = renderExploreSkillBody(skill("mvp-votes"), {
      mvpVotes: { currentTime: "2026-08-29T00:00:00.000Z" },
      surface: "web",
    });
    expect(body).toContain("2026-08-29T00:00:00.000Z");
    expect(body).toContain("not Riot honors");
    expect(body).toContain("set queryText to null");
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

  test("the dare body describes only SQL contracts", () => {
    const body = dareSkillBody();
    expect(body).toContain("game-set CTE");
    expect(body).toContain("get_dare_language");
    expect(body).toContain("Canonical standard SQL is the binding contract");
    expect(body).not.toContain("version 2");
    expect(body).not.toContain("{{");
  });

  test("no body carries a v1 clause the language no longer has", () => {
    const context: ExploreSkillContext = {
      mvpVotes: { currentTime: "2026-08-29T00:00:00.000Z" },
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
    const skills = enabledExploreSkills({ surface: "web" });
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
