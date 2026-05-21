import { describe, expect, test } from "bun:test";
import { RawMatchSchema } from "#src/league/raw-match.schema.ts";
import { buildLanePriorArtifact } from "#src/lane-priors/build.ts";
import { evaluateLanePriors } from "#src/lane-priors/eval.ts";

async function loadFixtureMatch() {
  const raw: unknown = await Bun.file("../../testdata/rift.json").json();
  return RawMatchSchema.parse(raw);
}

function reorderMatchByPostmatchLane(
  match: Awaited<ReturnType<typeof loadFixtureMatch>>,
) {
  const positions = ["UTILITY", "BOTTOM", "MIDDLE", "JUNGLE", "TOP"] as const;
  const participants = [100, 200].flatMap((teamId) =>
    positions.map((position) => {
      const participant = match.info.participants.find(
        (candidate) =>
          candidate.teamId === teamId && candidate.teamPosition === position,
      );
      if (participant === undefined) {
        throw new Error(
          `Missing participant for team ${teamId.toString()} position ${position}`,
        );
      }
      return participant;
    }),
  );

  return RawMatchSchema.parse({
    ...match,
    info: {
      ...match.info,
      participants,
    },
  });
}

describe("evaluateLanePriors", () => {
  test("evaluates blinded postmatch data", async () => {
    const match = await loadFixtureMatch();
    const artifact = buildLanePriorArtifact({
      matches: [match],
      queueIds: [match.info.queueId],
      sourceStartDate: "2026-05-16",
      sourceEndDate: "2026-05-16",
      generatedAt: "2026-05-16T00:00:00.000Z",
    });

    const report = evaluateLanePriors({
      matches: [match],
      artifact,
      sourceStartDate: "2026-05-16",
      sourceEndDate: "2026-05-16",
      queueIds: [match.info.queueId],
      sampleSize: 1,
      seed: "test-seed",
      threshold: 0.95,
      generatedAt: "2026-05-16T00:00:00.000Z",
    });

    expect(report.matchCount).toBe(1);
    expect(report.participantCount).toBe(10);
    expect(report.participantAccuracy).toBe(1);
  });

  test("fails fast below threshold", async () => {
    const match = await loadFixtureMatch();
    const reorderedMatch = reorderMatchByPostmatchLane(match);
    const artifact = buildLanePriorArtifact({
      matches: [match],
      queueIds: [match.info.queueId],
      sourceStartDate: "2026-05-16",
      sourceEndDate: "2026-05-16",
      generatedAt: "2026-05-16T00:00:00.000Z",
    });

    expect(() =>
      evaluateLanePriors({
        matches: [reorderedMatch],
        artifact: {
          ...artifact,
          champions: [],
          spellPairs: [],
        },
        sourceStartDate: "2026-05-16",
        sourceEndDate: "2026-05-16",
        queueIds: [match.info.queueId],
        sampleSize: 1,
        seed: "test-seed",
        threshold: 0.95,
        generatedAt: "2026-05-16T00:00:00.000Z",
      }),
    ).toThrow("below threshold");
  });
});
