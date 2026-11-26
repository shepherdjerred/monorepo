import { S3Client } from "bun";
import type { Metrics } from "./metrics.ts";
import type { Bootstrap } from "./config.ts";

export const PART_SIZE = 8 * 1024 * 1024;
export const QUEUE_SIZE = 2;

/** Streams bytes into one object; `end` completes the upload. */
export type ObjectWriter = {
  write: (chunk: Uint8Array) => Promise<void>;
  end: () => Promise<void>;
};

/**
 * The object store port. `read` and `readRange` are for the content host
 * alone: the app host never streams object bytes (a test enforces it).
 */
export type ObjectStore = {
  read: (key: string) => ReadableStream<Uint8Array>;
  /** Bytes `start` through `end`, both inclusive. */
  readRange: (
    key: string,
    start: number,
    end: number,
  ) => ReadableStream<Uint8Array>;
  openWriter: (key: string) => ObjectWriter;
  delete: (key: string) => Promise<void>;
  exists: (key: string) => Promise<boolean>;
};

/**
 * Bun's S3 client. Bytes always leave through `stream()` or
 * `slice().stream()`: handing an `S3File` to `new Response` makes Bun answer
 * with a redirect to a presigned URL, which would leak the bucket.
 */
export function createObjectStore(config: Bootstrap): ObjectStore {
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  });
  return {
    read: (key) => client.file(key).stream(),
    readRange: (key, start, end) =>
      client
        .file(key)
        .slice(start, end + 1)
        .stream(),
    openWriter: (key) => {
      const file = client.file(key);
      // Created on the first chunk so an empty object is written plainly.
      let sink: ReturnType<typeof file.writer> | undefined;
      return {
        write: async (chunk) => {
          sink ??= file.writer({ partSize: PART_SIZE, queueSize: QUEUE_SIZE });
          await sink.write(chunk);
        },
        end: async () => {
          if (sink === undefined) await file.write("");
          else await sink.end();
        },
      };
    },
    delete: async (key) => {
      await client.file(key).delete();
    },
    exists: (key) => client.file(key).exists(),
  };
}

/** Counts failures by operation without changing behavior. */
export function meterObjectStore(
  store: ObjectStore,
  metrics: Metrics,
): ObjectStore {
  const counted = async <T>(op: string, work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      metrics.s3Error(op);
      throw error;
    }
  };
  return {
    read: store.read,
    readRange: store.readRange,
    openWriter: (key) => {
      const writer = store.openWriter(key);
      return {
        write: (chunk) => counted("write", () => writer.write(chunk)),
        end: () => counted("write", () => writer.end()),
      };
    },
    delete: (key) => counted("delete", () => store.delete(key)),
    exists: (key) => counted("head", () => store.exists(key)),
  };
}
