import { describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data";
import {
  rubricResults,
  scenarioJudgeUserPrompt,
} from "#src/explore/scenarios/judge.ts";
import type { ScenarioWorld } from "#src/explore/scenarios/world.ts";

const ASKER = DiscordAccountIdSchema.parse("900000000000010000");
const CHANNEL = DiscordChannelIdSchema.parse("900000000000020000");

const WORLD: ScenarioWorld = {
  caseId: "who-am-i",
  surface: "discord",
  guildId: DiscordGuildIdSchema.parse("900000000000000000"),
  guildName: "Harbor Lane",
  asker: { id: ASKER, username: "ava", displayName: "Ava" },
  members: [{ id: ASKER, username: "ava", displayName: "Ava" }],
  channels: [{ id: CHANNEL, name: "league-stats-with-scout" }],
  players: [
    {
      alias: "Tarrow",
      account: {
        puuid: LeaguePuuidSchema.parse("5ce4a710-0000-4000-8000-000000000002"),
        gameName: "Tarrow",
        tagLine: "NA1",
        region: "AMERICA_NORTH",
        games: 12,
      },
      discordId: ASKER,
      feedChannelIds: [CHANNEL],
    },
  ],
  candidates: {},
  reports: [
    {
      title: "Weekly KDA",
      channel: "league-stats-with-scout",
      enabled: true,
      ownedByAsker: true,
    },
  ],
  priorIntents: [
    {
      kind: "report",
      reportTitle: "Weekly KDA",
      channel: "league-stats-with-scout",
      state: "consumed",
    },
  ],
};

describe("rubricResults", () => {
  test("keeps rubric order and maps verdicts by index", () => {
    const results = rubricResults(["first", "second"], {
      criteria: [
        { index: 1, verdict: "met", reason: "ok" },
        { index: 0, verdict: "not_met", reason: "missing" },
      ],
    });
    expect(results.map((result) => [result.criterion, result.met])).toEqual([
      ["first", false],
      ["second", true],
    ]);
  });

  test("a criterion the judge skipped is not met", () => {
    const results = rubricResults(["only"], { criteria: [] });
    expect(results[0]?.met).toBe(false);
    expect(results[0]?.reason).toContain("no verdict");
  });
});

describe("scenarioJudgeUserPrompt", () => {
  test("shows the judge who is asking and what the server holds", () => {
    const prompt = scenarioJudgeUserPrompt({
      world: WORLD,
      surface: "discord",
      conversation: [],
      question: "Who am i",
      answer: "You're Tarrow.",
      followUps: [],
      trace: [],
      payloads: [],
      rubric: ["Identifies the asker as Tarrow."],
    });
    expect(prompt).toContain("Asker: Ava (@ava)");
    expect(prompt).toContain(
      "Tarrow (Riot ID Tarrow#NA1, 12 recorded games, linked to the asker, feed in #league-stats-with-scout)",
    );
    expect(prompt).toContain("0. Identifies the asker as Tarrow.");
    expect(prompt).toContain(
      'Scheduled reports: "Weekly KDA" in #league-stats-with-scout (enabled, owned by the asker)',
    );
    expect(prompt).toContain("confirmed; the report exists");
  });

  test("shows a voice turn's spoken answer", () => {
    const prompt = scenarioJudgeUserPrompt({
      world: WORLD,
      surface: "voice",
      conversation: [],
      question: "Who am i",
      answer: "You're Tarrow, linked to Tarrow#NA1.",
      spokenAnswer: "You're Tarrow.",
      followUps: [],
      trace: [],
      payloads: [],
      rubric: ["Answers."],
    });
    expect(prompt).toContain("Spoken to the user (voice): You're Tarrow.");
  });

  test("says so when the turn produced no answer", () => {
    const prompt = scenarioJudgeUserPrompt({
      world: WORLD,
      surface: "web",
      conversation: [],
      question: "Who am i",
      answer: null,
      followUps: [],
      trace: [],
      payloads: [],
      rubric: ["Answers."],
    });
    expect(prompt).toContain("(no answer — the turn failed)");
  });
});
