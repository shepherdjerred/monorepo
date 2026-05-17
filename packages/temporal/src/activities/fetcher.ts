import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore/lite";
import { z } from "zod/v4";
import { putS3Object } from "#shared/s3.ts";

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

    await putS3Object({ ...config, contentType: "application/json" }, body);

    const uploadedAt = new Date().toISOString();
    console.warn(
      `Manifest uploaded to s3://${config.bucket}/${config.key} (${String(sizeBytes)} bytes)`,
    );
    return { bucket: config.bucket, key: config.key, sizeBytes, uploadedAt };
  },
};
