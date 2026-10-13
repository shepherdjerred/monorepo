import { createHash } from "node:crypto";
import type { ObjectStore } from "#application/object-store.ts";
import type { UnitOfWork } from "#application/unit-of-work.ts";
import type { ActorEnvelope } from "#shared/actor.ts";
import { TrackerError } from "#domain/error.ts";
import { audit } from "./issue-repository.ts";
import type { Database } from "./database.ts";

const rasterTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);
export function safeFilename(value: string): string {
  return (
    value
      .replaceAll(/[^\p{L}\p{N}._ -]/gu, "_")
      .replace(/^\.+/u, "_")
      .slice(0, 200) || "attachment"
  );
}

export class Attachments {
  constructor(
    private readonly database: Database,
    private readonly unit: UnitOfWork,
    private readonly store: ObjectStore,
  ) {}

  async upload(
    file: File,
    actor: ActorEnvelope,
    maxBytes: number,
    requestId: string,
  ) {
    if (file.size > maxBytes)
      throw new TrackerError(
        "BAD_REQUEST",
        "Attachment exceeds the size limit",
      );
    const id = crypto.randomUUID();
    const storageKey = `attachments/${id}`;
    const hash = createHash("sha256");
    let bytes = 0;
    const contentType = file.type || "application/octet-stream";
    let dimensions: { width: number; height: number } | undefined;
    if (rasterTypes.has(contentType)) {
      try {
        const metadata = await new Bun.Image(
          await file.arrayBuffer(),
        ).metadata();
        dimensions = { width: metadata.width, height: metadata.height };
      } catch {
        throw new TrackerError("BAD_REQUEST", "Invalid image attachment");
      }
    }
    const stream = file.stream().pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > maxBytes)
            throw new TrackerError(
              "BAD_REQUEST",
              "Attachment exceeds the size limit",
            );
          hash.update(chunk);
          controller.enqueue(chunk);
        },
      }),
    );
    try {
      await this.store.put(storageKey, stream, contentType);
      return await this.unit.run(actor, requestId, async (context) => {
        const attachment = await context.db.attachment.create({
          data: {
            id,
            storageKey,
            filename: safeFilename(file.name),
            contentType,
            sizeBytes: bytes,
            sha256: hash.digest("hex"),
            uploaderId: context.actor.id,
            ...dimensions,
          },
        });
        await audit(context, {
          entityType: "attachment",
          entityId: id,
          action: "uploaded",
          after: attachment,
        });
        return {
          ...attachment,
          url: `/attachments/${id}/${encodeURIComponent(attachment.filename)}`,
        };
      });
    } catch (error) {
      await this.store.delete(storageKey);
      throw error;
    }
  }

  async download(id: string, filename: string): Promise<Response> {
    const attachment = await this.database.attachment.findUnique({
      where: { id },
    });
    if (attachment?.filename !== filename)
      return new Response("Not found", { status: 404 });
    return new Response(this.store.get(attachment.storageKey), {
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Length": String(attachment.sizeBytes),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": `${rasterTypes.has(attachment.contentType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      },
    });
  }

  /** Called by a Temporal activity. Committed objects survive issue deletion for audit history. */
  async cleanupStaged(
    cutoff: Date,
    actor: ActorEnvelope,
    requestId: string,
  ): Promise<number> {
    const expired = await this.database.attachment.findMany({
      where: { status: "staged", createdAt: { lt: cutoff } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    });
    let removed = 0;
    for (const item of expired) {
      await this.unit.run(actor, requestId, async (context) => {
        const { db } = context;
        await db.$queryRaw`SELECT "id" FROM "Attachment" WHERE "id" = ${item.id} FOR UPDATE`;
        const current = await db.attachment.findUnique({
          where: { id: item.id },
        });
        if (current?.status !== "staged") return;
        await this.store.delete(current.storageKey);
        await audit(context, {
          entityType: "attachment",
          entityId: current.id,
          action: "expired",
          before: current,
        });
        await db.attachment.delete({ where: { id: current.id } });
        removed++;
      });
    }
    return removed;
  }
}
