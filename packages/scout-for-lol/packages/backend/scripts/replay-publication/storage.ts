import { open } from "node:fs/promises";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { ReplayPublicationObject } from "./package.ts";

const CACHE_CONTROL = "public, max-age=31536000, immutable";
const DEADLINE_MS = 120_000;

function publicObjectUrl(origin: URL, key: string): URL {
  const local = origin.hostname === "127.0.0.1" || origin.hostname === "[::1]";
  if (
    (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) ||
    origin.href !== `${origin.origin}/` ||
    !/^[\w./-]+$/.test(key) ||
    key.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error("Invalid replay publication origin or object key");
  return new URL(`/${key}`, origin);
}

async function verifyBytes(
  chunks: AsyncIterable<unknown>,
  object: Pick<ReplayPublicationObject, "bytes" | "sha256">,
  source: string,
): Promise<void> {
  const sha256 = new Bun.CryptoHasher("sha256");
  let length = 0;
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array))
      throw new TypeError("Expected replay object bytes");
    length += chunk.byteLength;
    if (length > object.bytes)
      throw new Error(`${source} exceeds its expected length`);
    sha256.update(chunk);
  }
  if (length !== object.bytes || sha256.digest("hex") !== object.sha256)
    throw new Error(
      `${source} length or SHA-256 does not match the publication inventory`,
    );
}

function permitsReadback(error: unknown): boolean {
  if (!(error instanceof S3ServiceException)) return true;
  const status = error.$metadata.httpStatusCode;
  return (
    status === undefined || status === 409 || status === 412 || status >= 500
  );
}

export async function openPublicReplayObject(
  origin: URL,
  key: string,
  contentType: string,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(publicObjectUrl(origin, key), {
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(DEADLINE_MS),
  });
  if (response.status !== 200 || response.body === null) {
    await response.body?.cancel();
    throw new Error(
      `Public replay object returned HTTP ${String(response.status)}`,
    );
  }
  const cache = new Set(
    response.headers
      .get("Cache-Control")
      ?.split(",")
      .map((part) => part.trim().toLowerCase()),
  );
  const mime = response.headers
    .get("Content-Type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  const expected = contentType.split(";")[0]?.trim().toLowerCase();
  const mimeMatches =
    expected === "text/javascript" || expected === "application/javascript"
      ? mime === "text/javascript" || mime === "application/javascript"
      : mime === expected;
  if (
    !mimeMatches ||
    !cache.has("public") ||
    !cache.has("immutable") ||
    !cache.has("max-age=31536000") ||
    [...cache].some(
      (directive) =>
        directive.startsWith("max-age=") && directive !== "max-age=31536000",
    ) ||
    cache.has("private") ||
    cache.has("no-cache") ||
    cache.has("no-store")
  ) {
    await response.body.cancel();
    throw new Error(
      "Public replay object has invalid immutable cache or MIME headers",
    );
  }
  return response.body;
}

export async function verifyPublicReplayObject(
  origin: URL,
  object: Pick<
    ReplayPublicationObject,
    "key" | "bytes" | "sha256" | "contentType"
  >,
): Promise<void> {
  const body = await openPublicReplayObject(
    origin,
    object.key,
    object.contentType,
  );
  await verifyBytes(body, object, "Public replay object");
}

export async function publishReplayObject({
  client,
  bucket,
  origin,
  object,
}: {
  client: Pick<S3Client, "send">;
  bucket: string;
  origin: URL;
  object: ReplayPublicationObject;
}): Promise<void> {
  publicObjectUrl(origin, object.key);
  const file = await open(object.path, "r");
  try {
    await verifyBytes(
      file.createReadStream({ start: 0, autoClose: false }),
      object,
      "Local replay object",
    );
    const body = file.createReadStream({
      start: 0,
      end: object.bytes - 1,
      autoClose: false,
    });
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: object.key,
          Body: body,
          ContentLength: object.bytes,
          ContentType: object.contentType,
          CacheControl: CACHE_CONTROL,
          IfNoneMatch: "*",
          Metadata: { sha256: object.sha256 },
        }),
        { abortSignal: AbortSignal.timeout(DEADLINE_MS) },
      );
    } catch (error) {
      if (!permitsReadback(error)) throw error;
    } finally {
      body.destroy();
    }
  } finally {
    await file.close();
  }

  const stored = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: object.key }),
    {
      abortSignal: AbortSignal.timeout(DEADLINE_MS),
    },
  );
  const body = stored.Body?.transformToWebStream();
  if (
    body === undefined ||
    stored.$metadata.httpStatusCode !== 200 ||
    stored.ContentLength !== object.bytes
  ) {
    await body?.cancel();
    throw new Error(
      "Replay object storage readback has an invalid status or length",
    );
  }
  await verifyBytes(body, object, "Stored replay object");
  await verifyPublicReplayObject(origin, object);
}
