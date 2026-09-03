import {
  BucksDareV2StateSchema,
  DareCompiledPlanV2Schema,
  DareSqlV3CompilationSchema,
  DareDeadlineSpecV2Schema,
  DareTargetBindingV2Schema,
  type BucksDareV2State,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { z } from "zod";
import { formatDareScoutQlV2 } from "#src/betting/dare-contract-compiler-v2.ts";
import { deriveDareProgressV2 } from "#src/betting/dare-progress-v2.ts";
import { deriveDareProgressV3 } from "#src/betting/dare-progress-v3.ts";
import { storedDareV2Evidence } from "#src/betting/dare-settle-evidence-v2.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { darePollHealth } from "#src/betting/dare-poll-health.ts";
import {
  dareViewerFactsV2,
  indexVisibleDaresV2,
  visibleDareIndexSelectionV2,
} from "#src/betting/dare-view-index-v2.ts";
import {
  DareV2InspectionSchema,
  DareV2ListItemSchema,
  DareV2ListPageSchema,
  type DareV2Inspection,
  type DareV2ListItem,
  type DareV2ListPage,
} from "#src/betting/dare-view-model-v2.ts";

type VisibleDareRow = {
  id: number;
  serverId: string;
  channelId: string;
  originConversationId: string | null;
  challengerDiscordId: string;
  dareState: string;
  currentRevision: number;
  fundedRevision: number | null;
  openingStake: number;
  potTotal: number;
  proposalExpiresAt: Date | null;
  acceptDeadline: Date | null;
  activatedAt: Date | null;
  deadlineAt: Date | null;
  settledAt: Date | null;
  finalValue: boolean | null;
  proofJson: string | null;
  voidReason: string | null;
  updatedAt: Date;
  revisions: {
    revision: number;
    originalText: string;
    canonicalScoutQl: string;
    compiledPlan: string;
    scoutQlPlanHash: string | null;
    compilerVersion: string;
    evaluatorVersion: string;
    targetsJson: string;
    deadlineSpecJson: string;
    plainLanguage: string;
    semanticProofPlan: string;
  }[];
  targets: {
    targetKey: string;
    discordId: string;
    playerId: number;
    alias: string;
    acceptedAt: Date | null;
    declinedAt: Date | null;
    payout: number | null;
    fee: number | null;
  }[];
  _count: { evidence: number };
  evidence: {
    matchId: string;
    gameStartAt: Date;
    gameEndAt: Date;
    queueType: string;
    candidateMembership: string;
    evaluationOutput: string;
    coverageState: string;
    targetDependencies: string;
    sourceReferences: string;
    evaluationTrace: string;
  }[];
  contributions: { discordId: string }[];
};

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function activeRevision(row: VisibleDareRow) {
  const revisionNumber = row.fundedRevision ?? row.currentRevision;
  const revision = row.revisions.find(
    (candidate) => candidate.revision === revisionNumber,
  );
  if (revision === undefined) {
    throw new Error(
      `Dare v2 ${row.id.toString()} is missing revision ${revisionNumber.toString()}.`,
    );
  }
  return revision;
}

function terminalState(state: BucksDareV2State): boolean {
  return !["draft", "pending_accept", "active"].includes(state);
}

function parsedRevisionPlan(revision: VisibleDareRow["revisions"][number]) {
  const rawPlan: unknown = JSON.parse(revision.compiledPlan);
  return revision.compilerVersion === "dare-scoutql-3"
    ? DareSqlV3CompilationSchema.parse(rawPlan)
    : DareCompiledPlanV2Schema.parse(rawPlan);
}

function progressForRow(
  row: VisibleDareRow,
  revision: VisibleDareRow["revisions"][number],
  targetKeys: readonly string[],
  state: BucksDareV2State,
) {
  const common = {
    targetKeys,
    final: terminalState(state),
    finalityReason: terminalState(state) ? state : "in_progress",
  };
  const plan = parsedRevisionPlan(revision);
  return "compilerVersion" in plan
    ? deriveDareProgressV3({
        ...common,
        compilation: plan,
        evidence: row.evidence,
      })
    : deriveDareProgressV2({
        ...common,
        plan,
        evidence: row.evidence.map((evidence) =>
          storedDareV2Evidence(evidence),
        ),
      });
}
function listItem(
  row: VisibleDareRow,
  viewerDiscordId: DiscordAccountId,
): DareV2ListItem {
  const revision = activeRevision(row);
  const state = BucksDareV2StateSchema.parse(row.dareState);
  const draftTargets = DareTargetBindingV2Schema.array().parse(
    JSON.parse(revision.targetsJson),
  );
  const targetKeys =
    row.targets.length === 0
      ? draftTargets.map((target) => target.key)
      : row.targets.map((target) => target.targetKey);
  const viewer = dareViewerFactsV2(row, viewerDiscordId);
  return DareV2ListItemSchema.parse({
    contractVersion: revision.compilerVersion === "dare-scoutql-3" ? 3 : 2,
    id: row.id,
    serverId: row.serverId,
    state,
    currentRevision: row.currentRevision,
    fundedRevision: row.fundedRevision,
    challengerDiscordId: row.challengerDiscordId,
    targetAliases:
      row.targets.length === 0
        ? draftTargets.map((target) => target.alias)
        : row.targets.map((target) => target.alias),
    plainLanguage: revision.plainLanguage,
    openingStake: row.openingStake,
    potTotal: row.potTotal,
    evidenceGames: row._count.evidence,
    progress: progressForRow(row, revision, targetKeys, state),
    viewerRoles: viewer.roles,
    availableActions: viewer.actions,
    requiresViewerAction: viewer.requiresViewerAction,
    proposalExpiresAt: iso(row.proposalExpiresAt),
    acceptDeadline: iso(row.acceptDeadline),
    activatedAt: iso(row.activatedAt),
    deadlineAt: iso(row.deadlineAt),
    settledAt: iso(row.settledAt),
    finalValue: row.finalValue,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function inspection(
  row: VisibleDareRow,
  viewerDiscordId: DiscordAccountId,
  processingHealth: ReturnType<typeof darePollHealth>,
): DareV2Inspection {
  const revision = activeRevision(row);
  const state = BucksDareV2StateSchema.parse(row.dareState);
  const plan = parsedRevisionPlan(revision);
  const draftTargets = DareTargetBindingV2Schema.array().parse(
    JSON.parse(revision.targetsJson),
  );
  return DareV2InspectionSchema.parse({
    ...listItem(row, viewerDiscordId),
    channelId: row.channelId,
    originConversationId: row.originConversationId,
    canonicalScoutQl:
      revision.compilerVersion === "dare-scoutql-3"
        ? revision.canonicalScoutQl
        : visibleDareScoutQlV2({
            state,
            plan: DareCompiledPlanV2Schema.parse(plan),
            storedCanonicalScoutQl: revision.canonicalScoutQl,
          }),
    plan,
    semanticProofPlan: revision.semanticProofPlan,
    originalText: revision.originalText,
    deadlineSpec: DareDeadlineSpecV2Schema.parse(
      JSON.parse(revision.deadlineSpecJson),
    ),
    compilerVersion: revision.compilerVersion,
    scoutQlPlanHash: revision.scoutQlPlanHash,
    evaluatorVersion: revision.evaluatorVersion,
    targets:
      row.targets.length === 0
        ? draftTargets.map((target) => ({
            key: target.key,
            discordId: target.discordId,
            playerId: target.playerId,
            alias: target.alias,
            acceptedAt: null,
            declinedAt: null,
            payout: null,
            fee: null,
          }))
        : row.targets.map((target) => ({
            key: target.targetKey,
            discordId: target.discordId,
            playerId: target.playerId,
            alias: target.alias,
            acceptedAt: iso(target.acceptedAt),
            declinedAt: iso(target.declinedAt),
            payout: target.payout,
            fee: target.fee,
          })),
    proof: row.proofJson === null ? null : JSON.parse(row.proofJson),
    voidReason: row.voidReason,
    processingHealth,
  });
}

export function visibleDareScoutQlV2(input: {
  state: BucksDareV2State;
  plan: z.infer<typeof DareCompiledPlanV2Schema>;
  storedCanonicalScoutQl: string;
}): string {
  return input.state === "draft"
    ? formatDareScoutQlV2(input.plan)
    : input.storedCanonicalScoutQl;
}

const includeVisibleDare = {
  revisions: { orderBy: { revision: "asc" as const } },
  targets: { orderBy: { id: "asc" as const } },
  contributions: { select: { discordId: true } },
  evidence: {
    orderBy: [{ gameEndAt: "asc" as const }, { matchId: "asc" as const }],
  },
  _count: { select: { evidence: true } },
};

const VISIBLE_DARE_PAGE_SIZE = 25;

function visibleState(state: BucksDareV2State): boolean {
  return state !== "draft" && state !== "deleted";
}

export async function listVisibleDarePageV2(
  input: {
    serverId: DiscordGuildId;
    viewerDiscordId: DiscordAccountId;
    scope: "mine" | "guild" | "needs_action";
    search?: string | undefined;
    states?: BucksDareV2State[] | undefined;
    role?: "challenger" | "target" | "contributor" | "involved" | undefined;
    sort?: "needs_action" | "deadline" | "updated" | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
  prisma: ExtendedPrismaClient,
): Promise<DareV2ListPage> {
  const search = input.search?.trim();
  const rows = await prisma.bucksDareV2.findMany({
    where: {
      serverId: input.serverId,
      AND: [
        input.scope === "guild"
          ? { dareState: { notIn: ["draft", "deleted"] } }
          : {
              dareState: { not: "deleted" },
              OR: [
                { challengerDiscordId: input.viewerDiscordId },
                { targets: { some: { discordId: input.viewerDiscordId } } },
                {
                  contributions: {
                    some: { discordId: input.viewerDiscordId },
                  },
                },
              ],
            },
      ],
    },
    select: visibleDareIndexSelectionV2,
  });
  const matches = indexVisibleDaresV2({
    rows,
    viewerDiscordId: input.viewerDiscordId,
    search,
    states: input.states,
    role: input.role,
    needsAction: input.scope === "needs_action",
    sort:
      input.sort ??
      (input.scope === "needs_action" ? "needs_action" : "updated"),
  });
  const cursorIndex =
    input.cursor === undefined
      ? -1
      : matches.findIndex((item) => item.id.toString() === input.cursor);
  const start = cursorIndex + 1;
  const limit = input.limit ?? VISIBLE_DARE_PAGE_SIZE;
  const pageIndex = matches.slice(start, start + limit);
  const pageRows = await prisma.bucksDareV2.findMany({
    where: { id: { in: pageIndex.map((item) => item.id) } },
    include: includeVisibleDare,
  });
  const pageRowsById = new Map(pageRows.map((row) => [row.id, row]));
  const items = pageIndex.map((item) => {
    const row = pageRowsById.get(item.id);
    if (row === undefined) {
      throw new Error(
        `Dare v2 ${item.id.toString()} disappeared while paging.`,
      );
    }
    return listItem(row, input.viewerDiscordId);
  });
  const last = pageIndex.at(-1);
  return DareV2ListPageSchema.parse({
    items,
    nextCursor:
      last !== undefined && start + items.length < matches.length
        ? last.id.toString()
        : null,
  });
}

export async function listVisibleDaresV2(
  input: {
    serverId: DiscordGuildId;
    viewerDiscordId: DiscordAccountId;
    scope: "mine" | "guild";
    search?: string | undefined;
  },
  prisma: ExtendedPrismaClient,
): Promise<DareV2ListItem[]> {
  const page = await listVisibleDarePageV2({ ...input, limit: 100 }, prisma);
  return page.items;
}

export async function inspectVisibleDareV2(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    viewerDiscordId: DiscordAccountId;
  },
  prisma: ExtendedPrismaClient,
): Promise<DareV2Inspection | null> {
  const [row, botState] = await Promise.all([
    prisma.bucksDareV2.findFirst({
      where: { id: input.dareId, serverId: input.serverId },
      include: includeVisibleDare,
    }),
    prisma.botState.findUnique({ where: { id: 1 } }),
  ]);
  if (row === null) return null;
  const state = BucksDareV2StateSchema.parse(row.dareState);
  if (
    !visibleState(state) &&
    row.challengerDiscordId !== input.viewerDiscordId
  ) {
    return null;
  }
  return inspection(row, input.viewerDiscordId, darePollHealth(botState));
}
