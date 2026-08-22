import { describe, expect, test } from "vitest";
import {
  RawInfoSchema,
  RawParticipantSchema,
  RawTeamSchema,
} from "@scout-for-lol/data";
import {
  EXCLUDED_MATCH_INFO_FIELDS,
  EXCLUDED_PARTICIPANT_FIELDS,
  EXCLUDED_TEAM_FIELDS,
  MatchNumericFieldSchema,
  ParticipantBooleanFieldSchema,
  ParticipantNumericFieldSchema,
  TeamBooleanFieldSchema,
} from "#src/betting/parlay-catalog.ts";

function expectExactClassification(
  schemaKeys: readonly string[],
  allowed: readonly string[],
  excluded: readonly string[],
): void {
  expect(new Set(allowed).intersection(new Set(excluded))).toEqual(new Set());
  expect([...allowed, ...excluded].toSorted()).toEqual(
    [...schemaKeys].toSorted(),
  );
}

describe("parlay field catalog contract", () => {
  test("classifies every top-level RawParticipant field", () => {
    expectExactClassification(
      Object.keys(RawParticipantSchema.shape),
      [
        ...ParticipantNumericFieldSchema.options,
        ...ParticipantBooleanFieldSchema.options,
      ],
      EXCLUDED_PARTICIPANT_FIELDS,
    );
  });

  test("classifies every top-level RawTeam field", () => {
    expectExactClassification(
      Object.keys(RawTeamSchema.shape),
      [...TeamBooleanFieldSchema.options, "objectives"],
      EXCLUDED_TEAM_FIELDS,
    );
  });

  test("classifies every reviewed RawInfo field", () => {
    expectExactClassification(
      Object.keys(RawInfoSchema.shape),
      MatchNumericFieldSchema.options,
      EXCLUDED_MATCH_INFO_FIELDS,
    );
  });
});
