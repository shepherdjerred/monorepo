import { chmod, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { sha256Hex } from "./crypto.ts";
import { SyncSetupError } from "./errors.ts";

/**
 * A machine's manifest is the commit point of its archive. Segments are
 * uploaded first and become visible only when a manifest naming them is
 * written, so a reader never sees a half-uploaded file. Each machine is the
 * only writer of its own prefix.
 */

export const SYNC_TOOLS = ["claude", "codex"] as const;
export const SyncToolSchema = z.enum(SYNC_TOOLS);
export type SyncTool = z.infer<typeof SyncToolSchema>;

export const MANIFEST_SCHEMA_VERSION = 1;
export const ARCHIVE_PREFIX = "v1/machines/";

const SegmentSchema = z.strictObject({
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ManifestSegment = z.infer<typeof SegmentSchema>;

const FileEntrySchema = z.strictObject({
  tool: SyncToolSchema,
  /** `/`-separated path under the tool's root, e.g. `sessions/2026/…`. */
  relPath: z.string().min(1),
  fileKey: z.string().regex(/^[0-9a-f]{32}$/),
  /** Bumped whenever the source was rewritten rather than appended to. */
  gen: z.number().int().nonnegative(),
  /** Bytes archived so far: the sum of the segment lengths. */
  size: z.number().int().nonnegative(),
  /** Source mtime when the last segment was cut. */
  mtimeMs: z.number().nonnegative(),
  /** sha256 of the last `min(4096, size)` archived bytes. */
  tailSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** When the source disappeared locally; the archive keeps it. */
  deletedAt: z.iso.datetime().nullable(),
  segments: z.array(SegmentSchema),
});
export type ManifestFile = z.infer<typeof FileEntrySchema>;

const RetiredSchema = z.strictObject({
  fileKey: z.string().regex(/^[0-9a-f]{32}$/),
  gen: z.number().int().nonnegative(),
});
export type RetiredGeneration = z.infer<typeof RetiredSchema>;

export const ManifestSchema = z.strictObject({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  machineId: z.string().min(1),
  displayName: z.string().min(1),
  platform: z.string().min(1),
  updatedAt: z.iso.datetime(),
  files: z.array(FileEntrySchema),
  /** Superseded generations whose segments still need deleting. */
  retired: z.array(RetiredSchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const MACHINE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function normalizeMachineId(hostname: string): string {
  const normalized = hostname
    .toLowerCase()
    .replace(/\.local$/, "")
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 63);
  if (!MACHINE_ID_PATTERN.test(normalized)) {
    throw new SyncSetupError(
      `Cannot derive a machine id from hostname "${hostname}"; set brim.sync.machine.id.`,
    );
  }
  return normalized;
}

export function fileKeyFor(tool: SyncTool, relPath: string): string {
  return sha256Hex(`${tool}:${relPath}`).slice(0, 32);
}

export function machinePrefix(machineId: string): string {
  return `${ARCHIVE_PREFIX}${machineId}/`;
}

export function manifestKey(machineId: string): string {
  return `${machinePrefix(machineId)}manifest.age`;
}

export function generationPrefix(
  machineId: string,
  fileKey: string,
  gen: number,
): string {
  return `${machinePrefix(machineId)}f/${fileKey}/${String(gen)}/`;
}

export function segmentKey(
  machineId: string,
  fileKey: string,
  gen: number,
  offset: number,
): string {
  return `${generationPrefix(machineId, fileKey, gen)}${String(offset).padStart(16, "0")}.zst.age`;
}

export function emptyManifest(input: {
  machineId: string;
  displayName: string;
  platform: string;
  now: Date;
}): Manifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    machineId: input.machineId,
    displayName: input.displayName,
    platform: input.platform,
    updatedAt: input.now.toISOString(),
    files: [],
    retired: [],
  };
}

export function parseManifest(raw: string, context: string): Manifest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`${context} is not valid JSON`, { cause: error });
  }
  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${context} violates the manifest schema`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export async function readLocalManifest(
  file: string,
): Promise<Manifest | null> {
  const handle = Bun.file(file);
  return (await handle.exists())
    ? parseManifest(await handle.text(), file)
    : null;
}

/** Writes a private file atomically (temp file + rename). */
export async function writePrivateFile(
  file: string,
  contents: string,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await Bun.write(temporary, contents);
  if (process.platform !== "win32") await chmod(temporary, 0o600);
  await rename(temporary, file);
}

export function manifestJson(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
