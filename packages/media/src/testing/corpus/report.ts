import { z } from "zod";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { LoadedCorpusCase } from "./load.ts";
import { replayCorpusCandidate, type CorpusCandidateResult } from "./replay.ts";
import { replayCorpusPlan } from "./planning.ts";
import { CorpusPlanSchema } from "./contract.ts";

export const CorpusDifferenceSchema = z.enum([
  "wrong_accept",
  "missed_valid",
  "protected_ambiguity",
  "unsupported",
  "ranking_difference",
  "import_plan_difference",
  "unsafe_import_plan",
]);
export const CorpusCaseReportSchema = z.strictObject({
  id: z.string(),
  provenance: z.enum(["synthetic", "captured"]),
  source: z.string(),
  sourceVersion: z.string(),
  profileHash: z.string().regex(/^[a-f0-9]{64}$/u),
  candidates: z.array(
    z.strictObject({
      key: z.string(),
      accepted: z.boolean(),
      coverage: z.array(z.string()),
      edition: z.string(),
      reasons: z.array(z.string()),
      qualityRank: z.number(),
      score: z.number(),
      planning: z.strictObject({
        status: z.enum(["not_provided", "protected", "planned"]),
        reasons: z.array(z.string()),
        entries: z.array(CorpusPlanSchema),
      }),
      differences: z.array(CorpusDifferenceSchema),
    }),
  ),
  ranking: z.array(z.string()),
  rankingDiffers: z.boolean(),
  hardFailure: z.boolean(),
});
export type CorpusCaseReport = z.infer<typeof CorpusCaseReportSchema>;
export const CorpusReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  corpusId: z.string(),
  manifestHash: z.string(),
  evidence: z.literal("raw-boundary-planning-replay"),
  limits: z.strictObject({
    physicalImport: z.literal("not_exercised"),
    filesystemOwnership: z.literal("not_exercised"),
    consentAndRequestAuthority: z.literal("not_exercised"),
    liveProviderCompatibility: z.literal("not_exercised"),
  }),
  cases: z.array(CorpusCaseReportSchema),
  counts: z.strictObject({
    cases: z.int().nonnegative(),
    synthetic: z.int().nonnegative(),
    captured: z.int().nonnegative(),
    considered: z.int().nonnegative(),
    accepted: z.int().nonnegative(),
    rejected: z.int().nonnegative(),
    planned: z.int().nonnegative(),
    wrongAccept: z.int().nonnegative(),
    missedValid: z.int().nonnegative(),
    protectedAmbiguity: z.int().nonnegative(),
    unsupported: z.int().nonnegative(),
    rankingDifferences: z.int().nonnegative(),
    importPlanDifferences: z.int().nonnegative(),
    unsafeImportPlans: z.int().nonnegative(),
  }),
  passed: z.boolean(),
});

type CandidateLabel = LoadedCorpusCase["labels"]["candidates"][number];
type PlanningResult = Awaited<ReturnType<typeof replayCorpusPlan>>;
function identityDifferences(
  actual: CorpusCandidateResult,
  label: CandidateLabel,
) {
  const differences: z.infer<typeof CorpusDifferenceSchema>[] = [];
  const exactIdentity =
    identityHash(actual.attributes.mediaIds.toSorted()) ===
      identityHash(label.coverage.toSorted()) &&
    actual.edition === label.edition;
  if (actual.accepted && (!exactIdentity || label.disposition !== "accept"))
    differences.push("wrong_accept");
  if (label.disposition === "accept" && !actual.accepted)
    differences.push("missed_valid");
  if (label.disposition === "ambiguous" && !actual.accepted)
    differences.push("protected_ambiguity");
  return differences;
}
function planDifferences(planning: PlanningResult, label: CandidateLabel) {
  const differences: z.infer<typeof CorpusDifferenceSchema>[] = [];
  if (label.disposition === "unsupported" || planning.status === "not_provided")
    differences.push("unsupported");
  if (label.plan !== null) {
    const sorted = (plans: z.infer<typeof CorpusPlanSchema>[]) =>
      plans
        .map((plan) => ({ ...plan, coverage: plan.coverage.toSorted() }))
        .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
    if (
      planning.status !== "planned" ||
      identityHash(sorted(planning.entries)) !==
        identityHash(sorted(label.plan))
    ) {
      differences.push("import_plan_difference");
      if (planning.status === "planned") differences.push("unsafe_import_plan");
    }
  }
  if (
    planning.status === "planned" &&
    identityHash(planning.entries.flatMap((plan) => plan.coverage).sort()) !==
      identityHash(label.coverage.toSorted())
  )
    differences.push("unsafe_import_plan");
  return differences;
}

/** Labels enter only here, after real production matching/quality/cut/planning functions have returned. */
export async function reportCorpusCase(
  value: LoadedCorpusCase,
  executable?: string,
): Promise<CorpusCaseReport> {
  const candidates: CorpusCaseReport["candidates"] = [];
  for (const raw of value.input.candidates) {
    const actual = await replayCorpusCandidate(
      value.input,
      raw,
      value.profile,
      executable,
    );
    const planning = await replayCorpusPlan({
      input: value.input,
      raw,
      candidate: actual,
      policy: value.profile,
      executable,
    });
    const label = value.labels.candidates.find((item) => item.key === raw.key);
    if (label === undefined)
      throw new Error("Independent corpus label missing");
    const differences = [
      ...identityDifferences(actual, label),
      ...planDifferences(planning, label),
    ];
    candidates.push({
      key: actual.key,
      accepted: actual.accepted,
      coverage: actual.attributes.mediaIds.toSorted(),
      edition: actual.edition,
      reasons: actual.reasons,
      qualityRank: actual.qualityRank,
      score: actual.score,
      planning,
      differences: [...new Set(differences)],
    });
  }
  const ranking = candidates
    .filter((candidate) => candidate.accepted)
    .sort(
      (a, b) =>
        b.qualityRank - a.qualityRank ||
        b.score - a.score ||
        a.key.localeCompare(b.key),
    )
    .map((candidate) => candidate.key);
  const rankingDiffers =
    value.labels.ranking !== null &&
    identityHash(ranking) !== identityHash(value.labels.ranking);
  return CorpusCaseReportSchema.parse({
    id: value.entry.id,
    provenance: value.entry.provenance.kind,
    source: value.entry.provenance.source,
    sourceVersion: value.entry.provenance.sourceVersion,
    profileHash: identityHash(value.profile),
    candidates,
    ranking,
    rankingDiffers,
    hardFailure: candidates.some((candidate) =>
      candidate.differences.some(
        (difference) =>
          difference === "wrong_accept" || difference === "unsafe_import_plan",
      ),
    ),
  });
}

export function corpusReport(
  corpusId: string,
  manifestHash: string,
  cases: CorpusCaseReport[],
) {
  const candidates = cases.flatMap((entry) => entry.candidates);
  const count = (kind: z.infer<typeof CorpusDifferenceSchema>) =>
    cases.reduce(
      (total, entry) =>
        total +
        entry.candidates.filter((candidate) =>
          candidate.differences.includes(kind),
        ).length,
      0,
    );
  return CorpusReportSchema.parse({
    schemaVersion: 1,
    corpusId,
    manifestHash,
    evidence: "raw-boundary-planning-replay",
    limits: {
      physicalImport: "not_exercised",
      filesystemOwnership: "not_exercised",
      consentAndRequestAuthority: "not_exercised",
      liveProviderCompatibility: "not_exercised",
    },
    cases,
    counts: {
      cases: cases.length,
      synthetic: cases.filter((entry) => entry.provenance === "synthetic")
        .length,
      captured: cases.filter((entry) => entry.provenance === "captured").length,
      considered: candidates.length,
      accepted: candidates.filter((candidate) => candidate.accepted).length,
      rejected: candidates.filter((candidate) => !candidate.accepted).length,
      planned: candidates.filter(
        (candidate) => candidate.planning.status === "planned",
      ).length,
      wrongAccept: count("wrong_accept"),
      missedValid: count("missed_valid"),
      protectedAmbiguity: count("protected_ambiguity"),
      unsupported: count("unsupported"),
      rankingDifferences: cases.filter((entry) => entry.rankingDiffers).length,
      importPlanDifferences: count("import_plan_difference"),
      unsafeImportPlans: count("unsafe_import_plan"),
    },
    passed:
      cases.length > 0 &&
      cases.every(
        (entry) =>
          !entry.hardFailure &&
          !entry.rankingDiffers &&
          entry.candidates.every(
            (candidate) =>
              !candidate.differences.includes("missed_valid") &&
              !candidate.differences.includes("import_plan_difference"),
          ),
      ),
  });
}
