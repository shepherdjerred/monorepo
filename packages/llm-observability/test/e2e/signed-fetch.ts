import { createHash, createHmac } from "node:crypto";

export type SignedFetchParams = {
  url: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  body?: Uint8Array;
};

/**
 * Minimal AWS SigV4 fetch helper for tests — same algorithm as
 * `packages/temporal/src/shared/s3.ts` and `archive-uploader.ts`, but supports
 * GET (no body) in addition to PUT.
 */
export async function signedFetch(
  params: SignedFetchParams,
): Promise<Response> {
  const url = new URL(params.url);
  const service = params.service ?? "s3";
  const body = params.body ?? new Uint8Array();
  const payloadHash = sha256Hex(body);
  const amzDate = formatAmzDate(new Date());
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const sortedEntries = Object.entries(headers).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  const canonicalHeaders = sortedEntries
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");
  const signedHeaders = sortedEntries.map(([k]) => k).join(";");
  const canonicalRequest = [
    params.method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${params.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmacSha256(
    hmacSha256(
      hmacSha256(
        hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp),
        params.region,
      ),
      service,
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const init: RequestInit = {
    method: params.method,
    headers: { ...headers, Authorization: authorization },
  };
  if (params.body !== undefined) init.body = params.body;
  return fetch(url, init);
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
