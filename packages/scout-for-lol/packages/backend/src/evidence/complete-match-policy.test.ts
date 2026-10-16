import { expect, test } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";
import { enrichCompleteMatch } from "./complete-match-policy.ts";

const match = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

test("compatible evidence fills absent names without replacing known facts or zeroes", () => {
  const primary = RawMatchSchema.parse({
    ...match,
    info: {
      ...match.info,
      participants: match.info.participants.map(
        ({ summonerName: _name, ...player }) => ({ ...player, kills: 0 }),
      ),
    },
  });
  const evidence = RawMatchSchema.parse({
    ...match,
    info: {
      ...match.info,
      participants: match.info.participants.map((player) => ({
        ...player,
        summonerName: "Recovered name",
        kills: 99,
      })),
    },
  });
  const resolved = enrichCompleteMatch(primary, [evidence]);
  expect(
    resolved.info.participants.every(
      (player) =>
        player.summonerName === "Recovered name" && player.kills === 0,
    ),
  ).toBe(true);
  expect(enrichCompleteMatch(evidence, [primary])).toEqual(evidence);
});

test("contradictory identities and outcomes cannot enrich a complete match", () => {
  const primary = RawMatchSchema.parse({
    ...match,
    info: {
      ...match.info,
      participants: match.info.participants.map(
        ({ summonerName: _name, ...player }) => player,
      ),
    },
  });
  const conflicting = RawMatchSchema.parse({
    ...match,
    info: {
      ...match.info,
      participants: match.info.participants.map((player) => ({
        ...player,
        summonerName: "Wrong",
        win: !player.win,
      })),
    },
  });
  expect(enrichCompleteMatch(primary, [conflicting])).toEqual(primary);
});
