import { expect, test } from "vitest";
import path from "node:path";
import { gameplayFixtures } from "#e2e/gameplay-fixtures.ts";
import { experienceFixtures, playerUuid } from "./rwf-experience.ts";

test("the full gameplay fixture cannot preselect a single candidate in an experience preview", async () => {
  const settings = await gameplayFixtures(
    path.resolve(import.meta.dirname, "../.."),
    "full",
  );
  expect(settings.rwfMap).toBe("training-yard");
  const experience = experienceFixtures(settings);
  expect("rwfMap" in experience).toBe(false);
  expect(experience.rwf.maps).toEqual([
    "training-yard",
    "copperworks",
    "tidewatch",
  ]);
  expect(experience.fixturesJar).toBe(settings.fixturesJar);
  expect(experience.stormConfig).toBe(settings.stormConfig);
});

test("decodes the server's signed UUID words", () => {
  expect(
    playerUuid(
      "StormPreview has the following entity data: [I; 1954008233, 1263220623, -1950473726, -203170414]",
    ),
  ).toBe("7477cca9-4b4b-378f-8bbe-2202f3e3dd92");
});

test("rejects an absent or malformed native preview identity", () => {
  for (const reply of [
    "No entity was found",
    "[I; 1, 2, 3]",
    "[I; 2147483648, 0, 0, 0]",
  ])
    expect(() => playerUuid(reply)).toThrow();
});
