import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable, queueOperation } from "#automation/store.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import {
  lockEffectiveRequests,
  effectiveRequestWhere,
} from "#infrastructure/request-claims.ts";
import {
  lockRuntimeAuthority,
  runtimeAuthority,
} from "#infrastructure/handoff/authority.ts";
import { assertCurrentMovieAssessment } from "#infrastructure/movie-editions/release-assessment.ts";
import { requireMovieSponsor } from "#automation/editions/choice.ts";
import { requireMovieSponsorV4 } from "#automation/movie-editions/candidates.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import {
  FeedMatchProgressV1Schema,
  MatchFeedSourceV1Schema,
  type MatchFeedSourceV1,
} from "#shared/feeds/contract.ts";
import { readFeedSourceV1 } from "./source.ts";
import { selectFeedCandidateV1, type FeedMatchTarget } from "./selection.ts";
import { feedTargetMayMatch } from "./prefilter.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";

type Cursor = MatchFeedSourceV1["cursor"];
type Selected = Awaited<ReturnType<typeof selectFeedCandidateV1>>;
const position = (value: NonNullable<Cursor>) =>
  `${value.mediaId}:${value.edition}`;

async function matchCommand(
  tx: Prisma.TransactionClient,
  input: MatchFeedSourceV1,
) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const command = z
    .object({
      ...MatchFeedSourceV1Schema.shape,
      kind: z.literal("match_provider_feed_source_v1"),
    })
    .parse(operation.payload);
  if (
    operation.kind !== command.kind ||
    command.operationId !== input.operationId ||
    command.sourceId !== input.sourceId ||
    command.cursor !== null ||
    operation.targetId !== input.sourceId
  )
    throw new Error("Feed matching command lost its original observation");
  const raw = z
    .object({ feedMatchV1: FeedMatchProgressV1Schema.optional() })
    .parse(operation.result ?? {}).feedMatchV1;
  const progress = raw ?? {
    schemaVersion: 1 as const,
    sourceId: input.sourceId,
    cursor: null,
    completed: false,
  };
  if (progress.sourceId !== input.sourceId)
    throw new Error("Feed matching checkpoint changed its source");
  if (operation.status === "completed" && !progress.completed)
    throw new Error("Completed feed matching lost its actual checkpoint");
  return { operation, progress };
}

/** One Activity examines at most 25 target scopes; each outbox decision advances its cursor atomically. */
export async function matchProviderFeedSourceV1(
  context: MediaAutomationContext,
  raw: MatchFeedSourceV1,
) {
  const input = MatchFeedSourceV1Schema.parse(raw);
  const source = await readFeedSourceV1(
    context.db,
    context.cipher,
    input.sourceId,
  );
  const initial = await matchCommand(context.db, input);
  if (initial.progress.completed)
    return { status: "processed" as const, processed: 0, nextCursor: null };
  const cursor = initial.progress.cursor;
  if (
    input.cursor !== null &&
    (cursor === null || position(input.cursor) > position(cursor))
  )
    throw new Error("Feed matching caller skipped uncommitted target scopes");
  const runtime = await runtimeAuthority(context.db);
  const provider = await context.db.mediaProvider.findUniqueOrThrow({
    where: { id: source.providerId },
  });
  if (
    !runtime.active ||
    !provider.enabled ||
    !(await context.gates.acquisition())
  )
    return { status: "paused" as const, processed: 0, nextCursor: cursor };
  const targets = await context.db.mediaIntent.findMany({
    where: {
      desiredPresence: true,
      monitoring: true,
      intentionallyRemovedAt: null,
      automationEpoch: runtime.epoch,
      media: {
        kind: { in: ["movie", "episode"] },
        OR: [{ airDate: null }, { airDate: { lte: new Date() } }],
      },
      ...(cursor === null
        ? {}
        : {
            OR: [
              { mediaId: { gt: cursor.mediaId } },
              { mediaId: cursor.mediaId, edition: { gt: cursor.edition } },
            ],
          }),
    },
    orderBy: [{ mediaId: "asc" }, { edition: "asc" }],
    take: 25,
    include: { media: { include: { parent: { include: { parent: true } } } } },
  });
  let processed = 0;
  let nextCursor = cursor;
  for (const target of targets) {
    const selected = await scopedSelection(context, target, source);
    if (selected !== null) {
      const committed = await commitMatchedTarget(context, {
        input,
        target,
        selected,
        providerId: source.providerId,
      });
      if (!committed) {
        const progress = await advanceCursor(context, input, {
          cursor: nextCursor,
          completed: false,
        });
        return {
          status: "paused" as const,
          processed,
          nextCursor: progress.cursor,
        };
      }
    }
    nextCursor = { mediaId: target.mediaId, edition: target.edition };
    processed++;
  }
  const progress = await advanceCursor(context, input, {
    cursor: nextCursor,
    completed: targets.length < 25,
  });
  return {
    status: "processed" as const,
    processed,
    nextCursor: progress.completed ? null : progress.cursor,
  };
}

/** Rejected metadata advances in one batch; it acquires no request, runtime or physical authority. */
async function advanceCursor(
  context: Pick<MediaAutomationContext, "db">,
  input: MatchFeedSourceV1,
  next: { cursor: Cursor; completed: boolean },
) {
  return serializable(context.db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.operationId} FOR UPDATE`;
    const { progress } = await matchCommand(tx, input);
    if (progress.completed) return { cursor: progress.cursor, completed: true };
    const cursor =
      progress.cursor !== null &&
      (next.cursor === null ||
        position(progress.cursor) > position(next.cursor))
        ? progress.cursor
        : next.cursor;
    const completed = next.completed;
    await writeProgress(tx, input, cursor, completed);
    return { cursor, completed };
  });
}

async function scopedSelection(
  context: MediaAutomationContext,
  target: FeedMatchTarget,
  source: ProviderCandidate,
) {
  if (!feedTargetMayMatch(target, source)) return null;
  try {
    return await selectFeedCandidateV1(context, target, source);
  } catch (error) {
    if (error instanceof MovieChoiceProtection) return null;
    throw error;
  }
}

async function commitMatchedTarget(
  context: MediaAutomationContext,
  input: {
    input: MatchFeedSourceV1;
    target: FeedMatchTarget;
    selected: Selected;
    providerId: string;
  },
) {
  return serializable(context.db, async (tx) => {
    const { target, selected } = input;
    if (target.media.kind === "movie")
      await lockMovieCommand(
        tx,
        MovieEditionScopeSchema.parse({
          mediaId: target.mediaId,
          rootMediaId: target.editionRootId,
          edition: target.edition,
        }),
      );
    else
      await lockDefaultScopes(tx, [defaultScope(target.mediaId)], {
        createMissing: false,
      });
    await lockEffectiveRequests(tx, [target.mediaId]);
    if (!(await lockRuntimeAuthority(tx, target.automationEpoch))) return false;
    await tx.$queryRaw`SELECT id FROM "MediaProvider" WHERE id=${input.providerId} FOR SHARE`;
    const provider = await tx.mediaProvider.findUniqueOrThrow({
      where: { id: input.providerId },
    });
    if (!provider.enabled) return false;
    await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.input.operationId} FOR UPDATE`;
    const command = await matchCommand(tx, input.input);
    const cursor = { mediaId: target.mediaId, edition: target.edition };
    if (
      command.progress.completed ||
      (command.progress.cursor !== null &&
        position(command.progress.cursor) >= position(cursor))
    )
      return true;
    const current = await tx.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: cursor },
    });
    if (
      selected !== null &&
      current.desiredPresence &&
      current.monitoring &&
      current.intentionallyRemovedAt === null &&
      current.generation === target.generation &&
      current.profileId === target.profileId &&
      current.version === target.version &&
      current.automationEpoch === target.automationEpoch &&
      current.editionRootId === target.editionRootId
    ) {
      try {
        await queueSelectedMatch(tx, { input, current, selected });
      } catch (error) {
        if (!(error instanceof MovieChoiceProtection)) throw error;
      }
    }
    await writeProgress(tx, input.input, cursor, false);
    selected?.freshness?.assertActive();
    return true;
  });
}

async function queueSelectedMatch(
  tx: Prisma.TransactionClient,
  input: {
    input: {
      input: MatchFeedSourceV1;
      target: FeedMatchTarget;
      providerId: string;
    };
    current: Pick<
      FeedMatchTarget,
      "mediaId" | "edition" | "editionRootId" | "generation" | "profileId"
    >;
    selected: NonNullable<Selected>;
  },
) {
  const { current, selected } = input;
  const scope = {
    mediaId: current.mediaId,
    rootMediaId: current.editionRootId,
    edition: current.edition,
  };
  const key = `feed-acquire-v1:${input.input.input.sourceId}:${current.mediaId}:${current.edition}:${String(current.generation)}`;
  if (selected.protocol === "movie-v4") {
    const movieScope = MovieEditionScopeSchema.parse(scope);
    const sponsor = await requireMovieSponsorV4(
      tx,
      movieScope,
      selected.access,
    );
    await assertCurrentMovieAssessment(
      tx,
      selected.selected.assessment,
      movieScope,
      selected.selected.releaseId,
    );
    await queueOperation(tx, {
      key,
      kind: "reconcile_movie_edition_v4",
      targetId: current.mediaId,
      userId: sponsor.choice.actorId,
      payload: {
        schemaVersion: 4,
        mediaId: current.mediaId,
        scope: movieScope,
        generation: current.generation,
        releaseId: selected.selected.releaseId,
        cursor: null,
      },
    });
    sponsor.freshness.assertActive();
  } else {
    const sponsor = await requireMovieSponsor(
      tx,
      current.mediaId,
      selected.access,
    );
    const demand = await tx.mediaRequest.count({
      where: { mediaId: current.mediaId, ...effectiveRequestWhere },
    });
    if (demand === 0) return;
    const profile = await tx.qualityProfile.findUniqueOrThrow({
      where: { id: selected.selected.profileId },
    });
    if (
      profile.id !== current.profileId ||
      profile.version !== selected.selected.profileVersion
    )
      return;
    await queueOperation(tx, {
      key,
      kind: "reconcile_media",
      targetId: current.mediaId,
      payload: {
        mediaId: current.mediaId,
        generation: current.generation,
        releaseId: selected.selected.id,
        cursor: null,
      },
    });
    sponsor?.freshness.assertActive();
  }
}

async function writeProgress(
  tx: Prisma.TransactionClient,
  input: MatchFeedSourceV1,
  cursor: Cursor,
  completed: boolean,
) {
  const progress = FeedMatchProgressV1Schema.parse({
    schemaVersion: 1,
    sourceId: input.sourceId,
    cursor,
    completed,
  });
  const count =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('feedMatchV1',${JSON.stringify(progress)}::jsonb) WHERE id=${input.operationId} AND kind='match_provider_feed_source_v1'`;
  if (count !== 1) throw new Error("Feed matching lost its actual coordinator");
}
