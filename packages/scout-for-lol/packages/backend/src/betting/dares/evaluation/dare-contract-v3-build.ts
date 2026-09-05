import {
  DARE_CONTRACT_V3_VERSION,
  DARE_SQL_V3_EVALUATOR_VERSION,
  DareContractV3Schema,
  DareSqlV3CompilationSchema,
  type DareActivationSnapshotV3,
  type DareTargetBindingV2,
} from "@scout-for-lol/data";
import {
  bindDareV2Deadline,
  parseDareV2Deadline,
} from "#src/betting/dares/dare-v2-common.ts";

export function buildDareContractV3(input: {
  dare: {
    serverId: string;
    channelId: string;
  };
  revision: {
    revision: number;
    originalText: string;
    canonicalScoutQl: string;
    compiledPlan: string;
    scoutQlImmutableAst: string | null;
    scoutQlPlanHash: string | null;
    deadlineSpecJson: string;
    openingStake: number;
    plainLanguage: string;
  };
  targets: DareTargetBindingV2[];
  activationAt: Date;
  activationSnapshot: DareActivationSnapshotV3 | null;
}) {
  const compilation = DareSqlV3CompilationSchema.parse(
    JSON.parse(input.revision.compiledPlan),
  );
  if (
    input.revision.scoutQlImmutableAst === null ||
    input.revision.scoutQlPlanHash === null
  ) {
    throw new Error("Dare SQL v3 revision has no immutable artifact.");
  }
  const deadlineSpec = parseDareV2Deadline(input.revision.deadlineSpecJson);
  const deadlineAt = bindDareV2Deadline(deadlineSpec, input.activationAt);
  const contract = DareContractV3Schema.parse({
    version: DARE_CONTRACT_V3_VERSION,
    canonicalSql: input.revision.canonicalScoutQl,
    immutableAst: input.revision.scoutQlImmutableAst,
    queryHash: input.revision.scoutQlPlanHash,
    maxEligibleGames: compilation.maxEligibleGames,
    compilerVersion: compilation.compilerVersion,
    evaluatorVersion: DARE_SQL_V3_EVALUATOR_VERSION,
    finality: compilation.finality,
    facts: compilation.facts,
    resultStructure: compilation.resultStructure,
    competition: compilation.competition,
    activation: compilation.activation,
    activationSnapshot: input.activationSnapshot,
    targets: input.targets,
    openingStake: input.revision.openingStake,
    serverId: input.dare.serverId,
    channelId: input.dare.channelId,
    revision: input.revision.revision,
    activationAt: input.activationAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
    deadlineSpec,
    originalText: input.revision.originalText,
    plainLanguage: input.revision.plainLanguage,
  });
  return { contract, deadlineAt };
}
