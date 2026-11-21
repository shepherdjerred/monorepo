import { describe, expect, test } from "vitest";
import { SaveQualityProfileSchema } from "#shared/api.ts";
import {
  blankProfile,
  buildProfile,
  readProfile,
  type ProfileFormState,
} from "./profile-model.ts";

const ID = "00000000-0000-4000-8000-00000000000a";

function editable(profile: { name: string; rules: unknown }): ProfileFormState {
  const read = readProfile(profile);
  if (read.kind !== "editable") throw new Error(`Profile is ${read.kind}`);
  return read.state;
}

/** Rules through the form and back, as the request would carry them. */
function roundTrip(name: string, rules: unknown) {
  const built = buildProfile(editable({ name, rules }), {
    id: ID,
    expectedVersion: 4,
  });
  if (!built.ok) throw new Error(JSON.stringify(built.problems));
  return built.body;
}

const plain = {
  qualities: ["WEB-720p", "WEB-1080p", "Bluray-1080p"],
  rejectedCodecs: ["AV1"],
  requiredAudioLanguages: ["en", "ja"],
  minimumBytes: 700 * 1024 ** 2,
  maximumBytes: 25 * 1024 ** 3,
  minimumScore: 0,
  tagScores: { HDR: 20, "group:FLUX": 150, REPACK: 5, PROPER: -3.5 },
  cutoffQuality: "WEB-1080p",
  cutoffScore: 20,
};

/** A custom-format rule whose field holds JSON only the source understands. */
const remasterSpecification = {
  required: false,
  negate: false,
  fields: [{ name: "value", value: { nested: ["any", 1, null] } }],
  implementation: "EditionSpecification",
  name: "Remaster",
};

/** A profile as Radarr held it. */
const captured = {
  schemaVersion: 1,
  source: "radarr",
  sourceVersion: "6.4.4.10685",
  sourceCommit: "a".repeat(40),
  capturedAt: "2026-10-01T12:00:00.000Z",
  snapshotHash: "b".repeat(64),
  properPreference: "doNotPrefer",
  profile: {
    id: 4,
    name: "HD-1080p",
    upgradeAllowed: true,
    cutoff: 7,
    minFormatScore: 0,
    cutoffFormatScore: 0,
    minUpgradeFormatScore: 1,
    items: [
      {
        quality: {
          id: 7,
          name: "Bluray-1080p",
          source: "bluray",
          resolution: 1080,
        },
        allowed: true,
        items: [],
      },
    ],
    formatItems: [{ format: 31, name: "Remaster", score: 25 }],
  },
  customFormats: [
    {
      specifications: [remasterSpecification],
      includeCustomFormatWhenRenaming: true,
      name: "Remaster",
      id: 31,
    },
  ],
  qualityDefinitions: [],
};

describe("a profile through its form", () => {
  test.each([
    ["plain rules", plain],
    [
      "sizes that are no round number of any unit",
      { ...plain, minimumBytes: 1, maximumBytes: 107_374_182_401 },
    ],
    ["no smallest size", { ...plain, minimumBytes: 0 }],
    [
      "one quality and nothing else",
      {
        ...plain,
        qualities: ["WEB-1080p"],
        rejectedCodecs: [],
        requiredAudioLanguages: [],
        tagScores: {},
      },
    ],
    [
      "scores that are not whole, large, or negative",
      {
        ...plain,
        minimumScore: -0.25,
        cutoffScore: 1e21,
        tagScores: { "10": 0.1, DV: -100_000, "a b": 3 },
      },
    ],
    ["a captured profile", { ...plain, resolved: captured }],
  ])("%s come back as they went in", (_name, rules) => {
    expect(roundTrip("Movies", rules)).toEqual({
      id: ID,
      name: "Movies",
      expectedVersion: 4,
      rules,
    });
  });

  test("the request is what the schema makes of the stored profile", () => {
    // A key the schema does not name, inside the captured profile, is the
    // one thing parsing changes. The form sends what the old JSON box sent.
    const rules = {
      ...plain,
      resolved: { ...captured, profile: { ...captured.profile, extra: 1 } },
    };
    expect(editable({ name: "Movies", rules }).resolved).toContain('"extra"');
    expect(roundTrip("Movies", rules)).toEqual(
      SaveQualityProfileSchema.parse({
        id: ID,
        name: "Movies",
        expectedVersion: 4,
        rules,
      }),
    );
  });

  test("qualities are shown most wanted first and stored the other way", () => {
    const state = editable({ name: "Movies", rules: plain });
    expect(state.qualities).toEqual(["Bluray-1080p", "WEB-1080p", "WEB-720p"]);
    const moved = {
      ...state,
      qualities: ["WEB-1080p", "Bluray-1080p", "WEB-720p"],
    };
    const built = buildProfile(moved, { id: ID, expectedVersion: 4 });
    expect(built.ok && built.body.rules.qualities).toEqual([
      "WEB-720p",
      "Bluray-1080p",
      "WEB-1080p",
    ]);
  });

  test("sizes are shown in the largest unit that states them briefly", () => {
    const state = editable({
      name: "Movies",
      rules: { ...plain, minimumBytes: 1001, maximumBytes: 1536 * 1024 ** 2 },
    });
    expect(state.minimumSize).toEqual({ value: "1001", unit: "B" });
    expect(state.maximumSize).toEqual({ value: "1.5", unit: "GiB" });
  });

  test("a new profile carries no id and expects version 0", () => {
    const state: ProfileFormState = {
      ...blankProfile(),
      name: "  New  ",
      qualities: ["WEB-1080p"],
      cutoffQuality: "WEB-1080p",
      minimumSize: { value: "0.5", unit: "GiB" },
      maximumSize: { value: "20", unit: "GiB" },
    };
    expect(buildProfile(state, { expectedVersion: 0 })).toEqual({
      ok: true,
      body: {
        name: "New",
        expectedVersion: 0,
        rules: {
          qualities: ["WEB-1080p"],
          rejectedCodecs: [],
          requiredAudioLanguages: [],
          minimumBytes: 536_870_912,
          maximumBytes: 21_474_836_480,
          minimumScore: 0,
          tagScores: {},
          cutoffQuality: "WEB-1080p",
          cutoffScore: 0,
        },
      },
    });
  });
});

describe("a profile the form cannot send", () => {
  const state = editable({ name: "Movies", rules: plain });
  function problems(patch: Partial<ProfileFormState>) {
    const built = buildProfile({ ...state, ...patch }, { expectedVersion: 1 });
    return built.ok ? {} : built.problems;
  }

  test("names each field that is wrong", () => {
    expect(
      problems({
        name: " ",
        cutoffQuality: "Remux-2160p",
        cutoffScore: "",
        minimumScore: "many",
        minimumSize: { value: "30", unit: "GiB" },
        tagScores: [
          { id: "a", key: "HDR", score: "1" },
          { id: "b", key: "HDR", score: "" },
          { id: "c", key: "", score: "2" },
        ],
        resolved: "{",
      }),
    ).toEqual({
      name: "Give the profile a name.",
      cutoffQuality: "Choose one of the qualities listed above.",
      cutoffScore: "Enter a number.",
      minimumScore: "Enter a number.",
      maximumSize: "The largest file cannot be smaller than the smallest.",
      "tagScores.b.key": "This is already listed.",
      "tagScores.b.score": "Enter a number.",
      "tagScores.c.key": "Name what this score is for.",
      resolved: "This is not valid JSON.",
    });
  });

  test("needs a quality, a size above nothing, and a real captured profile", () => {
    expect(problems({ qualities: [] })).toEqual({
      qualities: "Add at least one quality.",
    });
    expect(problems({ maximumSize: { value: "0", unit: "GiB" } })).toEqual({
      maximumSize: "Enter a size above 0.",
    });
    expect(problems({ resolved: '{"source":"lidarr"}' })["resolved"]).toMatch(
      /^This is not a captured profile\. /u,
    );
  });
});

describe("stored rules the form does not take", () => {
  test("a profile that follows the guide is left to the guide", () => {
    const managedGuide = {
      schemaVersion: 1,
      preset: "living-room-v1",
      kind: "movie",
      revision: "c".repeat(40),
      contentHash: "d".repeat(64),
      scoreOverrides: {},
    };
    expect(
      readProfile({ name: "Living room", rules: { ...plain, managedGuide } }),
    ).toEqual({ kind: "managed" });
  });

  test.each([
    [
      "a value outside an enum",
      { ...plain, resolved: { ...captured, source: "lidarr" } },
      /^resolved\.source: /u,
    ],
    ["a field the schema does not know", { ...plain, hdr: true }, /hdr/u],
    ["a missing field", { qualities: ["WEB-1080p"] }, /^rejectedCodecs: /u],
  ])("%s is reported, not edited around", (_name, rules, problem) => {
    const read = readProfile({ name: "Movies", rules });
    expect(read.kind).toBe("unreadable");
    expect(read.kind === "unreadable" && read.problems.join("\n")).toMatch(
      problem,
    );
  });
});
