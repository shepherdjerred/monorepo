import type {
  CutEvidence,
  CutConclusion,
  CutKind,
  CutReason,
  DefaultEditionDecision,
} from "#shared/editions/evidence.ts";

export function evaluateDefaultCut(input: {
  candidate: CutEvidence;
  current: readonly CutEvidence[];
  members?: readonly CutEvidence[];
}): DefaultEditionDecision {
  const current = input.current.map((item) => item.conclusion);
  const members = (input.members ?? []).map((item) => item.conclusion);
  const proposed = [input.candidate.conclusion, ...members];
  const reasons = new Set<CutReason>();
  if (current.some((item) => item.kind !== "standard_unmarked"))
    reasons.add("edition_current_requires_classification");
  if (proposed.some((item) => item.kind === "named"))
    reasons.add("edition_candidate_incompatible");
  if (proposed.some((item) => item.kind === "ambiguous"))
    reasons.add("edition_evidence_ambiguous");
  const cuts = new Set(proposed.flatMap((item) => namedCuts(item)));
  if (cuts.size > 1 || proposed.some((item) => item.kind === "conflict"))
    reasons.add("edition_evidence_conflict");
  return {
    policy: "standard_unmarked",
    accepted: reasons.size === 0,
    reasons: [...reasons],
    candidate: input.candidate.conclusion,
    current,
    members,
  };
}
function namedCuts(conclusion: CutConclusion): CutKind[] {
  if (conclusion.kind === "named") return [conclusion.cut];
  return conclusion.kind === "conflict" ? conclusion.cuts : [];
}
