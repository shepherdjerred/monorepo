import {
  Prisma,
  type MediaIntent,
  type MediaKind,
  type MediaRequest,
  type RetentionDecision,
} from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { needsRestore } from "#infrastructure/locks.ts";
import { commandAutomationEpoch } from "#infrastructure/handoff/authority.ts";
import { requestedMovieOperationV4 } from "#infrastructure/movie-editions/lifecycle/requested-operation.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { z } from "zod";

/** Routing only: the existing restore Activities independently validate the
 * exact parent, physical cohort, bytes, ownership epoch and current demand. */
export async function continuedRequestRestore(
  tx: Prisma.TransactionClient,
  input: { request: MediaRequest; target: MediaIntent; kind: MediaKind },
) {
  const { request, target, kind } = input;
  if (kind === "series" || kind === "season") return null;
  const decisions = await tx.retentionDecision.findMany({
    where: {
      mediaId: request.mediaId,
      edition: request.edition,
      state: "quarantined",
      manifest: { not: Prisma.DbNull },
    },
    take: 2,
  });
  if (decisions.length > 1)
    throw new Error("Continued request has ambiguous quarantine parents");
  const decision = decisions[0];
  let operation: { kind: string; details: Prisma.InputJsonObject } | null =
    kind === "movie" && decision !== undefined
      ? await scopedMovieRestore(tx, { request, target, decision })
      : null;
  if (operation === null) {
    if (request.edition !== "default") {
      if (decision !== undefined || target.availability === "quarantined")
        throw new Error(
          "Named quarantine is missing its scoped restore parent",
        );
      return null;
    }
    if (!(await needsRestore(tx, request.mediaId))) return null;
    operation = {
      kind: "restore_media",
      details: {
        requestId: request.id,
        requestVersion: request.version,
        cursor: null,
      },
    };
  }
  const epoch = await commandAutomationEpoch(tx);
  if (epoch < 0 || target.automationEpoch !== epoch)
    throw new MediaError(
      "runtime_protected",
      "Current ownership must be verified before restoring this request",
      409,
    );
  return { ...operation, epoch };
}

async function scopedMovieRestore(
  tx: Prisma.TransactionClient,
  input: {
    request: MediaRequest;
    target: MediaIntent;
    decision: RetentionDecision;
  },
) {
  const { request, target, decision } = input;
  const parents = await tx.operation.findMany({
    where: {
      kind: "retain_movie_edition_v4",
      result: {
        path: ["movieQuarantinePlexReceiptV2", "decisionId"],
        equals: decision.id,
      },
    },
    take: 2,
  });
  if (parents.length > 1)
    throw new Error(
      "Continued movie request has ambiguous scoped quarantine parents",
    );
  const parent = parents[0];
  if (parent === undefined) return null;
  const scope = MovieEditionScopeSchema.parse({
    rootMediaId: target.editionRootId,
    mediaId: request.mediaId,
    edition: request.edition,
  });
  const receipt = MovieQuarantinePlexReceiptV2Schema.parse(
    z.object({ movieQuarantinePlexReceiptV2: z.json() }).parse(parent.result)
      .movieQuarantinePlexReceiptV2,
  );
  if (
    receipt.operationId !== parent.id ||
    parent.targetId !== request.mediaId ||
    receipt.decisionId !== decision.id ||
    identityHash(receipt.scope) !== identityHash(scope) ||
    receipt.manifestHash !== identityHash(decision.manifest) ||
    receipt.decisions[0].quarantinedVersion !== decision.version ||
    receipt.recoveryEpoch !== target.automationEpoch
  )
    throw new Error("Continued request scoped quarantine parent changed");
  const selected = await requestedMovieOperationV4(tx, {
    scope,
    generation: target.generation,
    request,
  });
  if (selected.kind !== "restore_movie_edition_v4")
    throw new Error(
      "Scoped quarantine parent lacks current quarantined coverage",
    );
  return { kind: selected.kind, details: selected.details };
}
