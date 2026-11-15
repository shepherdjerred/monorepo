import path from "node:path";
import { z } from "zod";
import type { SyncTool } from "./manifest.ts";

/**
 * `~/.toolkit/brim-sync/mirror/index.json` tells local readers which remote
 * machines have been pulled and where their read-only transcripts live.
 *
 * `toolkit history` reads it here; Brim sees mirrored usage only through the
 * history daemon. The checked-in JSON Schema at
 * `packages/toolkit/schemas/brim-sync-mirror-index.schema.json` documents it
 * language-neutrally; a TS test decodes the shared fixture and keeps this zod
 * schema identical to it.
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
    /**
     * Mirrored roots of the stores added after the first index version. An
     * index written before them omits these, meaning none were mirrored.
     */
    grokHomes: z.array(z.string().min(1)).optional(),
    kimiSessionsDirs: z.array(z.string().min(1)).optional(),
    museRoots: z.array(z.string().min(1)).optional(),
    antigravityRoots: z.array(z.string().min(1)).optional(),
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

export type MirrorRoots = Pick<
  MirrorMachine,
  | "claudeProjectsDirs"
  | "codexSessionsDirs"
  | "codexArchivedSessionsDirs"
  | "codexHistoryFiles"
> &
  Required<
    Pick<
      MirrorMachine,
      "grokHomes" | "kimiSessionsDirs" | "museRoots" | "antigravityRoots"
    >
  >;

/**
 * The reader roots inside one machine's mirror, from the archive paths it
 * holds. See `roots.ts` for the Grok, Kimi, Muse and Antigravity layout.
 */
export function mirrorRoots(
  rootDir: string,
  entries: readonly { tool: SyncTool; relPath: string }[],
): MirrorRoots {
  const roots = new Set(
    entries.map((entry) => `${entry.tool}/${archiveRootOf(entry.relPath)}`),
  );
  const under = (tool: string): string[] =>
    [...roots].filter((root) => root.startsWith(`${tool}/`)).toSorted();
  const absolute = (root: string): string =>
    path.join(rootDir, ...root.split("/"));
  const pick = (tool: string, leaf: string): string[] =>
    under(tool)
      .filter((root) => root.split("/").at(-1) === leaf)
      .map((root) => absolute(root));
  const toolDir = (tool: string): string[] =>
    under(tool).length === 0 ? [] : [path.join(rootDir, tool)];
  return {
    claudeProjectsDirs: pick("claude", "projects"),
    codexSessionsDirs: pick("codex", "sessions"),
    codexArchivedSessionsDirs: pick("codex", "archived_sessions"),
    codexHistoryFiles: pick("codex", "history.jsonl"),
    grokHomes: toolDir("grok"),
    kimiSessionsDirs: pick("kimi", "sessions"),
    museRoots: toolDir("muse"),
    antigravityRoots: under("antigravity").map((root) => absolute(root)),
  };
}
