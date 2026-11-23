import { expect, test } from "bun:test";
import { bindLatestHeroParticipant } from "./latest-participants.mjs";

const replay = {
  roster: [
    { champion: "Sion", team: 100 },
    { champion: "Sion", team: 200 },
    { champion: "Senna", team: 100 },
  ],
  participantSummonerIds: ["9007199254740993", "47750797", "100740525"],
};
const participants = [
  { slot: 5, summonerId: "47750797" },
  { slot: 1, summonerId: "9007199254740993" },
  { slot: 3, summonerId: "100740525" },
];

test("native slots bind mirrors and 64-bit identities independently of metadata order", () => {
  expect(
    bindLatestHeroParticipant(
      { slot: 5, champion: "Sion" },
      participants,
      replay,
    ),
  ).toMatchObject({ team: 200, metadataIndex: 1 });
  expect(
    bindLatestHeroParticipant(
      { slot: 1, champion: "Sion" },
      participants,
      replay,
    ),
  ).toMatchObject({ team: 100, metadataIndex: 0 });
});

test("shuffling metadata preserves original identity rather than champion or index", () => {
  const shuffled = {
    roster: [...replay.roster].reverse(),
    participantSummonerIds: [...replay.participantSummonerIds].reverse(),
  };
  expect(
    bindLatestHeroParticipant(
      { slot: 5, champion: "Sion" },
      participants,
      shuffled,
    ),
  ).toMatchObject({ team: 200, metadataIndex: 1 });
  expect(
    bindLatestHeroParticipant(
      { slot: 3, champion: "Senna" },
      participants,
      shuffled,
    ),
  ).toMatchObject({ team: 100, metadataIndex: 0 });
});

test("missing and ambiguous native/footer identity bindings fail", () => {
  const hero = { slot: 5, champion: "Sion" };
  expect(() => bindLatestHeroParticipant(hero, [], replay)).toThrow(
    "one original participant slot",
  );
  expect(() =>
    bindLatestHeroParticipant(hero, [...participants, participants[0]], replay),
  ).toThrow("one original participant slot");
  expect(() =>
    bindLatestHeroParticipant(hero, participants, {
      ...replay,
      participantSummonerIds: [null, null, null],
    }),
  ).toThrow("uniquely match");
  expect(() =>
    bindLatestHeroParticipant(hero, participants, {
      ...replay,
      participantSummonerIds: ["47750797", "47750797", "100740525"],
    }),
  ).toThrow("uniquely match");
  expect(() =>
    bindLatestHeroParticipant(
      { ...hero, champion: "Senna" },
      participants,
      replay,
    ),
  ).toThrow("champion/team");
});
