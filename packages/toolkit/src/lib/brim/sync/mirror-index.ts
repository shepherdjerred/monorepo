import path from "node:path";
import { z } from "zod";

/**
 * `~/.toolkit/brim-sync/mirror/index.json` tells local readers which remote
 * machines have been pulled and where their read-only transcripts live.
 *
 * It is a cross-language contract: `toolkit history` reads it here and Brim
 * (Swift) decodes it in `MirrorIndex.swift`. The checked-in JSON Schema at
 * `packages/toolkit/schemas/brim-sync-mirror-index.schema.json` is the
 * language-neutral source of truth; tests in both languages decode the same
 * fixture, and a TS test keeps this zod schema identical to it.
 */

export const MIRROR_INDEX_SCHEMA_VERSION = 1;

export const MirrorMachineSchema = z
  .strictObject({
    machineId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    displayName: z.string().min(1),
    platform: z.string().min(1),
    /** The remote manifest's commit time. */
    manifestUpdatedAt: z.iso.datetime(),
    pulledAt: z.iso.datetime(),
    /** The pull window in days; `null` for a full mirror. */
    sinceDays: z.number().int().positive().nullable(),
    /** The machine's mirror root, laid out as `<tool>/<archive path>`. */
    rootDir: z.string().min(1),
    claudeProjectsDirs: z.array(z.string().min(1)),
    codexSessionsDirs: z.array(z.string().min(1)),
    codexArchivedSessionsDirs: z.array(z.string().min(1)),
    codexHistoryFiles: z.array(z.string().min(1)),
  })
  .meta({ title: "BrimSyncMirrorMachine" });
export type MirrorMachine = z.infer<typeof MirrorMachineSchema>;

export const MirrorIndexSchema = z
  .strictObject({
    schemaVersion: z.literal(MIRROR_INDEX_SCHEMA_VERSION),
    generatedAt: z.iso.datetime(),
    machines: z.array(MirrorMachineSchema),
  })
  .meta({ title: "BrimSyncMirrorIndex" });
export type MirrorIndex = z.infer<typeof MirrorIndexSchema>;

export async function readMirrorIndex(
  file: string,
): Promise<MirrorIndex | null> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) return null;
  const parsed = MirrorIndexSchema.safeParse(JSON.parse(await handle.text()));
  if (!parsed.success) {
    throw new Error(`${file} violates the mirror index schema`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** The archive root a relative path belongs to, e.g. `projects` or `1/sessions`. */
export function archiveRootOf(relPath: string): string {
  const segments = relPath.split("/");
  const numbered = /^\d+$/.test(segments[0] ?? "");
  return segments.slice(0, numbered ? 2 : 1).join("/");
}

export function mirrorRoots(
  rootDir: string,
  entries: readonly { tool: "claude" | "codex"; relPath: string }[],
): Pick<
  MirrorMachine,
  | "claudeProjectsDirs"
  | "codexSessionsDirs"
  | "codexArchivedSessionsDirs"
  | "codexHistoryFiles"
> {
  const roots = new Set(
    entries.map((entry) => `${entry.tool}/${archiveRootOf(entry.relPath)}`),
  );
  const pick = (tool: string, leaf: string): string[] =>
    [...roots]
      .filter(
        (root) =>
          root.startsWith(`${tool}/`) && root.split("/").at(-1) === leaf,
      )
      .toSorted()
      .map((root) => path.join(rootDir, ...root.split("/")));
  return {
    claudeProjectsDirs: pick("claude", "projects"),
    codexSessionsDirs: pick("codex", "sessions"),
    codexArchivedSessionsDirs: pick("codex", "archived_sessions"),
    codexHistoryFiles: pick("codex", "history.jsonl"),
  };
}
