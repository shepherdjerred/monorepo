import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { CreateUploadRequestSchema, Sha256Schema } from "#shared/contract.ts";
import { ArtifactsError } from "#application/errors.ts";
import type { Services } from "#application/services.ts";
import type { Caller } from "#application/types.ts";
import type { ObjectStore } from "#infrastructure/object-store.ts";
import { reportError } from "#infrastructure/log.ts";

const JSON_LIMIT = 1024 * 1024;

export type AppVariables = { caller: Caller; requestId: string };

type UploadsOptions = { services: Services; store: ObjectStore };

export type BlobOutcome = { status: "stored" } | { status: "exists" };

async function deleteQuietly(store: ObjectStore, key: string) {
  try {
    await store.delete(key);
  } catch (error) {
    reportError(error, "artifacts_orphan_object_cleanup_failed");
  }
}

export type BlobSink = {
  /** Named in failure logs; never a content token. */
  uploadId: string;
  store: ObjectStore;
  /** False when another upload recorded the same digest first. */
  recordBlob: (sha256: string, key: string, size: number) => Promise<boolean>;
  onBytes: (bytes: number) => void;
};

/**
 * Streams one blob into the object store, counting bytes and hashing as they
 * pass. A digest or size mismatch deletes the object and fails with 422. So
 * does any other failure; and losing the race to record the same digest
 * deletes this upload's object quietly: the winner's stays.
 */
export async function receiveBlob(
  sink: BlobSink,
  body: ReadableStream<Uint8Array> | null,
  sha256: string,
  declaredSize: number,
): Promise<BlobOutcome> {
  const key = `objects/${crypto.randomUUID()}`;
  const writer = sink.store.openWriter(key);
  const hasher = new Bun.CryptoHasher("sha256");
  let received = 0;
  try {
    if (body !== null)
      for await (const chunk of body) {
        received += chunk.byteLength;
        if (received > declaredSize) break;
        hasher.update(chunk);
        await writer.write(chunk);
      }
    await writer.end();
    if (received !== declaredSize || hasher.digest("hex") !== sha256)
      throw new ArtifactsError(
        "UNPROCESSABLE_CONTENT",
        "The body does not match the declared size and sha256",
      );
    sink.onBytes(received);
    if (await sink.recordBlob(sha256, key, received))
      return { status: "stored" };
    await sink.store.delete(key);
    return { status: "exists" };
  } catch (error) {
    // The object may be partial or lost the race; either way it is ours to remove.
    reportError(error, "artifacts_blob_upload_failed", {
      uploadId: sink.uploadId,
      sha256,
      received,
      declaredSize,
    });
    await deleteQuietly(sink.store, key);
    throw error;
  }
}

/** `POST /api/uploads`, `PUT /api/uploads/:id/blobs/:sha256`, `POST /api/uploads/:id/commit`. */
export function registerUploadRoutes(
  app: Hono<{ Variables: AppVariables }>,
  options: UploadsOptions,
) {
  const { services } = options;
  app.post("/api/uploads", bodyLimit({ maxSize: JSON_LIMIT }), async (c) => {
    const request = CreateUploadRequestSchema.parse(await c.req.json());
    return c.json(
      await services.uploads.create(
        request,
        c.get("caller"),
        c.get("requestId"),
      ),
    );
  });

  app.put("/api/uploads/:id/blobs/:sha256", async (c) => {
    const sha256 = Sha256Schema.safeParse(c.req.param("sha256"));
    if (!sha256.success)
      throw new ArtifactsError(
        "BAD_REQUEST",
        "sha256 must be 64 lowercase hex characters",
      );
    const { size } = await services.uploads.sessionForBlob(
      c.req.param("id"),
      sha256.data,
    );
    if (await services.uploads.blobExists(sha256.data))
      return c.json({ status: "exists" });
    const length = c.req.header("Content-Length");
    if (length !== undefined && Number(length) !== size)
      throw new ArtifactsError(
        "UNPROCESSABLE_CONTENT",
        "Content-Length does not match the manifest",
      );
    return c.json(
      await receiveBlob(
        {
          uploadId: c.req.param("id"),
          store: options.store,
          recordBlob: (digest, key, bytes) =>
            services.uploads.recordBlob(digest, key, bytes),
          onBytes: (bytes) => {
            services.deps.metrics.uploadBytes(bytes);
          },
        },
        c.req.raw.body,
        sha256.data,
        size,
      ),
    );
  });

  app.post(
    "/api/uploads/:id/commit",
    bodyLimit({ maxSize: JSON_LIMIT }),
    async (c) =>
      c.json(
        await services.uploads.commit(
          c.req.param("id"),
          c.get("caller"),
          c.get("requestId"),
        ),
      ),
  );
}
