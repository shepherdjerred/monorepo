import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: Bun.env["SENTRY_DSN"] ?? "https://34fcb766ca0f49499b001635c5cc5cb2@bugsink.sjer.red/3",
  environment: Bun.env.NODE_ENV ?? "production",
});

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore/lite";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, createHmac } from "node:crypto";

interface S3UploadConfig {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  forcePathStyle: boolean;
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key: Uint8Array | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function toDateStamp(amzDate: string): string {
  return amzDate.slice(0, 8);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function buildS3Url(config: S3UploadConfig): URL {
  const endpointUrl = new URL(config.endpoint);
  const basePath = endpointUrl.pathname.replace(/\/$/, "");
  const encodedKey = config.key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  if (config.forcePathStyle) {
    return new URL(`${endpointUrl.origin}${basePath}/${config.bucket}/${encodedKey}`);
  }

  const url = new URL(`${endpointUrl.origin}${basePath}/${encodedKey}`);
  url.hostname = `${config.bucket}.${endpointUrl.hostname}`;
  return url;
}

async function uploadToS3(config: S3UploadConfig, body: string): Promise<void> {
  const url = buildS3Url(config);
  const payloadHash = sha256Hex(body);
  const amzDate = formatAmzDate(new Date());
  const dateStamp = toDateStamp(amzDate);

  const canonicalUri = url.pathname;
  const canonicalQuery = url.searchParams.toString();
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  if (config.sessionToken) {
    headers["x-amz-security-token"] = config.sessionToken;
  }

  const sortedHeaderEntries = Object.entries(headers).sort(([left], [right]) => left.localeCompare(right));
  const canonicalHeaders = sortedHeaderEntries.map(([key, value]) => `${key}:${value}\n`).join("");
  const signedHeaders = sortedHeaderEntries.map(([key]) => key).join(";");
  const canonicalRequest = ["PUT", canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join(
    "\n",
  );

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmacSha256(
    hmacSha256(hmacSha256(hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...headers,
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`S3 upload failed (${String(response.status)}): ${responseBody}`);
  }
}

async function main() {
  const outputPath = Bun.env["OUTPUT_PATH"] ?? "/data/manifest.json";
  const s3Bucket = Bun.env["S3_BUCKET_NAME"];

  const firebaseConfig = {
    apiKey: "AIzaSyAgHWuN2OEx5R827dHlKO9HsOuBwZ017n0",
    authDomain: "sc-site-a8f24.firebaseapp.com",
    databaseURL: "https://sc-site-a8f24.firebaseio.com",
    projectId: "sc-site-a8f24",
    storageBucket: "sc-site-a8f24.appspot.com",
    messagingSenderId: "385410121336",
  };

  const app = initializeApp(firebaseConfig);

  const db = getFirestore(app);
  const docRef = doc(db, "content-location/lol-content-location");
  const docSnap = await getDoc(docRef);
  const data = docSnap.data() as { dumpUrl: string } | undefined;
  const url = data?.dumpUrl;
  if (!url) {
    throw new Error("dumpUrl not found in Firestore document");
  }

  console.log(`Found manifest URL: ${url}`);
  const jsonResponse = await fetch(url);
  const jsonContent = await jsonResponse.json();
  const jsonString = JSON.stringify(jsonContent);

  // Ensure directory exists
  mkdirSync(dirname(outputPath), { recursive: true });

  // Write to filesystem
  writeFileSync(outputPath, jsonString);
  console.log(`Manifest saved to ${outputPath}`);

  if (s3Bucket) {
    const accessKeyId = Bun.env["AWS_ACCESS_KEY_ID"];
    const secretAccessKey = Bun.env["AWS_SECRET_ACCESS_KEY"];
    const endpoint = Bun.env["S3_ENDPOINT"];
    const region = Bun.env["S3_REGION"] ?? Bun.env["AWS_REGION"] ?? "us-east-1";

    if (!accessKeyId || !secretAccessKey || !endpoint) {
      throw new Error("Missing S3 credentials or endpoint for upload");
    }

    const key = Bun.env["S3_KEY"] ?? "data/manifest.json";
    const forcePathStyle = parseBool(Bun.env["S3_FORCE_PATH_STYLE"], true);

    console.log(`Uploading manifest to s3://${s3Bucket}/${key}`);
    await uploadToS3(
      {
        accessKeyId,
        secretAccessKey,
        sessionToken: Bun.env["AWS_SESSION_TOKEN"],
        endpoint,
        bucket: s3Bucket,
        key,
        region,
        forcePathStyle,
      },
      jsonString,
    );
    console.log("Manifest uploaded to S3");
  } else {
    console.log("Skipping S3 upload: S3_BUCKET_NAME not set");
  }
}

main().catch((error: unknown) => {
  console.error("Failed to fetch manifest:", error);
  Sentry.captureException(error);
  process.exit(1);
});
