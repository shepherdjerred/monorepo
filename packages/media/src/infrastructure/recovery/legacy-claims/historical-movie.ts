import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { readPlexPointers } from "#infrastructure/plex-binding/records.ts";
import { MovieRetentionWarningV4Schema } from "#shared/movie-editions/retention-v4.ts";

export class HistoricalMovieRetentionProtection extends Error {
  constructor(
    readonly reason:
      | "intent_obsolete"
      | "decision_obsolete"
      | "movie_scope_requires_v4_retention",
  ) {
    super(reason);
  }
}

type Input = {
  mediaIds: readonly string[];
  generation?: { mediaId: string; generation: number };
  generations?: readonly { mediaId: string; generation: number }[];
  decisionId?: string;
};

/** Caller holds canonical/target/request/runtime locks. Never interpret a scoped ledger as old consent. */
export async function assertHistoricalMovieRetention(
  tx: Prisma.TransactionClient,
  input: Input,
  budget: PublicationAuthorityReadBudget,
) {
  const media = await tx.mediaItem.findMany({
    where: { id: { in: [...input.mediaIds] }, kind: "movie" },
    select: { id: true },
  });
  const ids = media.map((row) => row.id).sort();
  await assertCapturedGenerations(tx, input);
  if (input.decisionId !== undefined) {
    const decision = await tx.retentionDecision.findUniqueOrThrow({
      where: { id: input.decisionId },
    });
    budget.consume(1);
    if (!input.mediaIds.includes(decision.mediaId))
      throw new Error("Historical decision is outside its held media scopes");
    const target = await tx.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: decision.mediaId, edition: "default" },
      },
    });
    if (
      decision.edition !== "default" ||
      decision.generation !== target.generation ||
      ["cancelled", "restored"].includes(decision.state)
    )
      throw new HistoricalMovieRetentionProtection("decision_obsolete");
    await assertHistoricalDecision(tx, decision, budget);
  }
  if (ids.length === 0) return;
  if (ids.length >= budget.takeWeighted(2))
    throw new NativeArchiveScopeProtection(
      "Historical movie dispatch exceeds its original provenance allowance",
    );
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId" FROM "PlexBindingCurrent" WHERE edition='default' AND "mediaId" IN (${Prisma.join(ids)}) ORDER BY "mediaId" FOR SHARE`,
  );
  const pointers = await readPlexPointers(
    tx,
    ids.map((mediaId) => ({ mediaId, edition: "default" })),
    budget,
  );
  if (
    pointers.some((pointer) => pointer.current?.association.schemaVersion === 2)
  )
    throw new HistoricalMovieRetentionProtection(
      "movie_scope_requires_v4_retention",
    );
  // A genuine scoped quarantine may already have retired the current pointer.
  const decisions = z
    .array(
      z.object({
        id: z.uuid(),
        mediaId: z.uuid(),
        edition: z.string(),
        generation: z.int(),
        warning: z.object({
          id: z.uuid(),
          mediaId: z.string().nullable(),
          kind: z.string(),
          payload: z.json(),
        }),
      }),
    )
    .parse(
      await tx.$queryRaw(Prisma.sql`
    SELECT d.id, d."mediaId", d.edition, d.generation,
      jsonb_build_object('id', e.id, 'mediaId', e."mediaId", 'kind', e.kind, 'payload', e.payload) AS warning
    FROM "RetentionDecision" d
    JOIN "MediaIntent" target ON target."mediaId"=d."mediaId" AND target.edition=d.edition AND target.generation=d.generation
    JOIN "ApplicationEvent" e ON e.id=d.evidence->>'warningEventId'
    WHERE d."mediaId" IN (${Prisma.join(ids)}) AND d.edition='default'
      AND e.payload->>'kind'='movie_retention_warning'
    ORDER BY d.id LIMIT ${budget.takeWeighted(2)}`),
    );
  budget.consume(decisions.length * 2);
  for (const decision of decisions)
    assertHistoricalWarning(decision, decision.warning);
}

async function assertCapturedGenerations(
  tx: Prisma.TransactionClient,
  input: Input,
) {
  const captured = [
    ...(input.generations ?? []),
    ...(input.generation === undefined ? [] : [input.generation]),
  ];
  if (captured.length === 0) return;
  if (
    new Set(captured.map((row) => row.mediaId)).size !== captured.length ||
    captured.some((row) => !input.mediaIds.includes(row.mediaId))
  )
    throw new Error(
      "Historical generations are ambiguous or outside their held media scopes",
    );
  const targets = await tx.mediaIntent.findMany({
    where: {
      edition: "default",
      mediaId: { in: captured.map((row) => row.mediaId) },
    },
    select: { mediaId: true, generation: true },
  });
  if (targets.length !== captured.length)
    throw new Error("Historical generation lost its actual held target");
  if (
    captured.some(
      (row) =>
        !targets.some(
          (target) =>
            target.mediaId === row.mediaId &&
            target.generation === row.generation,
        ),
    )
  )
    throw new HistoricalMovieRetentionProtection("intent_obsolete");
}

async function assertHistoricalDecision(
  tx: Prisma.TransactionClient,
  decision: {
    id: string;
    mediaId: string;
    edition: string;
    generation: number;
    evidence: unknown;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const evidence = z
    .object({ warningEventId: z.string().optional() })
    .parse(decision.evidence);
  if (evidence.warningEventId === undefined) return;
  const event = await tx.applicationEvent.findUniqueOrThrow({
    where: { id: evidence.warningEventId },
  });
  budget.consume(1);
  assertHistoricalWarning(decision, event);
}

function assertHistoricalWarning(
  decision: {
    id: string;
    mediaId: string;
    edition: string;
    generation: number;
  },
  event: { mediaId: string | null; kind: string; payload: unknown },
) {
  const header = z.object({ kind: z.string().optional() }).parse(event.payload);
  if (header.kind === undefined) return;
  if (header.kind !== "movie_retention_warning")
    throw new Error("Historical retention warning claims an unknown protocol");
  const warning = MovieRetentionWarningV4Schema.parse(event.payload);
  if (
    event.kind !== "retention_warning" ||
    event.mediaId !== decision.mediaId ||
    warning.decisionId !== decision.id ||
    warning.generation !== decision.generation ||
    warning.scope.mediaId !== decision.mediaId ||
    warning.scope.edition !== decision.edition
  )
    throw new Error(
      "Scoped movie decision differs from its actual immutable warning",
    );
  throw new HistoricalMovieRetentionProtection(
    "movie_scope_requires_v4_retention",
  );
}
