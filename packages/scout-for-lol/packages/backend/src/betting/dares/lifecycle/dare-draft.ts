import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  BUCKS_INT32_MAX,
  DarePileOnSchema,
  DarePotTotalSchema,
  StorableDareChallengerStakeSchema,
  DARE_SQL_EVALUATOR_VERSION,
  DARE_MAX_TARGETS,
  DareDeadlineSpecSchema,
  DareSqlCompilationSchema,
  DareTargetBindingSchema,
  type DareDeadlineSpec,
  type DareSqlCompilation,
  type DareSqlCompetition,
  type DareActivation,
  type DareSqlEvidence,
  type DareTargetBinding,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type StorableDareChallengerStake,
} from "@scout-for-lol/data";
import {
  compileDareSql,
  executeDareSql,
} from "#src/betting/dares/sql/dare-sql.ts";
import {
  claimDareDraftRevision,
  dareDraftDeadlineIssues,
  dareSqlDraftsEnabled,
  defaultDareDependencies,
  type DareDependencies,
} from "#src/betting/dares/dare-common.ts";
import { renderDareSqlSemanticProofPlan } from "#src/betting/dares/sql/dare-sql-description.ts";
import {
  DARE_CALLOUT_MAX_LENGTH,
  dareCalloutContent,
} from "#src/betting/dares/presentation/dare-callout-content.ts";
import {
  statusPhraseCoverageIssues,
  storedStatusPhrasesJson,
  type DareStatusPhrases,
} from "#src/betting/dares/presentation/dare-list-copy.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DareDraftDefinition = {
  originalText: string;
  displayTitle?: string | undefined;
  statusPhrases?: DareStatusPhrases | undefined;
  queryText: string;
  plainLanguage: string;
  targets: readonly DareTargetBinding[];
  deadlineSpec: DareDeadlineSpec;
  openingStake: number;
  historyDays?: number | undefined;
  competition?: DareSqlCompetition | undefined;
  activation?: DareActivation | undefined;
};

export type PreparedDareDraft = {
  originalText: string;
  displayTitle: string | null;
  statusPhrases: DareStatusPhrases | null;
  compilation: DareSqlCompilation;
  plainLanguage: string;
  targets: DareTargetBinding[];
  deadlineSpec: DareDeadlineSpec;
  openingStake: StorableDareChallengerStake;
  preview: DareSqlEvidence;
};

export function retainedDareDraftSemantics(serializedCompilation: string) {
  const compilation = DareSqlCompilationSchema.parse(
    JSON.parse(serializedCompilation),
  );
  return {
    competition: compilation.competition,
    activation: compilation.activation,
  };
}

function definitionIssues(input: DareDraftDefinition, now: Date): string[] {
  const issues = dareDraftDeadlineIssues(input.deadlineSpec, now);
  if (input.targets.length === 0 || input.targets.length > DARE_MAX_TARGETS) {
    issues.push(`A dare must bind 1-${DARE_MAX_TARGETS.toString()} targets.`);
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
  if (worstCaseCalloutLength(input) > DARE_CALLOUT_MAX_LENGTH) {
    issues.push(
      `The public Dare callout exceeds Discord's ${DARE_CALLOUT_MAX_LENGTH.toString()}-character limit.`,
    );
  }
  return issues;
}

const WIDEST_STAKE = StorableDareChallengerStakeSchema.parse(BUCKS_INT32_MAX);
const WIDEST_POT = DarePotTotalSchema.parse(BUCKS_INT32_MAX);
const WIDEST_PILE_ON = DarePileOnSchema.parse(BUCKS_INT32_MAX);

/**
 * The callout this draft would post with every number at its widest, so a
 * draft that fits now cannot outgrow Discord's limit once it is funded. The
 * callout drops pile-on lines to fit; the fixed lines it cannot drop are what
 * this measures.
 */
function worstCaseCalloutLength(input: DareDraftDefinition): number {
  return dareCalloutContent({
    id: BUCKS_INT32_MAX,
    challengerDiscordId: "9".repeat(20),
    openingStake: WIDEST_STAKE,
    potTotal: WIDEST_POT,
    pileOns: [
      {
        discordId: DiscordAccountIdSchema.parse("9".repeat(20)),
        amount: WIDEST_PILE_ON,
      },
    ],
    targetAliases: input.targets.map((target) => target.alias),
    revision: BUCKS_INT32_MAX,
    plainLanguage: input.plainLanguage,
    evidenceCount: BUCKS_INT32_MAX,
    progressSummary: "Waiting for more eligible match evidence.",
    state: "pending_accept",
    targets: input.targets.map((target) => ({
      alias: target.alias,
      acceptedAt: new Date(0),
      declinedAt: null,
    })),
    acceptDeadline: new Date(9_999_999_999_000),
    deadlineAt: null,
    finalValue: null,
    voidReason: null,
    enforceDiscordLimit: false,
  }).length;
}

export async function prepareDareDraft(
  definition: DareDraftDefinition,
  now: Date = new Date(),
  lakeDir?: string,
): Promise<
  | { kind: "valid"; draft: PreparedDareDraft }
  | { kind: "invalid"; issues: string[] }
> {
  const targets = DareTargetBindingSchema.array().parse(definition.targets);
  const deadlineSpec = DareDeadlineSpecSchema.parse(definition.deadlineSpec);
  const stake = StorableDareChallengerStakeSchema.safeParse(
    definition.openingStake,
  );
  const issues = definitionIssues(definition, now);
  if (!stake.success) {
    issues.push("The opening stake must be a positive whole number of BB.");
  }
  if (issues.length > 0 || !stake.success) return { kind: "invalid", issues };
  let compilation: DareSqlCompilation;
  try {
    compilation = await compileDareSql({
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
  const phraseIssues = statusPhraseCoverageIssues(
    compilation.resultStructure.gameSets.map((gameSet) => gameSet.name),
    definition.statusPhrases,
  );
  if (phraseIssues.length > 0) {
    return { kind: "invalid", issues: phraseIssues };
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
  const preview = await executeDareSql({
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
      displayTitle: definition.displayTitle ?? null,
      statusPhrases: definition.statusPhrases ?? null,
      compilation,
      plainLanguage: definition.plainLanguage,
      targets,
      deadlineSpec,
      openingStake: stake.data,
      preview,
    },
  };
}

function revisionData(draft: PreparedDareDraft, revision: number) {
  return {
    revision,
    originalText: draft.originalText,
    canonicalScoutQl: draft.compilation.canonicalSql,
    compiledPlan: JSON.stringify(draft.compilation),
    scoutQlImmutableAst: draft.compilation.immutableAst,
    scoutQlPlanHash: draft.compilation.queryHash,
    compilerVersion: draft.compilation.compilerVersion,
    evaluatorVersion: DARE_SQL_EVALUATOR_VERSION,
    targetsJson: JSON.stringify(draft.targets),
    deadlineSpecJson: JSON.stringify(draft.deadlineSpec),
    openingStake: draft.openingStake,
    plainLanguage: draft.plainLanguage,
    semanticProofPlan: renderDareSqlSemanticProofPlan(draft.compilation),
    displayTitle: draft.displayTitle,
    statusPhrasesJson: storedStatusPhrasesJson(draft.statusPhrases),
    translationJson: null,
  };
}

export async function createDareDraft(
  input: DareDraftDefinition & {
    serverId: DiscordGuildId;
    channelId: DiscordChannelId;
    challengerDiscordId: DiscordAccountId;
    originConversationId?: string;
  },
  dependencies: DareDependencies = defaultDareDependencies,
  now: Date = new Date(),
  lakeDir?: string,
) {
  if (!(await dareSqlDraftsEnabled(input.serverId, dependencies))) {
    return { kind: "feature_disabled" } as const;
  }
  const prepared = await prepareDareDraft(input, now, lakeDir);
  if (prepared.kind === "invalid") return prepared;
  const created = await dependencies.prismaClient.bucksDare.create({
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

export async function reviseDareDraft(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    challengerDiscordId: DiscordAccountId;
    expectedRevision: number;
    definition: DareDraftDefinition;
  },
  dependencies: DareDependencies = defaultDareDependencies,
  now: Date = new Date(),
  lakeDir?: string,
) {
  if (!(await dareSqlDraftsEnabled(input.serverId, dependencies))) {
    return { kind: "feature_disabled" } as const;
  }
  const prepared = await prepareDareDraft(input.definition, now, lakeDir);
  if (prepared.kind === "invalid") return prepared;
  return await dependencies.prismaClient.$transaction(async (tx) => {
    const currentRevision = await claimDareDraftRevision(tx, {
      ...input,
      openingStake: prepared.draft.openingStake,
    });
    if (currentRevision === undefined) {
      return { kind: "not_editable" } as const;
    }
    await tx.bucksDareRevision.create({
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

export async function deleteDareDraft(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    challengerDiscordId: DiscordAccountId;
    expectedRevision: number;
  },
  dependencies: DareDependencies = defaultDareDependencies,
) {
  const claim = await dependencies.prismaClient.bucksDare.updateMany({
    where: {
      id: input.dareId,
      serverId: input.serverId,
      challengerDiscordId: input.challengerDiscordId,
      dareState: "draft",
      currentRevision: input.expectedRevision,
    },
    data: { dareState: "deleted" },
  });
  return claim.count === 1
    ? { kind: "deleted" as const }
    : { kind: "not_editable" as const };
}
