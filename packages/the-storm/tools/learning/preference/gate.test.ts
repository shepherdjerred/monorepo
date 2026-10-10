import { describe, expect, it } from "vitest";
import {
  preferenceResult,
  preferenceSchedule,
  validateCaptures,
} from "./gate.ts";
import type { Review, AnswerKey } from "./gate.ts";
import { sha } from "./ledger.ts";
import wire from "#learning-wire";

const fingerprint = sha("unit fixture, never pilot evidence");
const review: Review = {
  version: 1,
  question:
    "Which version of the indicated fighter behaves more like a human player?",
  choices: ["A", "B", "tie"],
  pairs: preferenceSchedule().map((match) => ({
    pair: match.pair,
    subject: match.side === "red" ? "red fighter" : "blue fighter",
    A: {
      file: `pair-${match.pair.toString().padStart(2, "0")}-A.mp4`,
      sha256: sha(`A${match.pair.toString()}`),
    },
    B: {
      file: `pair-${match.pair.toString().padStart(2, "0")}-B.mp4`,
      sha256: sha(`B${match.pair.toString()}`),
    },
  })),
};
const key: AnswerKey = {
  version: 1,
  actor_sha256: fingerprint,
  review_sha256: fingerprint,
  pairs: review.pairs.map((pair) => ({
    pair: pair.pair,
    learned: pair.pair % 3 === 0 ? "B" : "A",
  })),
};
function ballot(wins: number) {
  return {
    version: 1,
    review_sha256: fingerprint,
    source: "manual-human-review",
    answers: key.pairs.map((pair, index) => ({
      pair: pair.pair,
      choice: index < wins ? pair.learned : "tie",
      reason: "unit fixture",
    })),
  };
}
function captures() {
  return {
    version: 1,
    engine: "Paper",
    acceptance: "unaccepted",
    actor_sha256: fingerprint,
    native_sha256: fingerprint,
    retries: 0,
    window: "first-600-live-ticks-hold-terminal-frame",
    camera: {
      position: [31, 70, 14],
      yaw: 180,
      pitch: 20,
      fov: 70,
      hud: false,
      nameplates: false,
    },
    pairs: preferenceSchedule().map((match, index) => {
      const clip = (learned: boolean) => ({
        video: `${(index * 2 + Number(learned)).toString()}.mp4`,
        recording: `${index.toString()}.rwfrec.gz`,
        metrics: learned
          ? {
              inference: {
                submitted: 1,
                skipped: 0,
                timely: 1,
                stale: 0,
                expired: 0,
                contextDrops: 0,
                deadlineMet: 1,
                deadlineMissed: 0,
                resets: 0,
                rejected: 0,
                hits: 1,
                misses: 0,
                maximumNanos: 1,
                maximumBatch: 1,
              },
              delivery: { applied: 1, unavailable: 0, ineligible: 0 },
            }
          : null,
        state: {
          protocol: wire.version,
          contract: wire.contract,
          seed: match.seed,
          side: match.side,
          mode: learned ? "external" : "authored",
          opponent: "authored",
          result: "loss",
          phase: "ENDED",
          match: `00000000-0000-4000-8000-${(index * 2 + Number(learned)).toString().padStart(12, "0")}`,
          dealt: 0,
          received: 20,
          sampleDealt: 0,
          sampleReceived: 0,
          sampleTick: 20,
          used: [],
          applied: Number(learned),
          fallback: 0,
        },
      });
      return { pair: match.pair, learned: clip(true), authored: clip(false) };
    }),
  };
}

describe("blind human preference gate", () => {
  it("requires fifteen learned votes among all twenty pairs; ties retain their denominator", () => {
    expect(preferenceResult(review, key, ballot(14))).toMatchObject({
      passed: false,
      pairs: 20,
      learnedVotes: 14,
      ties: 6,
    });
    expect(preferenceResult(review, key, ballot(15))).toMatchObject({
      passed: true,
      acceptance: "unaccepted",
      learnedVotes: 15,
      ties: 5,
      pilotAcceptanceChecked: false,
      learnedControlEnabled: false,
    });
    const answers = ballot(15);
    const last = answers.answers[19];
    if (last === undefined) throw new Error("fixture lacks twentieth answer");
    last.choice = key.pairs[19]?.learned === "A" ? "B" : "A";
    expect(preferenceResult(review, key, answers)).toMatchObject({
      authoredVotes: 1,
      ties: 4,
      learnedVotes: 15,
    });
  });

  it("rejects partial, repeated, reordered, unbound and automated ballots", () => {
    const original = ballot(15);
    for (const altered of [
      { ...original, answers: original.answers.slice(1) },
      {
        ...original,
        answers: [original.answers[0], ...original.answers.slice(0, 19)],
      },
      { ...original, answers: original.answers.toReversed() },
      { ...original, review_sha256: sha("wrong pack") },
      { ...original, source: "automated" },
      { ...original, passed: true },
    ])
      expect(() => preferenceResult(review, key, altered)).toThrow();
    expect(() =>
      preferenceResult(review, key, {
        ...original,
        answers: original.answers.map((answer) => ({
          ...answer,
          choice: null,
        })),
      }),
    ).toThrow();
  });

  it("rejects reused footage and filenames or subjects that reveal the wrong matchup", () => {
    const first = review.pairs[0];
    if (first === undefined) throw new Error("fixture lacks first pair");
    for (const changed of [
      { ...first, A: first.B },
      { ...first, A: { ...first.A, file: "learned-actor.mp4" } },
      { ...first, subject: "blue fighter" },
    ])
      expect(() =>
        preferenceResult(
          { ...review, pairs: [changed, ...review.pairs.slice(1)] },
          key,
          ballot(15),
        ),
      ).toThrow();
  });

  it("freezes paired sides at fresh seeds and retains capture losses", () => {
    const schedule = preferenceSchedule();
    expect(schedule.slice(0, 2)).toEqual([
      { pair: 1, seed: 600_100_000, side: "red" },
      { pair: 2, seed: 600_100_000, side: "blue" },
    ]);
    expect(validateCaptures(captures()).pairs).toHaveLength(20);
  });

  it("rejects missing matches, duplicate matches, retries and mismatched native controller evidence", () => {
    const original = captures();
    const first = original.pairs[0];
    if (first === undefined) throw new Error("fixture lacks first capture");
    for (const changed of [
      { ...first, learned: { ...first.learned, state: first.authored.state } },
      { ...first, learned: { ...first.learned, metrics: null } },
      {
        ...first,
        learned: {
          ...first.learned,
          state: { ...first.learned.state, applied: 2 },
        },
      },
      {
        ...first,
        authored: {
          ...first.authored,
          state: { ...first.authored.state, match: first.learned.state.match },
        },
      },
      {
        ...first,
        learned: {
          ...first.learned,
          state: { ...first.learned.state, seed: 123 },
        },
      },
    ])
      expect(() =>
        validateCaptures({
          ...original,
          pairs: [changed, ...original.pairs.slice(1)],
        }),
      ).toThrow();
    expect(() =>
      validateCaptures({ ...original, pairs: original.pairs.slice(1) }),
    ).toThrow();
    expect(() => validateCaptures({ ...original, retries: 1 })).toThrow();
  });
});
