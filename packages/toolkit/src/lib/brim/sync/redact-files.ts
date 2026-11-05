import { open, stat, utimes } from "node:fs/promises";
import {
  emptyManifestFileState,
  manifestJson,
  readLocalManifest,
  writePrivateFile,
  type ManifestFile,
  type RetiredGeneration,
} from "./manifest.ts";
import type { BrimSyncPaths } from "./paths.ts";
import {
  countByKind,
  findSecrets,
  replacementFor,
  type SecretKind,
  type SecretMatch,
} from "./redact.ts";
import { scanSourceFiles, type SourceFile, type SyncRoot } from "./scan.ts";

const NEWLINE = 0x0a;
const WINDOW_BYTES = 64 * 1024 * 1024;

export type RedactedFile = {
  readonly tool: string;
  readonly relPath: string;
  readonly counts: Partial<Record<SecretKind, number>>;
  /** Matches whose bytes changed before they could be overwritten. */
  readonly skipped: number;
};

export type RedactReport = {
  readonly scannedFiles: number;
  readonly files: readonly RedactedFile[];
  readonly totals: Partial<Record<SecretKind, number>>;
  /** Archive generations retired so the next push re-uploads them redacted. */
  readonly regenerated: number;
  /** Archived files that no longer exist locally, so could not be scanned. */
  readonly archivedOnly: number;
  readonly dryRun: boolean;
};

/**
 * Matches in one file, scanned in newline-aligned windows so a 300 MB rollout
 * never has to be held whole. Secrets never contain a newline, so none can
 * straddle a window.
 */
async function secretsIn(source: SourceFile): Promise<SecretMatch[]> {
  const matches: SecretMatch[] = [];
  let position = 0;
  while (position < source.size) {
    const end = Math.min(source.size, position + WINDOW_BYTES);
    const window = await Bun.file(source.absolutePath)
      .slice(position, end)
      .bytes();
    const cut =
      end === source.size ? window.length : window.lastIndexOf(NEWLINE) + 1;
    if (cut === 0) {
      throw new Error(
        `${source.relPath}: a line exceeds ${String(WINDOW_BYTES)} bytes at ${String(position)}`,
      );
    }
    for (const match of findSecrets(window.subarray(0, cut))) {
      matches.push({ ...match, offset: match.offset + position });
    }
    position += cut;
  }
  return matches;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * Overwrites each match in place, re-reading it first so bytes that changed
 * since the scan are left alone. Size and inode never change, so a CLI that
 * is still appending keeps working; the original mtime is restored.
 */
async function overwrite(
  source: SourceFile,
  matches: readonly SecretMatch[],
): Promise<number> {
  const before = await stat(source.absolutePath);
  const handle = await open(source.absolutePath, "r+");
  let skipped = 0;
  try {
    for (const match of matches) {
      const current = new Uint8Array(match.length);
      await handle.read(current, 0, match.length, match.offset);
      const [found] = findSecrets(current);
      if (
        found?.offset !== 0 ||
        found.length !== match.length ||
        found.kind !== match.kind
      ) {
        skipped += 1;
        continue;
      }
      const replacement = replacementFor(match);
      if (sameBytes(current, replacement)) continue;
      await handle.write(replacement, 0, replacement.length, match.offset);
    }
  } finally {
    await handle.close();
  }
  await utimes(source.absolutePath, before.atime, before.mtime);
  return skipped;
}

/** Retires an archived file's generation so the next push re-uploads it. */
function regenerate(entry: ManifestFile, retired: RetiredGeneration[]): void {
  retired.push({ fileKey: entry.fileKey, gen: entry.gen });
  Object.assign(entry, emptyManifestFileState(entry.gen + 1));
}

export type RedactOptions = {
  readonly roots: readonly SyncRoot[];
  readonly paths: BrimSyncPaths;
  readonly dryRun: boolean;
};

/**
 * Overwrites every standalone secret in this machine's Claude Code and Codex
 * transcripts and retires the archive generations that still hold them. The
 * next `brim sync push` re-uploads those files and deletes the old segments;
 * every mirror then rebuilds them on its next pull.
 */
export async function redactSources(
  options: RedactOptions,
): Promise<RedactReport> {
  const sources = await scanSourceFiles(options.roots);
  const files: RedactedFile[] = [];
  const all: SecretMatch[] = [];
  for (const source of sources) {
    const matches = await secretsIn(source);
    if (matches.length === 0) continue;
    all.push(...matches);
    const skipped = options.dryRun ? 0 : await overwrite(source, matches);
    files.push({
      tool: source.tool,
      relPath: source.relPath,
      counts: countByKind(matches),
      skipped,
    });
  }
  const manifest = await readLocalManifest(options.paths.manifest);
  let regenerated = 0;
  if (manifest !== null && !options.dryRun && files.length > 0) {
    const touched = new Set(
      files.map((file) => `${file.tool}:${file.relPath}`),
    );
    for (const entry of manifest.files) {
      if (!touched.has(`${entry.tool}:${entry.relPath}`) || entry.size === 0) {
        continue;
      }
      regenerate(entry, manifest.retired);
      regenerated += 1;
    }
    await writePrivateFile(options.paths.manifest, manifestJson(manifest));
  }
  return {
    scannedFiles: sources.length,
    files,
    totals: countByKind(all),
    regenerated,
    archivedOnly:
      manifest?.files.filter((entry) => entry.deletedAt !== null).length ?? 0,
    dryRun: options.dryRun,
  };
}
