import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { MediaError } from "#application/errors.ts";
import {
  MOVIE_EDITION_REGISTRY,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import {
  MovieRollbackViewV1Schema,
  type MovieRollbackViewV1,
} from "#shared/movie-editions/rollback/view.ts";
import { MovieRollbackIntentEnvelopeV1Schema } from "#shared/movie-editions/rollback/physical.ts";
import {
  MoviePublicationOutcomeV2Schema,
  type MoviePublicationAssetV2,
} from "#shared/movie-editions/publication-v2.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { observeMovieRollbackClosedOwnerV1 } from "#automation/movie-editions/rollback/closed-owner.ts";
import {
  captureRequestedMovieRollbackContextV1,
  captureRequestedMovieRollbackOwnerV1,
} from "./manual/manual-context.ts";
import {
  rollbackIntentFromOperationV1,
  readMovieRollbackPlexV1,
} from "./records.ts";
import {
  captureMovieRollbackRetryContextV1,
  type MovieRollbackRetryInvocationV1,
} from "./retry/retry-context.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { RequestedMovieRollbackPayloadV1Schema } from "#shared/movie-editions/rollback/manual-command.ts";
import { RequestedMovieRollbackRetryPayloadV1Schema } from "#shared/movie-editions/rollback/retry.ts";
import { MovieRetryClosedWorkflowV1Schema } from "#shared/movie-editions/retry/v1.ts";

type ReadInput = {
  actorId: string;
  scope: MovieEditionScope;
  access: MovieChoiceAccess;
  invocation: MovieRollbackRetryInvocationV1;
};
type Transaction = Prisma.TransactionClient;
type ViewDetail = Pick<
  MovieRollbackViewV1,
  | "scope"
  | "title"
  | "editionLabel"
  | "predecessor"
  | "successor"
  | "originalDeadline"
>;

/** Discovery materializes only this selected cut. Every returned command must
 * still win its exact CAS again at queueing and actual Activity admission. */
export async function readMovieRollbackViewV1(
  db: Database,
  input: ReadInput,
  describe: MediaAutomationContext["describeWorkflow"],
): Promise<MovieRollbackViewV1> {
  const captured = await db.$transaction(async (tx) => {
    const result = await discover(tx, input);
    const detail = "parent" in result ? result.detail : result;
    const pending = await pendingUnadmittedCommands(tx, input, detail);
    return { result, detail, pending };
  });
  const pending = await observePendingCommands(
    captured.pending,
    input.invocation,
    describe,
  );
  if (pending !== null)
    return MovieRollbackViewV1Schema.parse({
      ...captured.detail,
      state: "in_progress",
      reason: pending,
      command: null,
    });
  const discovered = captured.result;
  if (!("parent" in discovered)) return discovered;
  const closed = await observeMovieRollbackClosedOwnerV1(
    describe,
    discovered.parent.intent,
    {
      execution: input.invocation.execution,
      ...(discovered.owner === undefined ? {} : { owner: discovered.owner }),
    },
  );
  input.invocation.execution.assertActive();
  return MovieRollbackViewV1Schema.parse(
    closed.state === "closed"
      ? {
          ...discovered.detail,
          state: "retry",
          reason: null,
          command: {
            schemaVersion: 1,
            scope: input.scope,
            sourceAttemptId:
              discovered.parent.intent.invocation.source.attemptId,
            resume: {
              operationId: discovered.parent.operation.id,
              intentHash: discovered.parent.intentHash,
            },
            expected: discovered.expected,
          },
        }
      : {
          ...discovered.detail,
          state: "in_progress",
          reason:
            closed.state === "running"
              ? "workflow_running"
              : "workflow_state_unknown",
          command: null,
        },
  );
}

/** A queued command can still win admission without an intent marker. This is
 * negative participant discovery, never a grant or inferred prior attempt. */
async function pendingUnadmittedCommands(
  tx: Transaction,
  input: ReadInput,
  detail: ViewDetail,
) {
  const assets = [detail.predecessor?.id, detail.successor?.id].filter(
    (id) => id !== undefined,
  );
  if (assets.length === 0) return [];
  const rows = await tx.operation.findMany({
    where: {
      kind: "rollback_movie_edition_v1",
      targetId: input.scope.mediaId,
      status: { in: ["queued", "running"] },
      payload: { path: ["scope"], equals: input.scope },
    },
    take: input.invocation.budget.take,
  });
  input.invocation.budget.consume(rows.length);
  return rows
    .filter((operation) => {
      const result = z
        .object({ movieRollbackIntentV1: z.unknown().optional() })
        .nullable()
        .parse(operation.result);
      if (result?.movieRollbackIntentV1 !== undefined) return false;
      const marker = z
        .object({ resume: z.unknown().optional() })
        .parse(operation.payload);
      if (marker.resume === undefined) {
        const payload = RequestedMovieRollbackPayloadV1Schema.parse(
          operation.payload,
        );
        return assets.includes(payload.request.expected.successor.id);
      }
      const payload = RequestedMovieRollbackRetryPayloadV1Schema.parse(
        operation.payload,
      );
      return (
        assets.includes(payload.retry.expected.predecessor.id) ||
        assets.includes(payload.retry.expected.successor.id)
      );
    })
    .map((operation) => `media-operation-${operation.id}`);
}

async function observePendingCommands(
  ids: readonly string[],
  invocation: MovieRollbackRetryInvocationV1,
  describe: MediaAutomationContext["describeWorkflow"],
) {
  for (const workflowId of ids) {
    invocation.execution.assertActive();
    // A description-port failure cannot establish absence of a pending writer.
    // Parsing remains outside this expected external I/O boundary.
    const actual = await describe(workflowId).catch(() => null);
    invocation.execution.assertActive();
    if (actual === null) return "workflow_state_unknown" as const;
    if (actual.status === "RUNNING") return "workflow_running" as const;
    if (
      !MovieRetryClosedWorkflowV1Schema.safeParse({ workflowId, ...actual })
        .success
    )
      return "workflow_state_unknown" as const;
  }
  return null;
}

async function discover(tx: Transaction, input: ReadInput) {
  const { invocation, scope } = input;
  const owner = await captureRequestedMovieRollbackOwnerV1(tx, input);
  const detail: ViewDetail = {
    scope,
    title: owner.media.title,
    editionLabel: MOVIE_EDITION_REGISTRY[scope.edition].displayLabel,
    predecessor: null,
    successor: null,
    originalDeadline: null,
  };
  const current = await tx.assetCoverage.findMany({
    where: { mediaId: scope.mediaId, edition: scope.edition, current: true },
    include: { asset: true },
    take: invocation.budget.takeWeighted(2),
  });
  invocation.budget.consume(current.length * 2);
  if (current.length > 1)
    throw new Error("Movie rollback discovery found competing current assets");
  const asset = current[0]?.asset;
  if (asset === undefined) return unavailable(detail, "no_current_movie");
  const pending = z.array(z.strictObject({ id: z.uuid() })).parse(
    await tx.$queryRaw(Prisma.sql`
    SELECT o.id FROM "Operation" o WHERE o.result#>'{movieRollbackIntentV1,intent,scope}'=${JSON.stringify(scope)}::jsonb
    AND NOT(COALESCE(o.result,'{}'::jsonb)?'movieRollbackPlexV1')
    AND (o.result#>>'{movieRollbackIntentV1,intent,predecessor,id}'=${asset.id} OR o.result#>>'{movieRollbackIntentV1,intent,successor,id}'=${asset.id})
    ORDER BY o.id LIMIT ${invocation.budget.take}`),
  );
  invocation.budget.consume(pending.length);
  if (pending.length > 1)
    throw new Error(
      "Movie rollback discovery found competing pending inverses",
    );
  if (pending[0] !== undefined) {
    const parent = await readParent(tx, pending[0].id, input);
    const captured = await captureMovieRollbackRetryContextV1(tx, {
      ...input,
      parent,
    });
    return {
      parent,
      owner: captured.handoff?.handoff.owner,
      expected: captured.expected,
      detail: {
        ...detail,
        predecessor: summary(captured.predecessor),
        successor: summary(captured.successor),
        originalDeadline:
          parent.intent.cleanup?.expiresAt ?? parent.intent.expiresAt,
      },
    };
  }
  if (owner.target.availability !== "available")
    return unavailable(detail, "current_pair_protected");
  const completed = await tx.operation.findMany({
    where: {
      AND: [
        {
          result: {
            path: ["movieRollbackPlexV1", "receipt", "publication", "assetId"],
            equals: asset.id,
          },
        },
        {
          result: {
            path: [
              "movieRollbackPlexV1",
              "receipt",
              "publication",
              "assetVersion",
            ],
            equals: asset.version,
          },
        },
        {
          result: {
            path: ["movieRollbackIntentV1", "intent", "scope"],
            equals: scope,
          },
        },
      ],
    },
    take: invocation.budget.take,
  });
  invocation.budget.consume(completed.length);
  if (completed.length > 1)
    throw new Error(
      "Movie rollback discovery found competing serving completions",
    );
  if (completed[0] !== undefined) {
    const parent = await readParent(tx, completed[0].id, input);
    const serving = await readMovieRollbackPlexV1(
      tx,
      parent.intent.invocation,
      invocation.budget,
    );
    if (serving === null)
      throw new Error(
        "Movie rollback discovery lost its actual serving completion",
      );
    return MovieRollbackViewV1Schema.parse({
      ...detail,
      predecessor: summary(serving.receipt.predecessor),
      successor: summary(serving.receipt.successor),
      originalDeadline:
        parent.intent.cleanup?.expiresAt ?? parent.intent.expiresAt,
      state: "completed",
      reason: null,
      command: null,
    });
  }
  return discoverRequest(tx, input, detail, asset.id);
}

async function readParent(tx: Transaction, id: string, input: ReadInput) {
  const operation = await tx.operation.findUniqueOrThrow({ where: { id } });
  input.invocation.budget.consume(1);
  const header = z
    .object({ movieRollbackIntentV1: MovieRollbackIntentEnvelopeV1Schema })
    .parse(operation.result);
  const parent = await rollbackIntentFromOperationV1(tx, {
    invocation: header.movieRollbackIntentV1.intent.invocation,
    operation,
    budget: input.invocation.budget,
  });
  if (parent === null)
    throw new Error(
      "Movie rollback discovery lost its actual immutable admission",
    );
  return parent;
}

async function discoverRequest(
  tx: Transaction,
  input: ReadInput,
  detail: ViewDetail,
  assetId: string,
) {
  const rows = await tx.mediaPublicationTransition.findMany({
    where: {
      outcome: { path: ["entries", "0", "successor", "id"], equals: assetId },
    },
    take: input.invocation.budget.take,
  });
  input.invocation.budget.consume(rows.length);
  if (rows.length > 1)
    throw new Error(
      "Movie rollback discovery found competing original physical births",
    );
  const row = rows[0];
  if (row === undefined) return unavailable(detail, "no_retained_predecessor");
  const outcome = MoviePublicationOutcomeV2Schema.parse(row.outcome);
  if (
    identityHash(outcome) !== row.outcomeHash ||
    identityHash(outcome.scope) !== identityHash(input.scope) ||
    outcome.kind !== "published"
  )
    throw new Error(
      "Movie rollback discovery lost its actual scoped physical outcome",
    );
  const a = outcome.entries[0].predecessor,
    b = outcome.entries[0].successor;
  if (a === null || b === null)
    return unavailable(detail, "no_retained_predecessor");
  const cleanup = await tx.upgradeCleanup.findFirst({
    where: { assetId: a.id, successorAssetId: b.id },
    orderBy: { createdAt: "desc" },
  });
  input.invocation.budget.consume(cleanup === null ? 0 : 1);
  const known = {
    ...detail,
    predecessor: summary(a),
    successor: summary(b),
    originalDeadline: cleanup?.expiresAt.toISOString() ?? null,
  };
  if (cleanup?.state !== "pending")
    return unavailable(known, "no_retained_predecessor");
  if (cleanup.expiresAt.getTime() <= Date.now())
    return unavailable(known, "rollback_window_closed");
  try {
    const captured = await captureRequestedMovieRollbackContextV1(tx, {
      ...input,
      sourceAttemptId: row.attemptId,
    });
    return MovieRollbackViewV1Schema.parse({
      ...known,
      predecessor: summary(captured.predecessor),
      successor: summary(captured.successor),
      state: "request",
      reason: null,
      command: captured.context,
    });
  } catch (error) {
    if (
      !(error instanceof MediaError) ||
      error.code !== "movie_rollback_changed"
    )
      throw error;
    return unavailable(known, "current_pair_protected");
  }
}

function summary(asset: MoviePublicationAssetV2) {
  const quality = z
    .object({
      quality: z.string(),
      codec: z.string(),
      audioLanguages: z.array(z.string()),
    })
    .parse(asset.properties);
  return {
    id: asset.id,
    version: asset.version,
    ...quality,
    sizeBytes: asset.sizeBytes,
  };
}
function unavailable(
  detail: ViewDetail,
  reason: Extract<MovieRollbackViewV1, { state: "unavailable" }>["reason"],
): MovieRollbackViewV1 {
  return MovieRollbackViewV1Schema.parse({
    ...detail,
    state: "unavailable",
    reason,
    command: null,
  });
}
