import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import {
  movieCutMatches,
  type MovieCutDecisionV2,
  type MovieCutEvidenceV2,
} from "#shared/movie-editions/cut-v2.ts";

/** Stage admission requires evidence from every selected video member as well as the release. */
export function evaluateMovieCutV2(input: {
  edition: MovieEditionKey;
  phase: "candidate" | "physical";
  candidate: MovieCutEvidenceV2;
  current: readonly MovieCutEvidenceV2[];
  members: readonly MovieCutEvidenceV2[];
}): MovieCutDecisionV2 {
  const reasons = new Set<MovieCutDecisionV2["reasons"][number]>();
  const proposed = [input.candidate, ...input.members];
  const all = [...proposed, ...input.current];
  if (input.phase === "physical" && input.members.length === 0)
    reasons.add("edition_member_evidence_missing");
  if (
    all.some((item) => item.canonicalDigest !== input.candidate.canonicalDigest)
  )
    reasons.add("edition_canonical_mismatch");
  if (
    input.current.some(
      (item) => !movieCutMatches(input.edition, item.conclusion),
    )
  )
    reasons.add("edition_current_requires_classification");
  if (proposed.some((item) => item.conclusion.kind === "ambiguous"))
    reasons.add("edition_evidence_ambiguous");
  const cuts = new Set(
    proposed.flatMap(({ conclusion }) =>
      conclusion.kind === "named"
        ? [conclusion.cut]
        : conclusion.kind === "conflict"
          ? conclusion.cuts
          : [],
    ),
  );
  if (
    cuts.size > 1 ||
    proposed.some((item) => item.conclusion.kind === "conflict")
  )
    reasons.add("edition_evidence_conflict");
  if (proposed.some((item) => !movieCutMatches(input.edition, item.conclusion)))
    reasons.add("edition_candidate_incompatible");
  return {
    schemaVersion: 2,
    edition: input.edition,
    phase: input.phase,
    accepted: reasons.size === 0,
    reasons: [...reasons],
    candidate: input.candidate.conclusion,
    current: input.current.map((item) => item.conclusion),
    members: input.members.map((item) => item.conclusion),
  };
}
