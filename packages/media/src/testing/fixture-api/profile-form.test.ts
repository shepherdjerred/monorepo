import { expect, test } from "vitest";
import {
  ProfileListSchema,
  QualityRulesSchema,
  SaveQualityProfileSchema,
} from "#shared/api.ts";
import {
  buildProfile,
  readProfile,
} from "#client/manage/quality/profile-model.ts";
import { profileList } from "./fixtures/profiles.ts";

/**
 * The owner's fixture profiles through the quality profile form: what the
 * form would send for an untouched profile is that profile, whole. This is
 * the proof that the typed form replaced the JSON box without changing a
 * request.
 */
const profiles = ProfileListSchema.parse(profileList());

test("the fixtures cover a guide-managed, a hand-written, and a captured profile", () => {
  const kinds = profiles.map((profile) => {
    const rules = QualityRulesSchema.parse(profile.rules);
    if (rules.managedGuide !== undefined) return "managed";
    return rules.resolved === undefined ? "hand-written" : "captured";
  });
  expect(new Set(kinds)).toEqual(
    new Set(["managed", "hand-written", "captured"]),
  );
});

test.each(profiles)(
  "$name is sent back exactly as it was stored",
  (profile) => {
    const read = readProfile(profile);
    if (QualityRulesSchema.parse(profile.rules).managedGuide !== undefined) {
      // The server refuses these on this endpoint; the form never offers one.
      expect(read).toEqual({ kind: "managed" });
      return;
    }
    if (read.kind !== "editable")
      throw new Error(`${profile.name}: ${read.kind}`);
    const built = buildProfile(read.state, {
      id: profile.id,
      expectedVersion: profile.version,
    });
    if (!built.ok) throw new Error(JSON.stringify(built.problems));
    const stored = {
      id: profile.id,
      name: profile.name,
      expectedVersion: profile.version,
      rules: profile.rules,
    };
    expect(built.body).toEqual(stored);
    // And it is what the JSON box sent: the schema's reading of the same rules.
    expect(built.body).toEqual(SaveQualityProfileSchema.parse(stored));
  },
);
