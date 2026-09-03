import {
  BucksDareV2StateSchema,
  DareCompiledPlanV2Schema,
  DareProgressSchema,
  DareTargetBindingV2Schema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import { DareEvidenceDiagnosticsV2Schema } from "#src/betting/dare-evidence-v2.ts";
import { deriveDareProgressV2 } from "#src/betting/dare-progress-v2.ts";
import { storedDareV2Evidence } from "#src/betting/dare-settle-evidence-v2.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export const DareEvidenceInspectionSchema = z
  .strictObject({
    matchId: z.string().min(1),
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
  })
  .extend(DareEvidenceDiagnosticsV2Schema.shape);

export const DareEvidencePageSchema = z.strictObject({
  items: z.array(DareEvidenceInspectionSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type DareEvidencePage = z.infer<typeof DareEvidencePageSchema>;

const DEFAULT_PAGE_SIZE = 10;

function cursorFor(row: { gameEndAt: string; matchId: string }): string {
  return `${row.gameEndAt}|${row.matchId}`;
}

function visible(
  state: z.infer<typeof BucksDareV2StateSchema>,
  challengerDiscordId: string,
  viewerDiscordId: DiscordAccountId,
): boolean {
  return (
    (state !== "draft" && state !== "deleted") ||
    challengerDiscordId === viewerDiscordId
  );
}

export async function listDareEvidenceV2(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    viewerDiscordId: DiscordAccountId;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
  prisma: ExtendedPrismaClient,
): Promise<DareEvidencePage | null> {
  const dare = await prisma.bucksDareV2.findFirst({
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
  const state = BucksDareV2StateSchema.parse(dare.dareState);
  if (!visible(state, dare.challengerDiscordId, input.viewerDiscordId)) {
    return null;
  }
  const revisionNumber = dare.fundedRevision ?? dare.currentRevision;
  const revision = dare.revisions.find(
    (candidate) => candidate.revision === revisionNumber,
  );
  if (revision === undefined) {
    throw new Error(
      `Dare v2 ${input.dareId.toString()} is missing revision ${revisionNumber.toString()}.`,
    );
  }
  const plan = DareCompiledPlanV2Schema.parse(
    JSON.parse(revision.compiledPlan),
  );
  const targetKeys =
    dare.targets.length === 0
      ? DareTargetBindingV2Schema.array()
          .parse(JSON.parse(revision.targetsJson))
          .map((target) => target.key)
      : dare.targets.map((target) => target.targetKey);
  const evidence = dare.evidence.map((row) => storedDareV2Evidence(row));
  const rows = evidence.map((row, index) => {
    const common = {
      plan,
      targetKeys,
      final: false,
      finalityReason: "evidence_snapshot",
    };
    return DareEvidenceInspectionSchema.parse({
      matchId: row.matchId,
      gameStartAt: row.gameStartAt,
      gameEndAt: row.gameEndAt,
      queue: row.queue,
      candidateMembership: row.candidateSets,
      actualValues: row.setValues,
      setResults: row.setResults,
      coverageState: row.coverageState,
      targetDependencies: row.targetDependencies,
      sourceReferences: row.sourceReferences,
      evaluationTrace: row.evaluationTrace,
      planVersion: dare.evidence[index]?.planVersion,
      progressBefore: deriveDareProgressV2({
        ...common,
        evidence: evidence.slice(0, index),
      }),
      progressAfter: deriveDareProgressV2({
        ...common,
        evidence: evidence.slice(0, index + 1),
      }),
      raw: row,
    });
  });
  const start =
    input.cursor === undefined
      ? 0
      : rows.findIndex((row) => cursorFor(row) === input.cursor) + 1;
  if (start === 0 && input.cursor !== undefined) {
    throw new Error("Dare evidence cursor does not belong to this Dare.");
  }
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
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
