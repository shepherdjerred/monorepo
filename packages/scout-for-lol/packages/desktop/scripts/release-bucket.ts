// Object discipline for the Scout Desktop release bucket, served publicly at
// https://download.scout-for-lol.com:
//
//   - release objects (`releases/<version>/...`) are immutable. Re-uploading
//     identical bytes is a no-op so an interrupted publication can be retried;
//     different bytes under an existing key are refused.
//   - the channel manifest (`<channel>.json`) changes only under an ETag
//     precondition, so two operators cannot silently overwrite each other.
//   - everything written is read back, from the bucket and from the public
//     host, before the publication counts.
import { createHash } from "node:crypto";
import {
  createSignedS3Request,
  type SignedS3RequestConfig,
} from "../../../../s3-signed-request/src/index.ts";

export const RELEASE_BUCKET = "scout-desktop";
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const MANIFEST_CACHE_CONTROL = "no-cache";

export type Fetcher = (request: Request) => Promise<Response>;

export type Bucket = {
  config: SignedS3RequestConfig;
  fetcher: Fetcher;
};

export type StoredObject = { body: Uint8Array; etag: string | null };

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const sameBytes = (a: Uint8Array, b: Uint8Array) => sha256(a) === sha256(b);

const timeout = () => AbortSignal.timeout(60_000);

/** The bucket object, or `null` when it does not exist. */
export async function readObject(
  bucket: Bucket,
  key: string,
): Promise<StoredObject | null> {
  const response = await bucket.fetcher(
    createSignedS3Request(bucket.config, {
      method: "GET",
      key,
      signal: timeout(),
    }),
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Could not inspect ${key}: HTTP ${String(response.status)}`,
    );
  }
  return {
    body: new Uint8Array(await response.arrayBuffer()),
    etag: response.headers.get("etag"),
  };
}

async function put(
  bucket: Bucket,
  object: {
    key: string;
    body: Uint8Array;
    contentType: string;
    cacheControl: string;
    precondition: { ifNoneMatch: true } | { ifMatch: string };
  },
): Promise<void> {
  const request = createSignedS3Request(bucket.config, {
    method: "PUT",
    key: object.key,
    body: object.body,
    contentType: object.contentType,
    signal: timeout(),
  });
  request.headers.set("Cache-Control", object.cacheControl);
  if ("ifMatch" in object.precondition) {
    request.headers.set("If-Match", object.precondition.ifMatch);
  } else {
    request.headers.set("If-None-Match", "*");
  }
  const response = await bucket.fetcher(request);
  if (response.status === 412) {
    throw new Error(
      `The bucket refused ${object.key}: it changed during publication; retry from its latest state`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not publish ${object.key}: HTTP ${String(response.status)}`,
    );
  }
  const stored = await readObject(bucket, object.key);
  if (stored === null || !sameBytes(stored.body, object.body)) {
    throw new Error(`Publication readback failed: ${object.key}`);
  }
}

/** Publish an immutable release object, or confirm identical bytes are there. */
export async function putImmutable(
  bucket: Bucket,
  object: { key: string; body: Uint8Array; contentType: string },
): Promise<"uploaded" | "already published"> {
  const existing = await readObject(bucket, object.key);
  if (existing !== null) {
    if (!sameBytes(existing.body, object.body)) {
      throw new Error(
        `Published release object already differs: ${object.key}. Bump the version.`,
      );
    }
    return "already published";
  }
  await put(bucket, {
    ...object,
    cacheControl: IMMUTABLE_CACHE_CONTROL,
    precondition: { ifNoneMatch: true },
  });
  return "uploaded";
}

/**
 * Replace a channel manifest. `expectedETag` is the ETag it was read with, or
 * `null` for a channel that has no manifest yet. The bucket enforces it.
 */
export async function putChannelManifest(
  bucket: Bucket,
  object: { key: string; body: Uint8Array; expectedETag: string | null },
): Promise<void> {
  const current = await readObject(bucket, object.key);
  if ((current?.etag ?? null) !== object.expectedETag) {
    throw new Error(
      "The update channel changed during publication; retry from its latest state",
    );
  }
  await put(bucket, {
    key: object.key,
    body: object.body,
    contentType: "application/json",
    cacheControl: MANIFEST_CACHE_CONTROL,
    precondition:
      object.expectedETag === null
        ? { ifNoneMatch: true }
        : { ifMatch: object.expectedETag },
  });
}

/** Fetch `url` from the public host and require exactly `body`. */
export async function publicReadback(
  url: string,
  body: Uint8Array,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const response = await fetcher(
    new Request(url, {
      redirect: "error",
      cache: "no-store",
      signal: timeout(),
    }),
  );
  if (
    response.status !== 200 ||
    !sameBytes(new Uint8Array(await response.arrayBuffer()), body)
  ) {
    throw new Error(`Public download verification failed: ${url}`);
  }
}
