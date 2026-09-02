import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { createSignedS3Request } from "@shepherdjerred/s3-signed-request";

export type ArchiveConfig = {
  bucket: string;
  prefix: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
  forcePathStyle: boolean;
};

export type ArchiveRef = {
  bucket: string;
  key: string;
  sha256: string;
  bytesCompressed: number;
  bytesUncompressed: number;
  status: "ok" | "failed";
  error: string | undefined;
};

export type BuildKeyParams = {
  service: string;
  provider: string;
  traceId: string;
  spanId: string;
  date?: Date;
};

export function buildArchiveKey(
  config: ArchiveConfig,
  params: BuildKeyParams,
): string {
  const date = params.date ?? new Date();
  const yyyy = date.getUTCFullYear().toString();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${config.prefix}/${params.service}/${params.provider}/${yyyy}/${mm}/${dd}/${params.traceId}-${params.spanId}.json.gz`;
}

/**
 * Bound on every archive S3 request. Uploads are multi-megabyte gzipped
 * bodies to an in-cluster SeaweedFS endpoint, so 30s is generous headroom
 * while still guaranteeing span export and Broadcast ingestion cannot hang
 * on a stalled connection.
 */
const S3_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Gzip the JSON payload and PUT it to S3. Returns a ref describing the upload.
 *
 * Never throws: a failed upload is reported via `status: "failed"` + `error`
 * on the ref. The archive is best-effort — the LLM call must not be impacted.
 */
export async function uploadArchive(
  config: ArchiveConfig,
  key: string,
  jsonPayload: string,
): Promise<ArchiveRef> {
  const utf8 = Buffer.from(jsonPayload, "utf8");
  const compressed = gzipSync(utf8);
  const bytesUncompressed = utf8.byteLength;
  const bytesCompressed = compressed.byteLength;
  const sha256 = sha256Hex(compressed);

  try {
    await putS3Object(config, key, compressed);
    return {
      bucket: config.bucket,
      key,
      sha256,
      bytesCompressed,
      bytesUncompressed,
      status: "ok",
      error: undefined,
    };
  } catch (error) {
    return {
      bucket: config.bucket,
      key,
      sha256,
      bytesCompressed,
      bytesUncompressed,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check whether an archive object already exists without downloading it.
 *
 * Unlike {@link uploadArchive}, this is an integrity/control-plane operation:
 * authentication and storage failures throw so callers cannot mistake an
 * unavailable archive for a missing object.
 */
export async function archiveObjectExists(
  config: ArchiveConfig,
  key: string,
): Promise<boolean> {
  const response = await signedS3Request(config, { key, method: "HEAD" });
  if (response.ok) return true;
  if (response.status === 404) return false;
  throw new Error(
    `S3 archive existence check failed (${String(response.status)}): ${response.statusText}`,
  );
}

/**
 * Download and decompress an archived object.
 *
 * Like {@link archiveObjectExists} this is a control-plane read, so a missing
 * object returns undefined while authentication and storage failures throw —
 * a caller must never mistake an unavailable archive for an absent one.
 */
export async function readArchiveObject(
  config: ArchiveConfig,
  key: string,
): Promise<string | undefined> {
  const response = await signedS3Request(config, { key, method: "GET" });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `S3 archive read failed (${String(response.status)}): ${response.statusText}`,
    );
  }
  return gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function putS3Object(
  config: ArchiveConfig,
  key: string,
  body: Buffer,
): Promise<void> {
  const response = await signedS3Request(config, { key, method: "PUT", body });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `S3 upload failed (${String(response.status)}): ${responseBody}`,
    );
  }
}

type ArchiveRequestInput =
  | { key: string; method: "GET" | "HEAD" }
  | { key: string; method: "PUT"; body: Buffer };

async function signedS3Request(
  config: ArchiveConfig,
  input: ArchiveRequestInput,
): Promise<Response> {
  // A hung S3 endpoint must not stall span export or Broadcast ingestion
  // indefinitely: the span processor awaits uploads before forwarding, and
  // ingest awaits receipt reads in its request handler. Upload callers treat
  // the abort as a failed (best-effort) upload; exists/read callers let it
  // propagate so "unavailable" is never read as "missing".
  const signal = AbortSignal.timeout(S3_REQUEST_TIMEOUT_MS);
  if (input.method === "PUT") {
    return fetch(
      createSignedS3Request(config, {
        method: input.method,
        key: input.key,
        body: new Uint8Array(input.body),
        contentType: "application/gzip",
        signal,
      }),
    );
  }
  return fetch(
    createSignedS3Request(config, {
      method: input.method,
      key: input.key,
      signal,
    }),
  );
}
