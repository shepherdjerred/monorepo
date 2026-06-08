import { createHash, createHmac } from "node:crypto";

/**
 * Minimal SigV4 S3 client for SeaweedFS. Path-style, no AWS SDK — ported from
 * `packages/temporal/src/shared/s3.ts` and adapted to take a binary body and
 * load credentials from the environment.
 */
export type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
};

const DEFAULT_ENDPOINT = "https://seaweedfs.sjer.red";
const DEFAULT_REGION = "us-east-1";

/**
 * Load SeaweedFS S3 credentials from the environment. Supply via 1Password,
 * e.g. `op run --env-file=...` mapping the `vet52jaeh75chsalu6lulugium` item's
 * `SEAWEEDFS_ACCESS_KEY_ID` / `SEAWEEDFS_SECRET_ACCESS_KEY` fields.
 */
export function loadS3Credentials(): S3Credentials {
  const accessKeyId = Bun.env["SEAWEEDFS_ACCESS_KEY_ID"];
  const secretAccessKey = Bun.env["SEAWEEDFS_SECRET_ACCESS_KEY"];
  if (accessKeyId == null || accessKeyId.length === 0) {
    throw new Error("SEAWEEDFS_ACCESS_KEY_ID environment variable is not set");
  }
  if (secretAccessKey == null || secretAccessKey.length === 0) {
    throw new Error(
      "SEAWEEDFS_SECRET_ACCESS_KEY environment variable is not set",
    );
  }
  const endpoint = Bun.env["SEAWEEDFS_S3_ENDPOINT"];
  const region = Bun.env["SEAWEEDFS_S3_REGION"];
  return {
    accessKeyId,
    secretAccessKey,
    endpoint:
      endpoint != null && endpoint.length > 0
        ? endpoint.replace(/\/$/, "")
        : DEFAULT_ENDPOINT,
    region: region != null && region.length > 0 ? region : DEFAULT_REGION,
  };
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

export type PutObjectParams = {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
};

/** Upload a single object via a SigV4-signed path-style PUT. */
export async function putObject(
  credentials: S3Credentials,
  params: PutObjectParams,
): Promise<void> {
  const endpointUrl = new URL(credentials.endpoint);
  const basePath = endpointUrl.pathname.replace(/\/$/, "");
  const encodedKey = params.key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = new URL(
    `${endpointUrl.origin}${basePath}/${params.bucket}/${encodedKey}`,
  );

  const payloadHash = sha256Hex(params.body);
  const amzDate = formatAmzDate(new Date());
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  const sortedHeaderEntries = Object.entries(headers).toSorted(
    ([left], [right]) => left.localeCompare(right),
  );
  const canonicalHeaders = sortedHeaderEntries
    .map(([key, value]) => `${key}:${value}\n`)
    .join("");
  const signedHeaders = sortedHeaderEntries.map(([key]) => key).join(";");
  const canonicalRequest = [
    "PUT",
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${credentials.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmacSha256(
    hmacSha256(
      hmacSha256(
        hmacSha256(`AWS4${credentials.secretAccessKey}`, dateStamp),
        credentials.region,
      ),
      "s3",
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...headers,
      Authorization: authorization,
      "Content-Type": params.contentType,
    },
    body: params.body,
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `S3 upload failed (${String(response.status)}): ${responseBody}`,
    );
  }
}
