import type { S3Client } from "@aws-sdk/client-s3";

/** Shared context for generating a single showcase entry's image. */
export type GenerateEntryContext = {
  bucket: string;
  client: S3Client;
  outputDir: string;
  publicBasePath: string;
};

/** A rendered showcase image plus the S3 keys it was derived from. */
export type GeneratedImage = {
  fileName: string;
  bytes: Uint8Array;
  sourceKeys: string[];
};

export function safeFileName(id: string, extension: "png" | "webp"): string {
  const normalized = id.replaceAll(/[^a-z0-9-]/g, "-");
  return `${normalized}.${extension}`;
}
