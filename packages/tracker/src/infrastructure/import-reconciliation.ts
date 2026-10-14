import type { ReconcileRecord } from "#shared/import-schema.ts";
import type { Database } from "./database.ts";
import { TrackerError } from "#domain/error.ts";
import { importContentHash } from "./import-hash.ts";
import { audit, json } from "./issue-repository.ts";
import {
  reconcileCommentData,
  reconcileIssueData,
} from "./import-reconciled-data.ts";

function validatePair({ previous, next }: ReconcileRecord) {
  if (
    previous.externalId !== next.externalId ||
    previous.data.identifier !== next.data.identifier ||
    previous.data.createdAt !== next.data.createdAt
  )
    throw new TrackerError(
      "CONFLICT",
      "Catch-up cannot change record identity or creation time",
    );
  if (
    previous.entityType === "issue" &&
    next.entityType === "issue" &&
    (next.rawSourcePayload["updatedAt"] !== next.data.updatedAt ||
      Date.parse(next.data.updatedAt) < Date.parse(previous.data.updatedAt))
  )
    throw new TrackerError(
      "CONFLICT",
      "Catch-up cannot move an issue update time backwards",
    );
}

/** Snapshot hashes and live fields protect imported records from blind overwrites. */
export async function reconcileRecord(
  database: Database,
  input: ReconcileRecord,
  requestId: string,
) {
  validatePair(input);
  const { previous, next } = input;
  const identity = {
    source: previous.source,
    entityType: previous.entityType,
    externalId: previous.externalId,
  };
  const beforeHash = importContentHash(previous);
  const afterHash = importContentHash(next);
  return database.$transaction(async (db) => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(identity)}, 0))::text AS "locked"`;
    const mapping = await db.importMapping.findUniqueOrThrow({
      where: { source_entityType_externalId: identity },
    });
    if (mapping.contentHash === afterHash)
      return {
        status: "unchanged" as const,
        destinationId: mapping.destinationId,
      };
    if (mapping.contentHash !== beforeHash)
      throw new TrackerError(
        "CONFLICT",
        "Previous snapshot does not match the imported record",
      );
    const id = mapping.destinationId;
    let issueId: string;
    if (previous.entityType === "issue" && next.entityType === "issue")
      issueId = await reconcileIssueData(db, previous, next, id);
    else if (previous.entityType === "comment" && next.entityType === "comment")
      issueId = await reconcileCommentData(db, previous, next, id);
    else throw new TrackerError("CONFLICT", "Catch-up record types differ");
    const actor = await db.actor.upsert({
      where: { key: next.actor.key },
      create: { ...next.actor, firstMetadata: next.actor.metadata },
      update: {
        name: next.actor.name,
        metadata: next.actor.metadata,
        lastSeenAt: new Date(),
        seenCount: { increment: 1 },
      },
    });
    await db.importMapping.update({
      where: { source_entityType_externalId: identity },
      data: { contentHash: afterHash },
    });
    const event = await audit(
      { db, actor, requestId },
      {
        entityType: next.entityType,
        entityId: id,
        issueId,
        issueIdentifier: next.data.identifier,
        action: "import-reconciled",
        before: { ...previous.data, contentHash: beforeHash },
        after: { ...next.data, contentHash: afterHash },
      },
    );
    await db.event.update({
      where: { id: event.id },
      data: { rawSourcePayload: json(next.rawSourcePayload) },
    });
    return { status: "reconciled" as const, destinationId: id };
  });
}
