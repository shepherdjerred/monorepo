import type { ObjectStore } from "#application/object-store.ts";
import type {
  ImportRecord,
  ImportEntity,
  ReconcileRecord,
} from "#shared/import-schema.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { importId } from "#shared/import-identity.ts";
import { TrackerError } from "#domain/error.ts";
import { importCatalog } from "./import-catalog.ts";
import { importIssueData } from "./import-issues.ts";
import { audit, findIssue, json } from "./issue-repository.ts";
import { safeFilename } from "./attachments.ts";
import type { Database } from "./database.ts";
import { importContentHash } from "./import-hash.ts";
import { reconcileRecord } from "./import-reconciliation.ts";

export class Importer {
  constructor(
    private readonly database: Database,
    private readonly store: ObjectStore,
  ) {}

  reconcile(input: ReconcileRecord, requestId: string) {
    return reconcileRecord(this.database, input, requestId);
  }

  async apply(record: ImportRecord, requestId: string) {
    const content = importContentHash(record);
    const identity = {
      source: record.source,
      entityType: record.entityType,
      externalId: record.externalId,
    };
    const key = JSON.stringify(identity);
    const id = await importId(
      record.source,
      record.entityType,
      record.externalId,
    );
    return this.database.$transaction(
      async (db) => {
        // Check before actor upsert: a duplicate import performs no database or S3 writes.
        await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "locked"`;
        const before = await db.importMapping.findUnique({
          where: { source_entityType_externalId: identity },
        });
        if (before !== null) {
          if (before.contentHash !== content)
            throw new TrackerError(
              "CONFLICT",
              `Import content changed for ${record.entityType}:${record.externalId}; use an isolated destination for a new export`,
            );
          return {
            status: "unchanged" as const,
            destinationId: before.destinationId,
          };
        }
        const actor = await db.actor.upsert({
          where: { key: record.actor.key },
          create: { ...record.actor, firstMetadata: record.actor.metadata },
          update: {
            name: record.actor.name,
            metadata: record.actor.metadata,
            lastSeenAt: new Date(),
            seenCount: { increment: 1 },
          },
        });
        const destinationId =
          (await importCatalog(db, record, id)) ??
          (await importIssueData(db, record, id)) ??
          (record.entityType === "attachment"
            ? await this.attachment(db, record, id)
            : undefined);
        if (destinationId === undefined)
          throw new Error("Import entity has no handler");
        await audit(
          { db, actor, requestId },
          {
            entityType: record.entityType,
            entityId: destinationId,
            action: "imported",
            after: { ...identity, destinationId, contentHash: content },
          },
        );
        await db.event.updateMany({
          where: { requestId, entityId: destinationId, action: "imported" },
          data: { rawSourcePayload: json(record.rawSourcePayload) },
        });
        await db.importMapping.create({
          data: { ...identity, destinationId, contentHash: content },
        });
        return { status: "imported" as const, destinationId };
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }

  private async attachment(
    db: Prisma.TransactionClient,
    record: ImportEntity<"attachment">,
    id: string,
  ) {
    const { data } = record;
    const bytes = Buffer.from(data.contentBase64, "base64");
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (bytes.length !== data.sizeBytes || hash !== data.sha256)
      throw new TrackerError(
        "BAD_REQUEST",
        "Imported attachment size or checksum mismatch",
      );
    const issue = await findIssue(db, data.identifier);
    const uploader = await db.actor.findUniqueOrThrow({
      where: { key: data.uploaderKey },
    });
    const mapping =
      data.commentExternalId === null
        ? null
        : await db.importMapping.findUniqueOrThrow({
            where: {
              source_entityType_externalId: {
                source: record.source,
                entityType: "comment",
                externalId: data.commentExternalId,
              },
            },
          });
    if (mapping !== null) {
      const comment = await db.comment.findUniqueOrThrow({
        where: { id: mapping.destinationId },
      });
      if (comment.issueId !== issue.id)
        throw new TrackerError(
          "BAD_REQUEST",
          "Imported attachment comment belongs to another issue",
        );
    }
    const storageKey = `imports/${record.source}/${id}/${data.sha256}`;
    await this.store.put(
      storageKey,
      new Blob([bytes]).stream(),
      data.contentType,
    );
    try {
      await db.attachment.create({
        data: {
          id,
          storageKey,
          issueId: issue.id,
          commentId: mapping?.destinationId ?? null,
          uploaderId: uploader.id,
          status: "committed",
          filename: safeFilename(data.filename),
          contentType: data.contentType,
          sizeBytes: bytes.length,
          sha256: hash,
          width: data.width,
          height: data.height,
          createdAt: data.createdAt,
        },
      });
    } catch (error) {
      await this.store.delete(storageKey);
      throw error;
    }
    return id;
  }
}
