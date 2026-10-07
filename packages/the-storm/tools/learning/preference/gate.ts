import { z } from "zod";
import { DuelStateSchema } from "#learning/duels.ts";
import { InferenceMetrics } from "#learning/inference.ts";
import contract from "./contract.json";

if (
  JSON.stringify(contract) !==
  JSON.stringify({
    version: 1,
    pairs: 20,
    minimumLearnedVotes: 15,
    firstSeed: 600_100_000,
    candidate: "first-sealed-pilot-seed",
    map: "training-yard",
    opponent: "authored",
    sides: ["red", "blue"],
    video: { width: 1280, height: 720, fps: 30, seconds: 30 },
    window: "first-600-live-ticks-hold-terminal-frame",
    choices: ["A", "B", "tie"],
  })
)
  throw new Error("unsupported blind preference contract");

export const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
const Pair = z.number().int().min(1).max(contract.pairs);
const Clip = z
  .object({
    video: z.string().min(1),
    recording: z.string().min(1),
    metrics: InferenceMetrics.nullable(),
    state: DuelStateSchema.refine((state) =>
      ["win", "loss", "draw", "timeout"].includes(state.result),
    ),
  })
  .strict();

export const CaptureSet = z
  .object({
    version: z.literal(1),
    engine: z.literal("Paper"),
    acceptance: z.literal("unaccepted"),
    actor_sha256: Digest,
    native_sha256: Digest,
    retries: z.literal(0),
    window: z.literal(contract.window),
    camera: z
      .object({
        position: z.tuple([z.number(), z.number(), z.number()]),
        yaw: z.number().min(-180).max(180),
        pitch: z.number().min(-90).max(90),
        fov: z.number().min(30).max(110),
        hud: z.literal(false),
        nameplates: z.literal(false),
      })
      .strict(),
    pairs: z
      .array(z.object({ pair: Pair, learned: Clip, authored: Clip }).strict())
      .length(contract.pairs),
  })
  .strict();
export type CaptureSet = z.infer<typeof CaptureSet>;

export function preferenceSchedule() {
  return Array.from({ length: contract.pairs }, (_, index) => ({
    pair: index + 1,
    seed: contract.firstSeed + Math.floor(index / 2),
    side: index % 2 === 0 ? "red" : "blue",
  }));
}

/** Every scheduled match is required, including losses and early endings. */
export function validateCaptures(raw: unknown) {
  const captures = CaptureSet.parse(raw);
  const schedule = preferenceSchedule();
  const identities: string[] = [];
  captures.pairs.forEach((pair, index) => {
    const expected = schedule[index];
    if (pair.pair !== expected?.pair)
      throw new Error("preference captures differ from frozen schedule");
    for (const [kind, clip] of [
      ["learned", pair.learned],
      ["authored", pair.authored],
    ] as const) {
      const state = clip.state;
      if (
        state.match === "" ||
        state.seed !== expected.seed ||
        state.side !== expected.side ||
        state.opponent !== contract.opponent ||
        state.mode !== (kind === "learned" ? "external" : "authored") ||
        (kind === "learned" && state.applied === 0) ||
        (kind === "authored" &&
          (state.applied !== 0 || clip.metrics !== null)) ||
        (kind === "learned" &&
          (clip.metrics?.delivery.applied !== state.applied ||
            clip.metrics.delivery.unavailable +
              clip.metrics.delivery.ineligible !==
              state.fallback))
      )
        throw new Error(
          "preference clip has the wrong native controller or matchup",
        );
      identities.push(state.match);
    }
  });
  if (new Set(identities).size !== contract.pairs * 2)
    throw new Error("preference captures reuse a native match");
  return captures;
}

const Label = z.enum(["A", "B"]);
export const Review = z
  .object({
    version: z.literal(1),
    question: z.literal(
      "Which version of the indicated fighter behaves more like a human player?",
    ),
    choices: z.tuple([z.literal("A"), z.literal("B"), z.literal("tie")]),
    pairs: z
      .array(
        z
          .object({
            pair: Pair,
            subject: z.enum(["red fighter", "blue fighter"]),
            A: z.object({ file: z.string(), sha256: Digest }).strict(),
            B: z.object({ file: z.string(), sha256: Digest }).strict(),
          })
          .strict(),
      )
      .length(contract.pairs),
  })
  .strict();
export type Review = z.infer<typeof Review>;
export const AnswerKey = z
  .object({
    version: z.literal(1),
    actor_sha256: Digest,
    review_sha256: Digest,
    pairs: z
      .array(z.object({ pair: Pair, learned: Label }).strict())
      .length(contract.pairs),
  })
  .strict();
export type AnswerKey = z.infer<typeof AnswerKey>;
export const Ballot = z
  .object({
    version: z.literal(1),
    review_sha256: Digest,
    source: z.literal("manual-human-review"),
    answers: z
      .array(
        z
          .object({
            pair: Pair,
            choice: z.enum(["A", "B", "tie"]),
            reason: z.string().max(1000),
          })
          .strict(),
      )
      .length(contract.pairs),
  })
  .strict();

/** The denominator is always twenty; ties and authored votes are non-wins. */
export function preferenceResult(
  rawReview: unknown,
  rawKey: unknown,
  rawBallot: unknown,
) {
  const review = Review.parse(rawReview);
  const key = AnswerKey.parse(rawKey);
  const ballot = Ballot.parse(rawBallot);
  if (ballot.review_sha256 !== key.review_sha256)
    throw new Error("ballot refers to a different review");
  const rows = review.pairs.map((pair, index) => {
    const learned = key.pairs[index];
    const answer = ballot.answers[index];
    if (
      pair.pair !== index + 1 ||
      pair.subject !== (index % 2 === 0 ? "red fighter" : "blue fighter") ||
      learned?.pair !== pair.pair ||
      answer?.pair !== pair.pair ||
      pair.A.file !== `pair-${pair.pair.toString().padStart(2, "0")}-A.mp4` ||
      pair.B.file !== `pair-${pair.pair.toString().padStart(2, "0")}-B.mp4`
    )
      throw new Error(
        "review, answer key and ballot do not contain the frozen twenty pairs",
      );
    return {
      pair: pair.pair,
      preferred:
        answer.choice === "tie"
          ? "tie"
          : answer.choice === learned.learned
            ? "learned"
            : "authored",
      reason: answer.reason,
    };
  });
  if (
    new Set(review.pairs.flatMap((pair) => [pair.A.sha256, pair.B.sha256]))
      .size !== 40
  )
    throw new Error("blind review reuses a clip");
  const learnedVotes = rows.filter((row) => row.preferred === "learned").length;
  return {
    version: 1,
    acceptance: "unaccepted",
    actor_sha256: key.actor_sha256,
    review_sha256: key.review_sha256,
    pairs: rows.length,
    learnedVotes,
    authoredVotes: rows.filter((row) => row.preferred === "authored").length,
    ties: rows.filter((row) => row.preferred === "tie").length,
    minimumLearnedVotes: contract.minimumLearnedVotes,
    passed: learnedVotes >= contract.minimumLearnedVotes,
    pilotAcceptanceChecked: false,
    learnedControlEnabled: false,
    rows,
  };
}
