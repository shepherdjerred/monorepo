import {
  BucksStakeSchema,
  DARE_SQL_V3_EVALUATOR_VERSION,
  DARE_V2_MAX_TARGETS,
  DareDeadlineSpecV2Schema,
  DareSqlV3CompilationSchema,
  DareTargetBindingV2Schema,
  type DareDeadlineSpecV2,
  type DareSqlV3Compilation,
  type DareSqlV3Competition,
  type DareActivationV3,
  type DareSqlV3Evidence,
  type DareTargetBindingV2,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  compileDareSqlV3,
  executeDareSqlV3,
} from "#src/betting/dares/sql/dare-sql-v3.ts";
import {
  claimDareDraftRevision,
  dareDraftDeadlineIssues,
  dareSqlV3DraftsEnabled,
  defaultDareV2Dependencies,
  type DareV2Dependencies,
} from "#src/betting/dares/dare-v2-common.ts";
import { renderDareSqlV3SemanticProofPlan } from "#src/betting/dares/sql/dare-sql-v3-description.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DareDraftV3Definition = {
  originalText: string;
  queryText: string;
  plainLanguage: string;
  targets: readonly DareTargetBindingV2[];
  deadlineSpec: DareDeadlineSpecV2;
  openingStake: number;
  historyDays?: number | undefined;
  competition?: DareSqlV3Competition | undefined;
  activation?: DareActivationV3 | undefined;
};

export type PreparedDareDraftV3 = {
  originalText: string;
  compilation: DareSqlV3Compilation;
  plainLanguage: string;
  targets: DareTargetBindingV2[];
  deadlineSpec: DareDeadlineSpecV2;
  openingStake: number;
  preview: DareSqlV3Evidence;
};

export function retainedDareDraftV3Semantics(serializedCompilation: string) {
  const compilation = DareSqlV3CompilationSchema.parse(
    JSON.parse(serializedCompilation),
  );
  return {
    competition: compilation.competition,
    activation: compilation.activation,
  };
}

function definitionIssues(input: DareDraftV3Definition, now: Date): string[] {
  const issues = dareDraftDeadlineIssues(input.deadlineSpec, now);
  if (
    input.targets.length === 0 ||
    input.targets.length > DARE_V2_MAX_TARGETS
  ) {
    issues.push(
      `A dare must bind 1-${DARE_V2_MAX_TARGETS.toString()} targets.`,
    );
  }
  if (
    new Set(input.targets.map((target) => target.key)).size !==
    input.targets.length
  ) {
    issues.push("Each target key may appear only once.");
  }
  if (
    new Set(input.targets.map((target) => target.discordId)).size !==
    input.targets.length
  ) {
    issues.push("Each target Discord account may appear only once.");
  }
  if (input.originalText.trim().length === 0) {
    issues.push("The original dare wording is required.");
  }
  if (input.plainLanguage.trim().length === 0) {
    issues.push("A readable SQL summary is required.");
  }
  return issues;
}

export async function prepareDareDraftV3(
  definition: DareDraftV3Definition,
  now: Date = new Date(),
  lakeDir?: string,
): Promise<
  | { kind: "valid"; draft: PreparedDareDraftV3 }
  | { kind: "invalid"; issues: string[] }
> {
  const targets = DareTargetBindingV2Schema.array().parse(definition.targets);
  const deadlineSpec = DareDeadlineSpecV2Schema.parse(definition.deadlineSpec);
  const stake = BucksStakeSchema.safeParse(definition.openingStake);
  const issues = definitionIssues(definition, now);
  if (!stake.success) {
    issues.push("The opening stake must be a positive whole number of BB.");
  }
  if (issues.length > 0 || !stake.success) return { kind: "invalid", issues };
  let compilation: DareSqlV3Compilation;
  try {
    compilation = await compileDareSqlV3({
      queryText: definition.queryText,
      targetKeys: targets.map((target) => target.key),
      competition: definition.competition,
      activation: definition.activation,
    });
  } catch (error) {
    return {
      kind: "invalid",
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }
  const historyDays = definition.historyDays ?? 30;
  if (
    !Number.isSafeInteger(historyDays) ||
    historyDays < 1 ||
    historyDays > 90
  ) {
    return {
      kind: "invalid",
      issues: ["Historical preview must cover 1-90 days."],
    };
  }
  const preview = await executeDareSqlV3({
    compilation,
    targets,
    start: new Date(now.getTime() - historyDays * DAY_MS),
    end: now,
    ...(lakeDir === undefined ? {} : { lakeDir }),
  });
  return {
    kind: "valid",
    draft: {
      originalText: definition.originalText,
      compilation,
      plainLanguage: definition.plainLanguage,
      targets,
      deadlineSpec,
      openingStake: stake.data,
      preview,
    },
  };
}

function revisionData(draft: PreparedDareDraftV3, revision: number) {
  return {
    revision,
    originalText: draft.originalText,
    canonicalScoutQl: draft.compilation.canonicalSql,
    compiledPlan: JSON.stringify(draft.compilation),
    scoutQlImmutableAst: draft.compilation.immutableAst,
    scoutQlPlanHash: draft.compilation.queryHash,
    compilerVersion: draft.compilation.compilerVersion,
    evaluatorVersion: DARE_SQL_V3_EVALUATOR_VERSION,
    targetsJson: JSON.stringify(draft.targets),
    deadlineSpecJson: JSON.stringify(draft.deadlineSpec),
    openingStake: draft.openingStake,
    plainLanguage: draft.plainLanguage,
    semanticProofPlan: renderDareSqlV3SemanticProofPlan(draft.compilation),
    translationJson: null,
  };
}

export async function createDareDraftV3(
  input: DareDraftV3Definition & {
    serverId: DiscordGuildId;
    channelId: DiscordChannelId;
    challengerDiscordId: DiscordAccountId;
    originConversationId?: string;
  },
  dependencies: DareV2Dependencies = defaultDareV2Dependencies,
  now: Date = new Date(),
  lakeDir?: string,
) {
  if (!(await dareSqlV3DraftsEnabled(input.serverId, dependencies))) {
    return { kind: "feature_disabled" } as const;
  }
  const prepared = await prepareDareDraftV3(input, now, lakeDir);
  if (prepared.kind === "invalid") return prepared;
  const created = await dependencies.prismaClient.bucksDareV2.create({
    data: {
      serverId: input.serverId,
      channelId: input.channelId,
      challengerDiscordId: input.challengerDiscordId,
      originConversationId: input.originConversationId ?? null,
      openingStake: prepared.draft.openingStake,
      revisions: { create: revisionData(prepared.draft, 1) },
    },
    select: { id: true, currentRevision: true },
  });
  return {
    kind: "created",
    dareId: created.id,
    revision: created.currentRevision,
    draft: prepared.draft,
  } as const;
}

export async function reviseDareDraftV3(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    challengerDiscordId: DiscordAccountId;
    expectedRevision: number;
    definition: DareDraftV3Definition;
  },
  dependencies: DareV2Dependencies = defaultDareV2Dependencies,
  now: Date = new Date(),
  lakeDir?: string,
) {
  if (!(await dareSqlV3DraftsEnabled(input.serverId, dependencies))) {
    return { kind: "feature_disabled" } as const;
  }
  const prepared = await prepareDareDraftV3(input.definition, now, lakeDir);
  if (prepared.kind === "invalid") return prepared;
  return await dependencies.prismaClient.$transaction(async (tx) => {
    const currentRevision = await claimDareDraftRevision(tx, {
      ...input,
      openingStake: prepared.draft.openingStake,
    });
    if (currentRevision === undefined) {
      return { kind: "not_editable" } as const;
    }
    await tx.bucksDareV2Revision.create({
      data: {
        dareId: input.dareId,
        ...revisionData(prepared.draft, currentRevision),
      },
    });
    return {
      kind: "revised",
      dareId: input.dareId,
      revision: currentRevision,
      draft: prepared.draft,
    } as const;
  });
}
