import { createHash, createHmac } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

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
  const response = await signedS3Request(config, key, "HEAD");
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
  const response = await signedS3Request(config, key, "GET");
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

function hmacSha256(key: Uint8Array | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replaceAll(/[:-]|\.\d{3}/g, "");
}

function buildS3Url(config: ArchiveConfig, key: string): URL {
  const endpointUrl = new URL(config.endpoint);
  const basePath = endpointUrl.pathname.replace(/\/$/, "");
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  if (config.forcePathStyle) {
    return new URL(
      `${endpointUrl.origin}${basePath}/${config.bucket}/${encodedKey}`,
    );
  }

  const url = new URL(`${endpointUrl.origin}${basePath}/${encodedKey}`);
  url.hostname = `${config.bucket}.${endpointUrl.hostname}`;
  return url;
}

async function putS3Object(
  config: ArchiveConfig,
  key: string,
  body: Buffer,
): Promise<void> {
  const response = await signedS3Request(config, key, "PUT", body);

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `S3 upload failed (${String(response.status)}): ${responseBody}`,
    );
  }
}

async function signedS3Request(
  config: ArchiveConfig,
  key: string,
  method: "GET" | "HEAD" | "PUT",
  body?: Buffer,
): Promise<Response> {
  const url = buildS3Url(config, key);
  const payloadHash = sha256Hex(body ?? "");
  const amzDate = formatAmzDate(new Date());
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  if (config.sessionToken !== undefined && config.sessionToken !== "") {
    headers["x-amz-security-token"] = config.sessionToken;
  }

  const sortedHeaderEntries = Object.entries(headers).toSorted(
    ([left], [right]) => left.localeCompare(right),
  );
  const canonicalHeaders = sortedHeaderEntries
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");
  const signedHeaders = sortedHeaderEntries.map(([k]) => k).join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmacSha256(
    hmacSha256(
      hmacSha256(
        hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp),
        config.region,
      ),
      "s3",
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(url, {
    method,
    headers: {
      ...headers,
      Authorization: authorization,
      ...(body === undefined ? {} : { "Content-Type": "application/gzip" }),
    },
    ...(body === undefined ? {} : { body: new Uint8Array(body) }),
  });
  return response;
}
