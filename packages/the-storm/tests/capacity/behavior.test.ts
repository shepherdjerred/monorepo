import { expect, it } from "vitest";
import {
  capacityBehaviorFixture,
  authoredExperienceFixture,
} from "#capacity-fixtures/behavior.ts";
import {
  verifyCapacityBehavior,
  authoredExperienceFromReadout,
} from "./behavior.ts";

const expected = {
  match: "00000000-0000-4000-8000-000000000999",
  map: "apex-expanse",
  total: 64,
  hostDifficulty: "NORMAL" as const,
  authoredExperience: authoredExperienceFixture.description,
};
const fixture = () =>
  capacityBehaviorFixture(expected.match, expected.total, expected.map);

it("reports installed Normal host profiles distinctly from the authored Hard experience", () => {
  const raw = fixture();
  const actual = verifyCapacityBehavior(raw, expected);
  expect(actual.experience).toContain("difficulty=hard");
  expect(actual.host.currentDifficulty).toBe("NORMAL");
  expect(actual.profiles).toHaveLength(63);
  raw.profiles.forEach((profile, index) => {
    profile.personality = `different-unique-${index.toString()}`;
  });
  expect(() => verifyCapacityBehavior(raw, expected)).not.toThrow();
  expect(() =>
    verifyCapacityBehavior(raw, { ...expected, hostDifficulty: "HARD" }),
  ).toThrow("candidate");
});

it("rejects unfrozen, disabled, foreign or next-round host difficulty", () => {
  for (const change of [
    { enabled: false },
    { locked: false },
    { host: null },
    { host: "00000000-0000-4000-8000-000000000888" },
    { match: "00000000-0000-4000-8000-000000000888" },
    { currentDifficulty: "HARD" },
    { selectedDifficulty: "HARD" },
  ]) {
    const raw = fixture();
    expect(() =>
      verifyCapacityBehavior(
        { ...raw, host: { ...raw.host, ...change } },
        expected,
      ),
    ).toThrow();
  }
});

it("requires every actual bot body and one installed profile per personality", () => {
  const raw = fixture();
  const first = raw.profiles[0];
  const second = raw.profiles[1];
  if (first === undefined || second === undefined)
    throw new Error("missing synthetic profiles");
  for (const profiles of [
    raw.profiles.slice(1),
    [first, first, ...raw.profiles.slice(2)],
    [{ ...first, body: raw.humans[0] }, ...raw.profiles.slice(1)],
    [
      first,
      { ...second, personality: first.personality },
      ...raw.profiles.slice(2),
    ],
    [
      { ...first, levers: { ...first.levers, cps: 100 } },
      ...raw.profiles.slice(1),
    ],
  ])
    expect(() =>
      verifyCapacityBehavior({ ...raw, profiles }, expected),
    ).toThrow();
  expect(() =>
    verifyCapacityBehavior(
      { ...raw, bots: [raw.bots[0], ...raw.bots.slice(0, -1)] },
      expected,
    ),
  ).toThrow();
  expect(() =>
    verifyCapacityBehavior({ ...raw, phase: "ENDED" }, expected),
  ).toThrow();
});

it("rejects changed authored metadata and another original match or map", () => {
  const raw = fixture();
  expect(() =>
    verifyCapacityBehavior(
      { ...raw, experience: raw.experience.replace("hard", "normal") },
      expected,
    ),
  ).toThrow("fingerprint");
  expect(() =>
    verifyCapacityBehavior(raw, { ...expected, map: "warlords-castles" }),
  ).toThrow("candidate");
  expect(() =>
    verifyCapacityBehavior(raw, {
      ...expected,
      match: "00000000-0000-4000-8000-000000000888",
    }),
  ).toThrow("candidate");
});

it("binds actual runtime settings, permits only seed variation and rejects changed styles or pools", () => {
  expect(authoredExperienceFromReadout(authoredExperienceFixture.readout)).toBe(
    expected.authoredExperience,
  );
  expect(
    authoredExperienceFromReadout(
      "§6[RWF] Current game: normal difficulty, teamplay style, medium variety. Maps: apex-expanse, warlords-castles; kits: archer, trooper.",
    ),
  ).toBe(
    "difficulty=normal;style=teamplay;variety=medium;maps=apex-expanse,warlords-castles;kits=archer,trooper",
  );
  for (const invalid of [
    "The match is still being prepared.",
    `${authoredExperienceFixture.readout}\n${authoredExperienceFixture.readout}`,
    authoredExperienceFixture.readout.replace(
      "kits: all",
      "kits: trooper, archer",
    ),
    authoredExperienceFixture.readout.replace(
      "kits: all",
      "kits: trooper, trooper",
    ),
  ])
    expect(() => authoredExperienceFromReadout(invalid)).toThrow();
  for (const change of [
    ["seed=1", "seed=-9223372036854775808"],
    ["style=varied", "style=push"],
    ["variety=high", "variety=low"],
    ["maps=;", "maps=apex-expanse;"],
    ["kits=", "kits=trooper"],
  ]) {
    const raw = fixture();
    const [before, after] = change;
    if (before === undefined || after === undefined)
      throw new Error("missing synthetic mutation");
    raw.experience = raw.experience.replace(before, after);
    raw.experienceFingerprint = new Bun.CryptoHasher("sha256")
      .update(raw.experience)
      .digest("hex");
    if (before === "seed=1")
      expect(() => verifyCapacityBehavior(raw, expected)).not.toThrow();
    else
      expect(() => verifyCapacityBehavior(raw, expected)).toThrow(
        "candidate settings",
      );
  }
});
