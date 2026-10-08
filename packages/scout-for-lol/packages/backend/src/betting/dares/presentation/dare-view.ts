import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  BucksDareStateSchema,
  DareSqlCompilationSchema,
  DareDeadlineSpecSchema,
  DareTargetBindingSchema,
  type BucksDareState,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { deriveDareProgress } from "#src/betting/dares/presentation/dare-progress.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { darePollHealth } from "#src/betting/dares/evaluation/dare-poll-health.ts";
import {
  dareViewerFacts,
  indexVisibleDares,
  visibleDareIndexSelection,
} from "#src/betting/dares/presentation/dare-view-index.ts";
import {
  DareInspectionSchema,
  DareListItemSchema,
  DareListPageSchema,
  type DareInspection,
  type DareListItem,
  type DareListPage,
} from "#src/betting/dares/presentation/dare-view-model.ts";
import { parseStoredStatusPhrases } from "#src/betting/dares/presentation/dare-list-copy.ts";

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
    displayTitle: string | null;
    statusPhrasesJson: string | null;
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
    matchId: RiotMatchId;
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
  activation: {
    requestedAt: Date;
    nextAttemptAt: Date;
    attemptCount: number;
    lastAttemptAt: Date | null;
    errorCode: string | null;
    completedAt: Date | null;
  } | null;
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
      `Dare ${row.id.toString()} is missing revision ${revisionNumber.toString()}.`,
    );
  }
  return revision;
}

function terminalState(state: BucksDareState): boolean {
  return !["draft", "pending_accept", "activating", "active"].includes(state);
}

function parsedRevisionPlan(revision: VisibleDareRow["revisions"][number]) {
  return DareSqlCompilationSchema.parse(JSON.parse(revision.compiledPlan));
}

function progressForRow(
  row: VisibleDareRow,
  revision: VisibleDareRow["revisions"][number],
  targetKeys: readonly string[],
  state: BucksDareState,
) {
  return deriveDareProgress({
    targetKeys,
    final: terminalState(state),
    finalityReason: terminalState(state) ? state : "in_progress",
    compilation: parsedRevisionPlan(revision),
    evidence: row.evidence,
    settledValue: row.finalValue,
  });
}
function listItem(
  row: VisibleDareRow,
  viewerDiscordId: DiscordAccountId,
): DareListItem {
  const revision = activeRevision(row);
  const state = BucksDareStateSchema.parse(row.dareState);
  const draftTargets = DareTargetBindingSchema.array().parse(
    JSON.parse(revision.targetsJson),
  );
  const targetKeys =
    row.targets.length === 0
      ? draftTargets.map((target) => target.key)
      : row.targets.map((target) => target.targetKey);
  const viewer = dareViewerFacts(row, viewerDiscordId);
  return DareListItemSchema.parse({
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
    originalText: revision.originalText,
    displayTitle: revision.displayTitle,
    statusPhrases: parseStoredStatusPhrases(revision.statusPhrasesJson),
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
): DareInspection {
  const revision = activeRevision(row);
  const plan = parsedRevisionPlan(revision);
  const draftTargets = DareTargetBindingSchema.array().parse(
    JSON.parse(revision.targetsJson),
  );
  return DareInspectionSchema.parse({
    ...listItem(row, viewerDiscordId),
    channelId: row.channelId,
    originConversationId: row.originConversationId,
    canonicalScoutQl: revision.canonicalScoutQl,
    plan,
    semanticProofPlan: revision.semanticProofPlan,
    deadlineSpec: DareDeadlineSpecSchema.parse(
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
    activationHealth:
      row.activation === null
        ? null
        : {
            status:
              row.activation.completedAt === null
                ? row.activation.errorCode === null
                  ? "pending"
                  : "retrying"
                : "complete",
            requestedAt: row.activation.requestedAt.toISOString(),
            attemptCount: row.activation.attemptCount,
            lastAttemptAt: iso(row.activation.lastAttemptAt),
            nextAttemptAt: row.activation.nextAttemptAt.toISOString(),
            errorCode: row.activation.errorCode,
            completedAt: iso(row.activation.completedAt),
          },
  });
}

const includeVisibleDare = {
  revisions: { orderBy: { revision: "asc" as const } },
  targets: { orderBy: { id: "asc" as const } },
  contributions: { select: { discordId: true } },
  evidence: {
    orderBy: [{ gameEndAt: "asc" as const }, { matchId: "asc" as const }],
  },
  _count: { select: { evidence: true } },
  activation: true,
};

const VISIBLE_DARE_PAGE_SIZE = 25;

function visibleState(state: BucksDareState): boolean {
  return state !== "draft" && state !== "deleted";
}

export async function listVisibleDarePage(
  input: {
    serverId: DiscordGuildId;
    viewerDiscordId: DiscordAccountId;
    scope: "mine" | "guild" | "needs_action";
    search?: string | undefined;
    states?: BucksDareState[] | undefined;
    role?: "challenger" | "target" | "contributor" | "involved" | undefined;
    sort?: "needs_action" | "deadline" | "updated" | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
  prisma: ExtendedPrismaClient,
): Promise<DareListPage> {
  const search = input.search?.trim();
  const rows = await prisma.bucksDare.findMany({
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
    select: visibleDareIndexSelection,
  });
  const matches = indexVisibleDares({
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
  const pageRows = await prisma.bucksDare.findMany({
    where: { id: { in: pageIndex.map((item) => item.id) } },
    include: includeVisibleDare,
  });
  const pageRowsById = new Map(pageRows.map((row) => [row.id, row]));
  const items = pageIndex.map((item) => {
    const row = pageRowsById.get(item.id);
    if (row === undefined) {
      throw new Error(`Dare ${item.id.toString()} disappeared while paging.`);
    }
    return listItem(row, input.viewerDiscordId);
  });
  const last = pageIndex.at(-1);
  return DareListPageSchema.parse({
    items,
    nextCursor:
      last !== undefined && start + items.length < matches.length
        ? last.id.toString()
        : null,
  });
}

export async function listVisibleDares(
  input: {
    serverId: DiscordGuildId;
    viewerDiscordId: DiscordAccountId;
    scope: "mine" | "guild";
    search?: string | undefined;
  },
  prisma: ExtendedPrismaClient,
): Promise<DareListItem[]> {
  const page = await listVisibleDarePage({ ...input, limit: 100 }, prisma);
  return page.items;
}

export async function inspectVisibleDare(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    viewerDiscordId: DiscordAccountId;
  },
  prisma: ExtendedPrismaClient,
): Promise<DareInspection | null> {
  const [row, botState] = await Promise.all([
    prisma.bucksDare.findFirst({
      where: { id: input.dareId, serverId: input.serverId },
      include: includeVisibleDare,
    }),
    prisma.botState.findUnique({ where: { id: 1 } }),
  ]);
  if (row === null) return null;
  const state = BucksDareStateSchema.parse(row.dareState);
  return !visibleState(state) &&
    row.challengerDiscordId !== input.viewerDiscordId
    ? null
    : inspection(row, input.viewerDiscordId, darePollHealth(botState));
}
