import type {
  DiscordGuildId,
  DiscordChannelId,
} from "@scout-for-lol/domain/identity/discord.ts";
import {
  DARE_CONTRACT_VERSION,
  DARE_SQL_EVALUATOR_VERSION,
  DareContractSchema,
  DareSqlCompilationSchema,
  type DareActivationSnapshot,
  type DareTargetBinding,
} from "@scout-for-lol/data";
import {
  bindDareDeadline,
  parseDareDeadline,
} from "#src/betting/dares/dare-common.ts";

export function buildDareContract(input: {
  dare: {
    serverId: DiscordGuildId;
    channelId: DiscordChannelId;
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
  targets: DareTargetBinding[];
  activationAt: Date;
  activationSnapshot: DareActivationSnapshot | null;
}) {
  const compilation = DareSqlCompilationSchema.parse(
    JSON.parse(input.revision.compiledPlan),
  );
  if (
    input.revision.scoutQlImmutableAst === null ||
    input.revision.scoutQlPlanHash === null
  ) {
    throw new Error("Dare SQL revision has no immutable artifact.");
  }
  const deadlineSpec = parseDareDeadline(input.revision.deadlineSpecJson);
  const deadlineAt = bindDareDeadline(deadlineSpec, input.activationAt);
  const contract = DareContractSchema.parse({
    version: DARE_CONTRACT_VERSION,
    canonicalSql: input.revision.canonicalScoutQl,
    immutableAst: input.revision.scoutQlImmutableAst,
    queryHash: input.revision.scoutQlPlanHash,
    maxEligibleGames: compilation.maxEligibleGames,
    compilerVersion: compilation.compilerVersion,
    evaluatorVersion: DARE_SQL_EVALUATOR_VERSION,
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
