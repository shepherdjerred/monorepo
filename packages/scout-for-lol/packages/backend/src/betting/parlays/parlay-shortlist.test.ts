import { describe, expect, test } from "vitest";
import {
  ChampionTagSchema,
  LaneSchema,
  type ChampionTag,
  type Lane,
} from "@scout-for-lol/data";
import {
  buildParlayShortlist,
  eligibleParticipantFields,
  parlayPingBucket,
  type ParlayShortlistSubject,
} from "#src/betting/parlays/parlay-shortlist.ts";

const SUBJECTS: readonly ParlayShortlistSubject[] = [
  { key: "P1", lane: "top", tags: ["Fighter", "Tank"] },
  { key: "P2", lane: "jungle", tags: ["Assassin"] },
  { key: "P3", lane: "middle", tags: ["Mage"] },
  { key: "P4", lane: "adc", tags: ["Marksman"] },
  { key: "P5", lane: "support", tags: ["Support", "Mage"] },
];

describe("parlay shortlist", () => {
  test("is ordered, deterministic, and independent of subject source order", () => {
    const input = { matchId: "NA1_123", subjects: SUBJECTS };
    const first = buildParlayShortlist(input);

    expect(buildParlayShortlist(input)).toEqual(first);
    expect(
      buildParlayShortlist({
        matchId: input.matchId,
        subjects: SUBJECTS.toReversed().map((subject) => ({
          ...subject,
          tags: subject.tags.toReversed(),
        })),
      }),
    ).toEqual(first);
    expect(
      buildParlayShortlist({ ...input, matchId: "NA1_124" }).candidates,
    ).not.toEqual(first.candidates);
  });

  test.each([1, 2, 3, 4, 5])(
    "allocates exactly 16 player and four global targets across %i subjects",
    (subjectCount) => {
      const subjects = SUBJECTS.slice(0, subjectCount);
      const shortlist = buildParlayShortlist({
        matchId: `NA1_${subjectCount.toString()}`,
        subjects,
      });
      const players = shortlist.candidates.filter(
        (candidate) => candidate.kind === "participant_numeric",
      );
      const globals = shortlist.candidates.filter(
        (candidate) => candidate.kind !== "participant_numeric",
      );

      expect(players).toHaveLength(16);
      expect(globals).toHaveLength(4);
      expect(
        new Set(
          shortlist.candidates.map((candidate) => JSON.stringify(candidate)),
        ).size,
      ).toBe(20);
      const counts = subjects.map(
        (subject) =>
          players.filter((candidate) => candidate.subject === subject.key)
            .length,
      );
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      expect(counts.every((count) => count > 0)).toBe(true);
    },
  );

  test("uses only the union of universal, lane, and champion-tag fields", () => {
    const shortlist = buildParlayShortlist({
      matchId: "NA1_eligibility",
      subjects: SUBJECTS,
    });
    for (const subject of SUBJECTS) {
      const eligible = new Set(eligibleParticipantFields(subject));
      const selected = shortlist.candidates
        .filter((candidate) => candidate.kind === "participant_numeric")
        .filter((candidate) => candidate.subject === subject.key);
      expect(
        selected.every((candidate) =>
          eligible.has(candidate.participantNumericField),
        ),
      ).toBe(true);
    }
  });

  test("accepts coarse Support-tag healing eligibility", () => {
    expect(
      eligibleParticipantFields({ lane: "middle", tags: ["Support"] }),
    ).toContain("totalHealsOnTeammates");
  });

  const laneTagCases = LaneSchema.options.flatMap((lane: Lane) =>
    ChampionTagSchema.options.map((tag: ChampionTag) => ({ lane, tag })),
  );

  test.each(laneTagCases)(
    "keeps at least 16 eligible fields for $lane $tag",
    ({ lane, tag }) => {
      expect(
        eligibleParticipantFields({ lane, tags: [tag] }).length,
      ).toBeGreaterThanOrEqual(16);
    },
  );

  test("admits pings in exactly one hash bucket and selects one subtype deterministically", () => {
    const representativeByBucket = new Map<number, string>();
    for (let index = 0; representativeByBucket.size < 16; index += 1) {
      const matchId = `NA1_ping_${index.toString()}`;
      representativeByBucket.set(parlayPingBucket(matchId), matchId);
    }
    expect(
      [...representativeByBucket.keys()].toSorted((a, b) => a - b),
    ).toEqual(Array.from({ length: 16 }, (_, index) => index));

    for (const [bucket, matchId] of representativeByBucket) {
      const first = buildParlayShortlist({ matchId, subjects: SUBJECTS });
      const pings = first.candidates.filter(
        (candidate) => candidate.kind === "opponent_team_pings",
      );
      expect(pings).toHaveLength(bucket === 0 ? 1 : 0);
      expect(
        buildParlayShortlist({ matchId, subjects: SUBJECTS }).candidates.filter(
          (candidate) => candidate.kind === "opponent_team_pings",
        ),
      ).toEqual(pings);
    }
  });
});
