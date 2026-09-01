import {
  BucksDareV2StateSchema,
  DareCompiledPlanV2Schema,
  DareDeadlineSpecV2Schema,
  DareTargetBindingV2Schema,
  type BucksDareV2State,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

const StoredTargetSchema = DareTargetBindingV2Schema.omit({
  accounts: true,
}).extend({
  acceptedAt: z.iso.datetime().nullable(),
  declinedAt: z.iso.datetime().nullable(),
  payout: z.number().int().nullable(),
  fee: z.number().int().nullable(),
});

export const DareV2ListItemSchema = z.strictObject({
  id: z.number().int().positive(),
  serverId: z.string().min(1),
  state: BucksDareV2StateSchema,
  currentRevision: z.number().int().positive(),
  fundedRevision: z.number().int().positive().nullable(),
  challengerDiscordId: z.string().min(1),
  targetAliases: z.array(z.string().min(1)),
  plainLanguage: z.string().min(1),
  openingStake: z.number().int().positive(),
  potTotal: z.number().int().nonnegative(),
  evidenceGames: z.number().int().nonnegative(),
  proposalExpiresAt: z.iso.datetime().nullable(),
  acceptDeadline: z.iso.datetime().nullable(),
  activatedAt: z.iso.datetime().nullable(),
  deadlineAt: z.iso.datetime().nullable(),
  settledAt: z.iso.datetime().nullable(),
  finalValue: z.boolean().nullable(),
  updatedAt: z.iso.datetime(),
});
export type DareV2ListItem = z.infer<typeof DareV2ListItemSchema>;

export const DareV2InspectionSchema = DareV2ListItemSchema.extend({
  channelId: z.string().min(1),
  canonicalScoutQl: z.string().min(1),
  plan: DareCompiledPlanV2Schema,
  semanticProofPlan: z.string().min(1),
  originalText: z.string().min(1),
  deadlineSpec: DareDeadlineSpecV2Schema,
  compilerVersion: z.string().min(1),
  evaluatorVersion: z.string().min(1),
  targets: z.array(StoredTargetSchema),
  proof: z.json().nullable(),
  voidReason: z.string().nullable(),
});
export type DareV2Inspection = z.infer<typeof DareV2InspectionSchema>;

type VisibleDareRow = {
  id: number;
  serverId: string;
  channelId: string;
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

function listItem(row: VisibleDareRow): DareV2ListItem {
  const revision = activeRevision(row);
  const draftTargets = DareTargetBindingV2Schema.array().parse(
    JSON.parse(revision.targetsJson),
  );
  return DareV2ListItemSchema.parse({
    id: row.id,
    serverId: row.serverId,
    state: BucksDareV2StateSchema.parse(row.dareState),
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
    proposalExpiresAt: iso(row.proposalExpiresAt),
    acceptDeadline: iso(row.acceptDeadline),
    activatedAt: iso(row.activatedAt),
    deadlineAt: iso(row.deadlineAt),
    settledAt: iso(row.settledAt),
    finalValue: row.finalValue,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function inspection(row: VisibleDareRow): DareV2Inspection {
  const revision = activeRevision(row);
  const draftTargets = DareTargetBindingV2Schema.array().parse(
    JSON.parse(revision.targetsJson),
  );
  return DareV2InspectionSchema.parse({
    ...listItem(row),
    channelId: row.channelId,
    canonicalScoutQl: revision.canonicalScoutQl,
    plan: DareCompiledPlanV2Schema.parse(JSON.parse(revision.compiledPlan)),
    semanticProofPlan: revision.semanticProofPlan,
    originalText: revision.originalText,
    deadlineSpec: DareDeadlineSpecV2Schema.parse(
      JSON.parse(revision.deadlineSpecJson),
    ),
    compilerVersion: revision.compilerVersion,
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
  });
}

const includeVisibleDare = {
  revisions: { orderBy: { revision: "asc" as const } },
  targets: { orderBy: { id: "asc" as const } },
  _count: { select: { evidence: true } },
};

function visibleState(state: BucksDareV2State): boolean {
  return state !== "draft" && state !== "deleted";
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
        ...(search === undefined || search.length === 0
          ? []
          : [
              {
                OR: [
                  {
                    revisions: {
                      some: { originalText: { contains: search } },
                    },
                  },
                  {
                    revisions: {
                      some: { targetsJson: { contains: search } },
                    },
                  },
                  { targets: { some: { alias: { contains: search } } } },
                ],
              },
            ]),
      ],
    },
    include: includeVisibleDare,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return rows.map((row) => listItem(row));
}

export async function inspectVisibleDareV2(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    viewerDiscordId: DiscordAccountId;
  },
  prisma: ExtendedPrismaClient,
): Promise<DareV2Inspection | null> {
  const row = await prisma.bucksDareV2.findFirst({
    where: { id: input.dareId, serverId: input.serverId },
    include: includeVisibleDare,
  });
  if (row === null) return null;
  const state = BucksDareV2StateSchema.parse(row.dareState);
  if (
    !visibleState(state) &&
    row.challengerDiscordId !== input.viewerDiscordId
  ) {
    return null;
  }
  return inspection(row);
}
