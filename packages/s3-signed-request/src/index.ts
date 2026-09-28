import { createHash, createHmac } from "node:crypto";

export type SignedS3RequestConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
  endpoint: string;
  bucket: string;
  region: string;
  forcePathStyle: boolean;
};

type ReadRequestInput = {
  method: "GET" | "HEAD";
  key: string;
  signingTime?: Date;
  signal?: AbortSignal;
};

type PutRequestInput = {
  method: "PUT";
  key: string;
  body: string | Uint8Array;
  contentType: string;
  signingTime?: Date;
  signal?: AbortSignal;
};

export type SignedS3RequestInput = ReadRequestInput | PutRequestInput;

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key: Uint8Array | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function buildS3Url(config: SignedS3RequestConfig, key: string): URL {
  const endpoint = new URL(config.endpoint);
  const basePath = endpoint.pathname.replace(/\/$/, "");
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  if (config.forcePathStyle) {
    return new URL(
      `${endpoint.origin}${basePath}/${config.bucket}/${encodedKey}`,
    );
  }
  const url = new URL(`${endpoint.origin}${basePath}/${encodedKey}`);
  url.hostname = `${config.bucket}.${endpoint.hostname}`;
  return url;
}

export function createSignedS3Request(
  config: SignedS3RequestConfig,
  input: SignedS3RequestInput,
): Request {
  const url = buildS3Url(config, input.key);
  const body = input.method === "PUT" ? input.body : undefined;
  const requestBody =
    body === undefined
      ? undefined
      : typeof body === "string"
        ? body
        : new Uint8Array(body);
  const payloadHash = sha256Hex(body ?? "");
  const amzDate = (input.signingTime ?? new Date())
    .toISOString()
    .replaceAll(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaderValues: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (config.sessionToken !== undefined && config.sessionToken !== "") {
    signedHeaderValues["x-amz-security-token"] = config.sessionToken;
  }
  const headerEntries = Object.entries(signedHeaderValues).toSorted(
    ([left], [right]) => left.localeCompare(right),
  );
  const canonicalHeaders = headerEntries
    .map(([key, value]) => `${key}:${value}\n`)
    .join("");
  const signedHeaders = headerEntries.map(([key]) => key).join(";");
  const canonicalRequest = [
    input.method,
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
  return new Request(url.toString(), {
    method: input.method,
    headers: {
      ...signedHeaderValues,
      Authorization: authorization,
      ...(input.method === "PUT" ? { "Content-Type": input.contentType } : {}),
    },
    ...(requestBody === undefined ? {} : { body: requestBody }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}
