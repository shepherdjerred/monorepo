import { GetObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import type { StoredPublicReplay } from "./catalog.ts";

const s3 = createS3Client();
const ChunkSchema = z.instanceof(Uint8Array);

export type ReplayByteRange = { readonly start: number; readonly end: number };

export class ReplayContentUnavailable extends Error {}

/** The private bucket is never exposed; only a completed row supplies its key. */
export async function openReplayContent(
  replay: StoredPublicReplay,
  range: ReplayByteRange | null,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  if (configuration.s3BucketName === undefined)
    throw new ReplayContentUnavailable("Replay storage is unavailable");
  const expectedBytes =
    range === null ? Number(replay.bytes) : range.end - range.start + 1;
  const result = await s3
    .send(
      new GetObjectCommand({
        Bucket: configuration.s3BucketName,
        Key: replay.objectKey,
        ...(range === null
          ? {}
          : {
              Range: `bytes=${range.start.toString()}-${range.end.toString()}`,
            }),
      }),
      { abortSignal: signal },
    )
    .catch((error: unknown) => {
      if (signal.aborted) throw error;
      const status =
        error instanceof S3ServiceException
          ? error.$metadata.httpStatusCode
          : undefined;
      const networkFailure = z
        .object({
          name: z.enum(["TimeoutError", "RequestTimeout", "NetworkingError"]),
        })
        .safeParse(error).success;
      if (
        status === 429 ||
        networkFailure ||
        (status !== undefined && status >= 500)
      )
        throw new ReplayContentUnavailable(
          "Replay storage is temporarily unavailable",
          {
            cause: error,
          },
        );
      // A missing object behind a COMPLETED row is an internal contract failure.
      throw error;
    });
  if (result.Body === undefined)
    throw new Error("Completed replay storage returned no body");
  const stream = result.Body.transformToWebStream();
  if (
    result.ContentLength !== expectedBytes ||
    result.Metadata?.["sha256"] !== replay.digest ||
    (range !== null &&
      result.ContentRange !==
        `bytes ${range.start.toString()}-${range.end.toString()}/${replay.bytes.toString()}`)
  ) {
    await stream.cancel();
    throw new Error(
      "Completed replay storage metadata does not match its artifact",
    );
  }
  return boundedReplayStream(
    stream,
    expectedBytes,
    signal,
    range === null ? replay.digest : undefined,
  );
}

/** Propagate consumer/request cancellation and reject truncated or oversized I/O. */
export function boundedReplayStream(
  stream: ReadableStream<unknown>,
  expectedBytes: number,
  signal: AbortSignal,
  expectedDigest?: string,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const hasher =
    expectedDigest === undefined ? null : new Bun.CryptoHasher("sha256");
  let received = 0;
  let finished = false;
  let abort: () => void;
  async function cancelAfterAbort(reason: unknown) {
    try {
      await reader.cancel(reason);
    } catch {
      // The response already carries the request's original cancellation reason.
    }
  }
  const cleanup = () => {
    finished = true;
    signal.removeEventListener("abort", abort);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        if (finished) return;
        cleanup();
        controller.error(signal.reason);
        void cancelAfterAbort(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const next = await reader.read();
        if (finished) return;
        if (next.done) {
          cleanup();
          if (received !== expectedBytes)
            throw new Error("Completed replay content was truncated");
          if (hasher !== null && hasher.digest("hex") !== expectedDigest)
            throw new Error(
              "Completed replay content SHA-256 does not match its artifact",
            );
          controller.close();
          return;
        }
        const chunk = ChunkSchema.parse(next.value);
        received += chunk.byteLength;
        hasher?.update(chunk);
        if (received > expectedBytes)
          throw new Error(
            "Completed replay content exceeded its recorded length",
          );
        controller.enqueue(chunk);
      } catch (error) {
        cleanup();
        controller.error(error);
        await reader.cancel(error);
      }
    },
    async cancel(reason) {
      cleanup();
      await reader.cancel(reason);
    },
  });
}
