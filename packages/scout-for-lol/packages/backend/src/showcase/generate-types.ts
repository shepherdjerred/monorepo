import type { S3Client } from "@aws-sdk/client-s3";
import type { PlayerAnonymizer } from "./anonymize.ts";

/** Shared context for generating a single showcase entry's image. */
export type GenerateEntryContext = {
  bucket: string;
  client: S3Client;
  outputDir: string;
  publicBasePath: string;
  /**
   * Maps a stable player identity to a published pseudonym. Shared across every
   * entry in a run so one person reads consistently between charts. See
   * anonymize.ts.
   */
  anonymizePlayer: PlayerAnonymizer;
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
