import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  CompletionMarkerSchema,
  ManifestEntrySchema,
  type CompletionMarker,
  type ManifestEntry,
  type ObjectHeaders,
} from "./schemas.ts";
import type { ObjectStore } from "./store.ts";
import { readObjectBytes } from "./store.ts";

const JSON_HEADERS: ObjectHeaders = {
  contentType: "application/json",
  metadata: {},
};
const NDJSON_GZIP_HEADERS: ObjectHeaders = {
  contentType: "application/x-ndjson",
  contentEncoding: "gzip",
  metadata: {},
};

export function completionKey(snapshotId: string): string {
  return `snapshots/completed/${snapshotId}.json`;
}

export function manifestKey(snapshotId: string, bucket: string): string {
  const bucketDigest = createHash("sha256").update(bucket).digest("hex");
  return `snapshots/manifests/${snapshotId}/${bucketDigest}.ndjson.gz`;
}

export function encodeManifest(entries: readonly ManifestEntry[]): {
  compressed: Uint8Array;
  sha256: string;
} {
  const ndjson = entries
    .map((entry) => JSON.stringify(ManifestEntrySchema.parse(entry)))
    .join("\n");
  const uncompressed = new TextEncoder().encode(`${ndjson}\n`);
  return {
    compressed: gzipSync(uncompressed, { level: 9 }),
    sha256: createHash("sha256").update(uncompressed).digest("hex"),
  };
}

export function decodeManifest(compressed: Uint8Array): ManifestEntry[] {
  const text = new TextDecoder().decode(gunzipSync(compressed));
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => ManifestEntrySchema.parse(JSON.parse(line)));
}

export async function putManifest(
  store: ObjectStore,
  bucket: string,
  key: string,
  entries: readonly ManifestEntry[],
): Promise<string> {
  const encoded = encodeManifest(entries);
  await store.putObject({
    bucket,
    key,
    body: encoded.compressed,
    contentLength: encoded.compressed.byteLength,
    headers: NDJSON_GZIP_HEADERS,
  });
  return encoded.sha256;
}

export async function getManifest(
  store: ObjectStore,
  bucket: string,
  key: string,
  expectedSha256?: string,
): Promise<ManifestEntry[]> {
  const compressed = await readObjectBytes(await store.getObject(bucket, key));
  const uncompressed = gunzipSync(compressed);
  const sha256 = createHash("sha256").update(uncompressed).digest("hex");
  if (expectedSha256 !== undefined && sha256 !== expectedSha256) {
    throw new Error(`Manifest checksum mismatch for ${key}`);
  }
  return decodeManifest(compressed);
}

export async function putCompletionMarker(
  store: ObjectStore,
  bucket: string,
  marker: CompletionMarker,
): Promise<void> {
  const parsed = CompletionMarkerSchema.parse(marker);
  const encoded = new TextEncoder().encode(JSON.stringify(parsed));
  await store.putObject({
    bucket,
    key: completionKey(parsed.snapshotId),
    body: encoded,
    contentLength: encoded.byteLength,
    headers: JSON_HEADERS,
  });
}

export async function getCompletionMarker(
  store: ObjectStore,
  bucket: string,
  key: string,
): Promise<CompletionMarker> {
  const bytes = await readObjectBytes(await store.getObject(bucket, key));
  return CompletionMarkerSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
}

export async function listCompletionMarkers(
  store: ObjectStore,
  bucket: string,
): Promise<CompletionMarker[]> {
  const objects = await store.listObjects(bucket, "snapshots/completed/");
  const markers = await Promise.all(
    objects.map((object) => getCompletionMarker(store, bucket, object.key)),
  );
  return markers.toSorted((left, right) =>
    right.completedAt.localeCompare(left.completedAt),
  );
}
