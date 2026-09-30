import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/**
 * Brim's Swift `Date` values encode as seconds since the Apple reference date
 * (2001-01-01), because `Date`'s `Codable` conformance uses
 * `timeIntervalSinceReferenceDate`. Add this offset to reach Unix time.
 */
export const COCOA_EPOCH_OFFSET_SECONDS = 978_307_200;

export function cocoaToMs(cocoaSeconds: number): number {
  return (cocoaSeconds + COCOA_EPOCH_OFFSET_SECONDS) * 1000;
}

const UsageWindowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.record(z.string(), z.unknown()),
  usedPercent: z.number().nullable().optional(),
  resetAt: z.number().nullable().optional(),
  sourceTimestamp: z.number(),
});

export type UsageWindow = z.infer<typeof UsageWindowSchema>;

const FreshnessSchema = z.record(z.string(), z.unknown()).optional();

export const UsageSnapshotSchema = z.object({
  provider: z.string().min(1),
  accountLabel: z.string().nullable().optional(),
  windows: z.array(UsageWindowSchema),
  resets: z.array(z.unknown()).optional(),
  resetErrorMessage: z.string().nullable().optional(),
  notes: z.array(z.string()).optional(),
  sourceTimestamp: z.number(),
  freshness: FreshnessSchema,
});

export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>;

export function defaultSnapshotsPath(home: string = os.homedir()): string {
  return path.join(home, "Library/Application Support/QuotaBar/snapshots.json");
}

/**
 * Load Brim's cached quota snapshots. The cache is the single source of
 * truth: a missing or corrupt file is an explicit error, never silently
 * treated as zero usage.
 */
export async function loadSnapshots(
  filePath: string,
): Promise<UsageSnapshot[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw new Error(
      `Brim snapshot cache not found at ${filePath}. Open Brim once to generate it, or pass --snapshots <path>.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(
      `Brim snapshot cache at ${filePath} is not valid JSON. Open Brim to regenerate it.`,
    );
  }
  const result = z.array(UsageSnapshotSchema).safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Brim snapshot cache at ${filePath} has an unexpected shape. Open Brim to regenerate it.`,
    );
  }
  return result.data;
}
