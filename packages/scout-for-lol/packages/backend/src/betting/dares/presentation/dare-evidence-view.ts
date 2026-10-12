import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  BucksDareStateSchema,
  DareProgressSchema,
  DareSqlCompilationSchema,
  DareSqlEvidenceSchema,
  DareTargetBindingSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import { deriveDareProgress } from "#src/betting/dares/presentation/dare-progress.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export const DareEvidenceInspectionSchema = z.strictObject({
  matchId: RiotMatchIdSchema,
  gameStartAt: z.iso.datetime(),
  gameEndAt: z.iso.datetime(),
  queue: z.string().min(1),
  candidateMembership: z.record(z.string(), z.boolean()),
  actualValues: z.record(
    z.string(),
    z.record(z.string(), z.number().nullable()),
  ),
  setResults: z.record(z.string(), z.boolean().nullable()),
  planVersion: z.string().min(1),
  progressBefore: DareProgressSchema,
  progressAfter: DareProgressSchema,
  raw: z.json(),
  coverageState: z.enum(["complete", "missing", "not_required"]),
  targetDependencies: z.record(z.string(), z.array(z.string().min(1))),
  sourceReferences: z.array(z.string().min(1)),
  evaluationTrace: z.array(z.string()),
});

export const DareEvidencePageSchema = z.strictObject({
  items: z.array(DareEvidenceInspectionSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type DareEvidencePage = z.infer<typeof DareEvidencePageSchema>;

const DEFAULT_PAGE_SIZE = 10;
const SourceReferencesSchema = z.array(
  z
    .strictObject({ matchId: RiotMatchIdSchema })
    .transform((row) => row.matchId),
);

function cursorFor(row: { gameEndAt: string; matchId: RiotMatchId }): string {
  return `${row.gameEndAt}|${row.matchId}`;
}

function visible(
  state: z.infer<typeof BucksDareStateSchema>,
  challengerDiscordId: string,
  viewerDiscordId: DiscordAccountId,
): boolean {
  return (
    (state !== "draft" && state !== "deleted") ||
    challengerDiscordId === viewerDiscordId
  );
}

export async function listDareEvidence(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    viewerDiscordId: DiscordAccountId;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
  prisma: ExtendedPrismaClient,
): Promise<DareEvidencePage | null> {
  const dare = await prisma.bucksDare.findFirst({
    where: { id: input.dareId, serverId: input.serverId },
    select: {
      challengerDiscordId: true,
      dareState: true,
      currentRevision: true,
      fundedRevision: true,
      targets: { select: { targetKey: true } },
      revisions: {
        select: { revision: true, compiledPlan: true, targetsJson: true },
      },
      evidence: {
        orderBy: [{ gameEndAt: "asc" }, { matchId: "asc" }],
      },
    },
  });
  if (dare === null) return null;
  const state = BucksDareStateSchema.parse(dare.dareState);
  if (!visible(state, dare.challengerDiscordId, input.viewerDiscordId)) {
    return null;
  }
  const revisionNumber = dare.fundedRevision ?? dare.currentRevision;
  const revision = dare.revisions.find(
    (candidate) => candidate.revision === revisionNumber,
  );
  if (revision === undefined) {
    throw new Error(
      `Dare ${input.dareId.toString()} is missing revision ${revisionNumber.toString()}.`,
    );
  }
  const rawPlan: unknown = JSON.parse(revision.compiledPlan);
  const targetKeys =
    dare.targets.length === 0
      ? DareTargetBindingSchema.array()
          .parse(JSON.parse(revision.targetsJson))
          .map((target) => target.key)
      : dare.targets.map((target) => target.targetKey);
  const compilation = DareSqlCompilationSchema.parse(rawPlan);
  const rows = dare.evidence.map((row, index) => {
    const evaluated = DareSqlEvidenceSchema.parse(
      JSON.parse(row.evaluationOutput),
    );
    const matchResults = evaluated.results.filter(
      (result) => result.matchId === row.matchId,
    );
    return DareEvidenceInspectionSchema.parse({
      matchId: row.matchId,
      gameStartAt: row.gameStartAt.toISOString(),
      gameEndAt: row.gameEndAt.toISOString(),
      queue: row.queueType,
      candidateMembership: Object.fromEntries(
        compilation.resultStructure.gameSets.map((gameSet) => [
          gameSet.name,
          matchResults.some((result) => result.gameSet === gameSet.name),
        ]),
      ),
      actualValues: Object.fromEntries(
        matchResults.map((result) => [result.gameSet, result.projections]),
      ),
      setResults: Object.fromEntries(
        matchResults.map((result) => [result.gameSet, result.matched]),
      ),
      coverageState:
        evaluated.coverage === "missing_timeline"
          ? "missing"
          : evaluated.coverage,
      targetDependencies: Object.fromEntries(
        matchResults.map((result) => [
          result.gameSet,
          result.targetDependencies,
        ]),
      ),
      sourceReferences: SourceReferencesSchema.parse(
        JSON.parse(row.sourceReferences),
      ),
      evaluationTrace: z
        .string()
        .array()
        .parse(JSON.parse(row.evaluationTrace)),
      planVersion: row.planVersion,
      progressBefore: deriveDareProgress({
        compilation,
        evidence: dare.evidence.slice(0, index),
        targetKeys,
        final: false,
        finalityReason: "evidence_snapshot",
      }),
      progressAfter: deriveDareProgress({
        compilation,
        evidence: dare.evidence.slice(0, index + 1),
        targetKeys,
        final: false,
        finalityReason: "evidence_snapshot",
      }),
      raw: evaluated,
    });
  });
  return evidencePage(rows, input.cursor, input.limit);
}

function evidencePage(
  rows: z.infer<typeof DareEvidenceInspectionSchema>[],
  cursor: string | undefined,
  requestedLimit: number | undefined,
): DareEvidencePage {
  const start =
    cursor === undefined
      ? 0
      : rows.findIndex((row) => cursorFor(row) === cursor) + 1;
  if (start === 0 && cursor !== undefined) {
    throw new Error("Dare evidence cursor does not belong to this Dare.");
  }
  const limit = requestedLimit ?? DEFAULT_PAGE_SIZE;
  const page = rows.slice(start, start + limit);
  const last = page.at(-1);
  return DareEvidencePageSchema.parse({
    items: page,
    nextCursor:
      last !== undefined && start + page.length < rows.length
        ? cursorFor(last)
        : null,
  });
}
