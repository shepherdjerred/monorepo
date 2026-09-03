import {
  BUCKS_INT32_MAX,
  BucksStakeSchema,
  DARE_V2_MAX_HORIZON_DAYS,
  DARE_V2_MAX_QUERY_LENGTH,
  DARE_V2_MAX_TARGETS,
  DARE_EVALUATOR_V2_VERSION,
  DARE_SCOUTQL_COMPILER_VERSION,
  DareCompiledPlanV2Schema,
  DareDeadlineSpecV2Schema,
  DareTargetBindingV2Schema,
  type DareCompiledPlanV2,
  type DareDeadlineSpecV2,
  type DareTargetBindingV2,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  formatDareScoutQlV2,
  darePlanSemanticIssues,
} from "#src/betting/dare-contract-compiler-v2.ts";
import { dareV2CalloutContent } from "#src/betting/dare-callout-content-v2.ts";
import { DARE_CALLOUT_MAX_LENGTH } from "#src/betting/dare-copy.ts";
import {
  dareV2DraftsEnabled,
  defaultDareV2Dependencies,
  type DareV2Dependencies,
} from "#src/betting/dare-v2-common.ts";
import {
  renderDarePlanV2,
  renderDareProofPlanV2,
} from "#src/betting/dare-render-v2.ts";
import { compileDareScoutQlPlanV2 } from "#src/betting/dare-scoutql-plan-compiler-v2.ts";
import { dareValueNeedsTimeline } from "#src/betting/dare-value-v2.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMELINE_UNSUPPORTED_QUEUES = new Set([
  "arena",
  "classic",
  "classic aram mayhem",
]);

export type DareDraftV2Definition = {
  originalText: string;
  plan: DareCompiledPlanV2;
  targets: readonly DareTargetBindingV2[];
  deadlineSpec: DareDeadlineSpecV2;
  openingStake: number;
  translationJson?: string | undefined;
};

export type DareDraftV2Input = DareDraftV2Definition & {
  serverId: DiscordGuildId;
  channelId: DiscordChannelId;
  challengerDiscordId: DiscordAccountId;
  originConversationId?: string | undefined;
};

export type PreparedDareDraftV2 = {
  originalText: string;
  plan: DareCompiledPlanV2;
  targets: DareTargetBindingV2[];
  deadlineSpec: DareDeadlineSpecV2;
  openingStake: number;
  canonicalScoutQl: string;
  plainLanguage: string;
  semanticProofPlan: string;
  translationJson?: string | undefined;
};

function expressionNeedsTimeline(
  expression: DareCompiledPlanV2["gameSets"][number]["predicate"],
): boolean {
  if (expression.kind === "comparison") {
    return dareValueNeedsTimeline(expression.value);
  }
  if (expression.kind === "not") {
    return expressionNeedsTimeline(expression.operand);
  }
  return expression.operands.some((operand) =>
    expressionNeedsTimeline(operand),
  );
}

function gameSetNeedsTimeline(
  gameSet: DareCompiledPlanV2["gameSets"][number],
): boolean {
  return (
    expressionNeedsTimeline(gameSet.predicate) ||
    gameSet.projections.some((projection) =>
      dareValueNeedsTimeline(projection.value),
    )
  );
}

function isIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function deadlineIssues(spec: DareDeadlineSpecV2, now: Date): string[] {
  if (spec.kind === "relative") return [];
  const deadline = new Date(spec.deadlineAt);
  const issues: string[] = [];
  if (!isIanaTimezone(spec.timezone)) {
    issues.push(`${spec.timezone} is not an IANA timezone.`);
  }
  if (deadline.getTime() <= now.getTime()) {
    issues.push("An absolute dare deadline must be in the future.");
  }
  if (deadline.getTime() > now.getTime() + DARE_V2_MAX_HORIZON_DAYS * DAY_MS) {
    issues.push(
      `A dare deadline may be at most ${DARE_V2_MAX_HORIZON_DAYS.toString()} days away.`,
    );
  }
  return issues;
}

export function prepareDareDraftV2(
  definition: DareDraftV2Definition,
  now: Date = new Date(),
):
  | { kind: "valid"; draft: PreparedDareDraftV2 }
  | { kind: "invalid"; issues: string[] } {
  const plan = DareCompiledPlanV2Schema.parse(definition.plan);
  const targets = DareTargetBindingV2Schema.array().parse(definition.targets);
  const deadlineSpec = DareDeadlineSpecV2Schema.parse(definition.deadlineSpec);
  const stake = BucksStakeSchema.safeParse(definition.openingStake);
  const issues = darePlanSemanticIssues(plan, targets);
  if (!stake.success)
    issues.push("The opening stake must be a positive whole number of BB.");
  if (targets.length === 0 || targets.length > DARE_V2_MAX_TARGETS) {
    issues.push(
      `A dare must bind 1-${DARE_V2_MAX_TARGETS.toString()} targets.`,
    );
  }
  if (
    new Set(targets.map((target) => target.discordId)).size !== targets.length
  ) {
    issues.push("Each target Discord account may appear only once.");
  }
  for (const gameSet of plan.gameSets) {
    if (
      gameSetNeedsTimeline(gameSet) &&
      gameSet.queues.some((queue) => TIMELINE_UNSUPPORTED_QUEUES.has(queue))
    ) {
      issues.push(
        `Game set ${gameSet.name} requests timeline evidence from an unsupported queue.`,
      );
    }
  }
  issues.push(...deadlineIssues(deadlineSpec, now));
  const canonicalScoutQl = formatDareScoutQlV2(plan);
  if (canonicalScoutQl.length > DARE_V2_MAX_QUERY_LENGTH) {
    issues.push(
      `Canonical ScoutQL exceeds ${DARE_V2_MAX_QUERY_LENGTH.toString()} characters.`,
    );
  }
  const plainLanguage = renderDarePlanV2(plan, targets);
  const calloutPreview = dareV2CalloutContent({
    id: BUCKS_INT32_MAX,
    challengerDiscordId: "9".repeat(20),
    openingStake: BUCKS_INT32_MAX,
    potTotal: BUCKS_INT32_MAX,
    contributions: [
      { discordId: "9".repeat(20), amount: BUCKS_INT32_MAX },
      { discordId: "8".repeat(20), amount: BUCKS_INT32_MAX },
    ],
    targetAliases: targets.map((target) => target.alias),
    revision: BUCKS_INT32_MAX,
    plainLanguage,
    evidenceCount: BUCKS_INT32_MAX,
    progressSummary: "Waiting for more eligible match evidence.",
    state: "pending_accept",
    targets: targets.map((target) => ({
      alias: target.alias,
      acceptedAt: new Date(0),
      declinedAt: null,
    })),
    acceptDeadline: new Date(9_999_999_999_000),
    deadlineAt: null,
    finalValue: null,
    voidReason: null,
    enforceDiscordLimit: false,
  });
  if (calloutPreview.length > DARE_CALLOUT_MAX_LENGTH) {
    issues.push(
      `The public Dare callout exceeds Discord's ${DARE_CALLOUT_MAX_LENGTH.toString()}-character limit.`,
    );
  }
  if (issues.length > 0 || !stake.success) return { kind: "invalid", issues };
  return {
    kind: "valid",
    draft: {
      originalText: definition.originalText,
      plan,
      targets,
      deadlineSpec,
      openingStake: stake.data,
      canonicalScoutQl,
      plainLanguage,
      semanticProofPlan: renderDareProofPlanV2(plan),
      ...(definition.translationJson === undefined
        ? {}
        : { translationJson: definition.translationJson }),
    },
  };
}

type CompiledScoutQlArtifacts = {
  scoutQlImmutableAst: string;
  scoutQlPlanHash: string;
};

async function compileDraftScoutQl(
  draft: PreparedDareDraftV2,
): Promise<
  | { kind: "valid"; artifacts: CompiledScoutQlArtifacts }
  | { kind: "invalid"; issues: string[] }
> {
  const validation = await compileDareScoutQlPlanV2({
    queryText: draft.canonicalScoutQl,
    targets: draft.targets,
  });
  if (validation.kind === "invalid") return validation;
  return {
    kind: "valid",
    artifacts: {
      scoutQlImmutableAst: validation.compilation.immutableAst,
      scoutQlPlanHash: validation.compilation.planHash,
    },
  };
}

function revisionData(
  draft: PreparedDareDraftV2,
  artifacts: CompiledScoutQlArtifacts,
  revision: number,
) {
  return {
    revision,
    originalText: draft.originalText,
    canonicalScoutQl: draft.canonicalScoutQl,
    compiledPlan: JSON.stringify(draft.plan),
    scoutQlImmutableAst: artifacts.scoutQlImmutableAst,
    scoutQlPlanHash: artifacts.scoutQlPlanHash,
    compilerVersion: DARE_SCOUTQL_COMPILER_VERSION,
    evaluatorVersion: DARE_EVALUATOR_V2_VERSION,
    targetsJson: JSON.stringify(draft.targets),
    deadlineSpecJson: JSON.stringify(draft.deadlineSpec),
    openingStake: draft.openingStake,
    plainLanguage: draft.plainLanguage,
    semanticProofPlan: draft.semanticProofPlan,
    translationJson: draft.translationJson ?? null,
  };
}

export async function createDareDraftV2(
  input: DareDraftV2Input,
  dependencies: DareV2Dependencies = defaultDareV2Dependencies,
  now: Date = new Date(),
) {
  if (!(await dareV2DraftsEnabled(input.serverId, dependencies))) {
    return { kind: "feature_disabled" } as const;
  }
  const prepared = prepareDareDraftV2(input, now);
  if (prepared.kind === "invalid") return prepared;
  const compiled = await compileDraftScoutQl(prepared.draft);
  if (compiled.kind === "invalid") return compiled;
  const created = await dependencies.prismaClient.bucksDareV2.create({
    data: {
      serverId: input.serverId,
      channelId: input.channelId,
      challengerDiscordId: input.challengerDiscordId,
      originConversationId: input.originConversationId ?? null,
      openingStake: prepared.draft.openingStake,
      revisions: {
        create: revisionData(prepared.draft, compiled.artifacts, 1),
      },
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

export async function reviseDareDraftV2(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    challengerDiscordId: DiscordAccountId;
    expectedRevision: number;
    definition: DareDraftV2Definition;
  },
  dependencies: DareV2Dependencies = defaultDareV2Dependencies,
  now: Date = new Date(),
) {
  if (!(await dareV2DraftsEnabled(input.serverId, dependencies))) {
    return { kind: "feature_disabled" } as const;
  }
  const prepared = prepareDareDraftV2(input.definition, now);
  if (prepared.kind === "invalid") return prepared;
  const compiled = await compileDraftScoutQl(prepared.draft);
  if (compiled.kind === "invalid") return compiled;
  return await dependencies.prismaClient.$transaction(async (tx) => {
    const updated = await tx.bucksDareV2.updateManyAndReturn({
      where: {
        id: input.dareId,
        serverId: input.serverId,
        challengerDiscordId: input.challengerDiscordId,
        dareState: "draft",
        currentRevision: input.expectedRevision,
      },
      data: {
        currentRevision: { increment: 1 },
        openingStake: prepared.draft.openingStake,
      },
      select: { currentRevision: true },
    });
    const row = updated[0];
    if (row === undefined || updated.length !== 1) {
      const current = await tx.bucksDareV2.findUnique({
        where: { id: input.dareId },
        select: {
          serverId: true,
          challengerDiscordId: true,
          dareState: true,
          currentRevision: true,
        },
      });
      if (current?.serverId !== input.serverId)
        return { kind: "not_found" } as const;
      if (current.challengerDiscordId !== input.challengerDiscordId)
        return { kind: "not_challenger" } as const;
      if (current.dareState !== "draft") return { kind: "frozen" } as const;
      return {
        kind: "stale_revision",
        currentRevision: current.currentRevision,
      } as const;
    }
    await tx.bucksDareV2Revision.create({
      data: {
        dareId: input.dareId,
        ...revisionData(
          prepared.draft,
          compiled.artifacts,
          row.currentRevision,
        ),
      },
    });
    return {
      kind: "revised",
      dareId: input.dareId,
      revision: row.currentRevision,
      draft: prepared.draft,
    } as const;
  });
}

export async function deleteDareDraftV2(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    challengerDiscordId: DiscordAccountId;
    expectedRevision: number;
  },
  dependencies: DareV2Dependencies = defaultDareV2Dependencies,
) {
  const claim = await dependencies.prismaClient.bucksDareV2.updateMany({
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
