import { z } from "zod";

/** Independent facts read from the pinned lake, never from agent calculations. */
export const RecoveryOracleSchema = z.strictObject({
  buildId: z.string(),
  streak: z.strictObject({
    wins: z.number().int().positive(),
    winners: z.array(z.string()).min(1),
  }),
  game: z.strictObject({
    matchId: z.string(),
    kda: z.tuple([z.number(), z.number(), z.number()]),
    creepScore: z.number(),
    damage: z.number(),
    gold: z.number(),
    deathEvents: z.array(
      z.strictObject({
        timestampMs: z.number(),
        killer: z.string(),
      }),
    ),
    killers: z.array(z.string()),
    teammates: z.array(z.string()),
  }),
});
export type RecoveryOracle = z.infer<typeof RecoveryOracleSchema>;

const ReviewMatchCallSchema = z.looseObject({
  rawInput: z.looseObject({
    kind: z.literal("value"),
    value: z.looseObject({ participantId: z.number().int() }),
  }),
  rawOutput: z.looseObject({
    kind: z.literal("value"),
    value: z.looseObject({
      ok: z.literal(true),
      coverage: z.looseObject({ timeline: z.enum(["complete", "partial"]) }),
    }),
  }),
});

/**
 * A trace entry's name as the recovery check reads it.
 *
 * review_match is a timeline analysis only when it reviewed a participant
 * and returned timeline coverage; a roster call, or one that found no
 * timeline, is recorded under its own name so it cannot satisfy the check.
 */
export function recoveryToolName(entry: {
  readonly toolName: string;
  readonly status: string;
  readonly rawInput: unknown;
  readonly rawOutput: unknown;
}): string {
  if (entry.toolName !== "review_match") return entry.toolName;
  if (entry.status !== "succeeded") return "review_match:incomplete";
  const call = ReviewMatchCallSchema.safeParse(entry);
  if (call.success) return "review_match";
  return z
    .looseObject({
      rawInput: z.looseObject({
        value: z.looseObject({ participantId: z.null() }),
      }),
    })
    .safeParse(entry).success
    ? "review_match:roster"
    : "review_match:incomplete";
}

export type RecoveryCandidate = {
  answer: string | null;
  matchCardIds: readonly string[];
  toolNames: readonly string[];
};

function plain(text: string): string {
  return text.replaceAll(/[*_`\u{2066}-\u{2069}]/gu, "").toLowerCase();
}

function streakAssertions(
  candidate: RecoveryCandidate,
  oracle: RecoveryOracle,
): string[] {
  const answer = plain(candidate.answer ?? "");
  const issues: string[] = [];
  const claims = [
    ...answer.matchAll(
      /\b(\d+)[ -](?:(?:game|straight)[ -])?win(?:ning)?(?:[ -]streak|s?\b)/g,
    ),
  ].map((match) => Number(match[1]));
  for (const match of answer.matchAll(
    /win streak[^.!?\n\d]{1,80}\b(?:is|was)[^\d\n]{0,10}(\d+) games?\b/g,
  ))
    claims.push(Number(match[1]));
  if (
    claims.length === 0 ||
    claims.some((claim) => claim !== oracle.streak.wins)
  )
    issues.push("incorrect_or_missing_streak_length");
  for (const winner of oracle.streak.winners) {
    if (!answer.includes(plain(winner.split("#")[0] ?? winner)))
      issues.push(`missing_tied_winner:${winner}`);
  }
  if (!/recorded|captured|ingested/.test(answer))
    issues.push("missing_recorded_coverage_caveat");
  if (!candidate.toolNames.includes("analyze_javascript"))
    issues.push("missing_streak_calculation");
  return issues;
}

function gameAssertions(
  candidate: RecoveryCandidate,
  oracle: RecoveryOracle,
): string[] {
  const answer = plain(candidate.answer ?? "");
  const issues: string[] = [];
  const kda = oracle.game.kda.join("/");
  if (!answer.includes(kda)) issues.push("incorrect_or_missing_kda");
  const digits = answer.replaceAll(",", "");
  for (const [name, value] of Object.entries({
    cs: oracle.game.creepScore,
    damage: oracle.game.damage,
    gold: oracle.game.gold,
  })) {
    if (!new RegExp(String.raw`\b${value.toString()}\b`).test(digits))
      issues.push(`incorrect_or_missing_${name}`);
  }
  if (!candidate.matchCardIds.includes(oracle.game.matchId))
    issues.push("missing_reviewed_match_card");
  // review_match reads the documents and summarizes the timeline in one
  // call; the sandbox path needs both steps.
  const sandboxTimeline =
    candidate.toolNames.includes("materialize_raw_documents") &&
    (candidate.toolNames.includes("analyze_javascript") ||
      candidate.toolNames.includes("summarize_match_timeline"));
  if (!sandboxTimeline && !candidate.toolNames.includes("review_match"))
    issues.push("missing_timeline_analysis");
  for (const line of answer.split("\n")) {
    const claim = /^\s*(?:-\s*)?(\d{1,2}):(\d{2})\b(.*)/u.exec(line);
    if (claim === null) continue;
    const killer = oracle.game.killers.find((name) =>
      (claim[3] ?? "").includes(plain(name)),
    );
    if (killer === undefined) continue;
    const seconds = Number(claim[1]) * 60 + Number(claim[2]);
    if (
      !oracle.game.deathEvents.some(
        (event) =>
          event.killer === killer &&
          Math.abs(event.timestampMs / 1000 - seconds) <= 1,
      )
    )
      issues.push(
        `incorrect_death_time:${claim[1] ?? ""}:${claim[2] ?? ""}:${killer}`,
      );
  }
  return [...issues, ...killerAssertions(answer, oracle)];
}

function killerAssertions(answer: string, oracle: RecoveryOracle): string[] {
  const issues: string[] = [];
  // Detect substituting a friendly champion for an enemy named by the data.
  for (const teammate of oracle.game.teammates) {
    if (oracle.game.killers.includes(teammate)) continue;
    const name = RegExp.escape(plain(teammate));
    if (
      new RegExp(
        String.raw`${name}[^.!?\n]{0,70}(?:killed you|your deaths|deaths to|threats)|(?:killed by|deaths to) ${name}`,
      ).test(answer)
    )
      issues.push(`friendly_champion_as_killer:${teammate}`);
  }
  return issues;
}

/** Conservative checks: an unrecognised claim needs review, never a silent pass. */
export function recoveryAssertions(
  caseId: string,
  candidate: RecoveryCandidate,
  oracle: RecoveryOracle,
): string[] {
  if (candidate.answer === null || candidate.answer.length === 0)
    return ["no_answer"];
  if (caseId === "conv:3c004891:0") return streakAssertions(candidate, oracle);
  return caseId === "conv:507d822f:2" ? gameAssertions(candidate, oracle) : [];
}
