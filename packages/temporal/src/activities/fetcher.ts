import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore/lite";
import { createHash, createHmac } from "node:crypto";
import { z } from "zod/v4";

type S3UploadConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  forcePathStyle: boolean;
};

export type ManifestUploadResult = {
  bucket: string;
  key: string;
  sizeBytes: number;
  uploadedAt: string;
};

// Firebase config for Skill Capped
const FIREBASE_CONFIG = {
  // eslint-disable-next-line no-secrets/no-secrets -- public Firebase web API key, client-side safe
  apiKey: "AIzaSyAgHWuN2OEx5R827dHlKO9HsOuBwZ017n0",
  authDomain: "sc-site-a8f24.firebaseapp.com",
  databaseURL: "https://sc-site-a8f24.firebaseio.com",
  projectId: "sc-site-a8f24",
  storageBucket: "sc-site-a8f24.appspot.com",
  messagingSenderId: "385410121336",
};

let firebaseApp: FirebaseApp | undefined;

function getFirebaseApp(): FirebaseApp {
  firebaseApp ??= initializeApp(FIREBASE_CONFIG);
  return firebaseApp;
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

function buildS3Url(config: S3UploadConfig): URL {
  const endpointUrl = new URL(config.endpoint);
  const basePath = endpointUrl.pathname.replace(/\/$/, "");
  const encodedKey = config.key
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

function loadS3Config(): S3UploadConfig | undefined {
  const bucket = Bun.env["S3_BUCKET_NAME"];
  if (bucket === undefined || bucket === "") {
    return undefined;
  }

  const accessKeyId = Bun.env["AWS_ACCESS_KEY_ID"];
  const secretAccessKey = Bun.env["AWS_SECRET_ACCESS_KEY"];
  const endpoint = Bun.env["S3_ENDPOINT"];

  if (
    accessKeyId === undefined ||
    accessKeyId === "" ||
    secretAccessKey === undefined ||
    secretAccessKey === "" ||
    endpoint === undefined ||
    endpoint === ""
  ) {
    throw new Error("Missing S3 credentials or endpoint for upload");
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: Bun.env["AWS_SESSION_TOKEN"],
    endpoint,
    bucket,
    key: Bun.env["S3_KEY"] ?? "data/manifest.json",
    region: Bun.env["S3_REGION"] ?? "us-east-1",
    forcePathStyle: (Bun.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
  };
}

async function putObject(config: S3UploadConfig, body: string): Promise<void> {
  const url = buildS3Url(config);
  const payloadHash = sha256Hex(body);
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
    throw new Error(
      `S3 upload failed (${String(response.status)}): ${responseBody}`,
    );
  }
}

export type FetcherActivities = typeof fetcherActivities;

export const fetcherActivities = {
  async getFirestoreManifestUrl(): Promise<string> {
    const app = getFirebaseApp();
    const db = getFirestore(app);
    const docRef = doc(db, "content-location/lol-content-location");
    const docSnap = await getDoc(docRef);
    const FirestoreDoc = z.object({ dumpUrl: z.string() });
    const data = FirestoreDoc.parse(docSnap.data());
    console.warn(`Found manifest URL: ${data.dumpUrl}`);
    return data.dumpUrl;
  },

  // Fetches the manifest and uploads it to S3 in a single activity so the
  // multi-MB JSON body never crosses the activity↔worker boundary (Temporal
  // caps activity result payloads at 2 MiB).
  async fetchAndUploadManifest(url: string): Promise<ManifestUploadResult> {
    const config = loadS3Config();
    if (config === undefined) {
      throw new Error(
        "S3_BUCKET_NAME is not set; refusing to fetch manifest without an upload destination",
      );
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch manifest: ${String(response.status)} ${response.statusText}`,
      );
    }
    const json: unknown = await response.json();
    const body = JSON.stringify(json);
    const sizeBytes = Buffer.byteLength(body, "utf8");

    await putObject(config, body);

    const uploadedAt = new Date().toISOString();
    console.warn(
      `Manifest uploaded to s3://${config.bucket}/${config.key} (${String(sizeBytes)} bytes)`,
    );
    return { bucket: config.bucket, key: config.key, sizeBytes, uploadedAt };
  },
};
