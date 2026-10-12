import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const STAGING_TABLES = [
  "raw_documents",
  "matches",
  "match_teams",
  "match_team_bans",
  "prematch",
  "competition_rank_history",
  "timeline_events",
  "timeline_event_participants",
  "timeline_participant_frames",
  "timeline_coverage",
] as const;
export type ReportLakeStagingTable = (typeof STAGING_TABLES)[number];

const ProjectionKindSchema = z.enum([
  "match",
  "prematch",
  "timeline",
  "competition_rank_history",
]);
export type StagingProjectionKind = z.infer<typeof ProjectionKindSchema>;

const SourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("s3"),
      key: z.string().min(1),
      digest: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("local"), digest: z.string().min(1) }).strict(),
]);
export type StagingSource = z.infer<typeof SourceSchema>;

const PROJECTION_TABLES: Record<
  StagingProjectionKind,
  readonly ReportLakeStagingTable[]
> = {
  match: ["matches", "match_teams", "match_team_bans", "raw_documents"],
  prematch: ["prematch", "raw_documents"],
  timeline: [
    "timeline_events",
    "timeline_event_participants",
    "timeline_participant_frames",
    "timeline_coverage",
    "raw_documents",
  ],
  competition_rank_history: ["competition_rank_history"],
};

const ManifestSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    generationId: z.string().regex(/^\d{13}-[0-9a-f-]{36}$/),
    projectionKind: ProjectionKindSchema,
    naturalId: z.string().min(1),
    observedAt: z.iso.datetime(),
    source: SourceSchema,
    tables: z.array(z.enum(STAGING_TABLES)).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const expected = PROJECTION_TABLES[manifest.projectionKind].filter(
      (table) => manifest.version === 2 || table !== "raw_documents",
    );
    if (
      manifest.tables.length !== expected.length ||
      expected.some((table) => !manifest.tables.includes(table))
    ) {
      context.addIssue({
        code: "custom",
        message: `A ${manifest.projectionKind} generation must contain ${expected.join(", ")}`,
        path: ["tables"],
      });
    }
    if (new Set(manifest.tables).size !== manifest.tables.length) {
      context.addIssue({
        code: "custom",
        message: "A staging generation cannot repeat a table",
        path: ["tables"],
      });
    }
  });

export type StagingGeneration = z.infer<typeof ManifestSchema> & {
  dir: string;
};

export type StagingGenerationSnapshot = {
  /** Every committed generation present when the snapshot was taken. */
  captured: readonly StagingGeneration[];
  /** One whole projection per natural key, selected before any table is read. */
  selected: readonly StagingGeneration[];
};

const COMMITTED_DIR = "staging-generations";
const PENDING_DIR = ".staging-generations-pending";
const ABANDONED_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function committedRoot(lakeDir: string): string {
  return path.join(lakeDir, COMMITTED_DIR);
}

function pendingRoot(lakeDir: string): string {
  return path.join(lakeDir, PENDING_DIR);
}

export async function ensureStagingGenerationDirs(
  lakeDir: string,
): Promise<void> {
  await mkdir(committedRoot(lakeDir), { recursive: true });
  await mkdir(pendingRoot(lakeDir), { recursive: true });
}

/** Reclaim writes abandoned for a day without touching a recent writer. */
export async function reclaimAbandonedPendingGenerations(
  lakeDir: string,
  now = Date.now(),
): Promise<number> {
  let pending;
  try {
    pending = await readdir(pendingRoot(lakeDir), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of pending) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(pendingRoot(lakeDir), entry.name);
    try {
      const files = await readdir(dir);
      const timestamps = await Promise.all([
        stat(dir),
        ...files.map(async (file) => await stat(path.join(dir, file))),
      ]);
      if (
        timestamps.some((item) => now - item.mtimeMs < ABANDONED_PENDING_AGE_MS)
      ) {
        continue;
      }
      await rm(dir, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      // A writer may have committed the directory during the scan.
      if (!isMissing(error)) throw error;
    }
  }
  return removed;
}

export function projectionKey(
  kind: StagingProjectionKind,
  naturalId: string,
): string {
  return `${kind}\u{0}${naturalId}`;
}

export function generationFile(
  generation: StagingGeneration,
  table: ReportLakeStagingTable,
): string {
  if (!generation.tables.includes(table)) {
    throw new Error(
      `Generation ${generation.generationId} has no ${table} projection`,
    );
  }
  return path.join(generation.dir, `${table}.jsonl`);
}

/** A local projection has no canonical S3 object and cannot be retired by an S3 rebuild. */
export function localStagingSource(content: string): StagingSource {
  return {
    kind: "local",
    digest: createHash("sha256").update(content).digest("hex"),
  };
}

/**
 * Write every table while invisible, then publish the directory in one rename.
 * The committed tree is immutable: retries and simultaneous writers get their
 * own generation, and readers cannot observe a partly written projection.
 */
export async function commitStagingGeneration(args: {
  lakeDir: string;
  projectionKind: StagingProjectionKind;
  naturalId: string;
  observedAt: Date;
  source?: StagingSource;
  files: readonly { table: ReportLakeStagingTable; content: string }[];
}): Promise<StagingGeneration> {
  if (args.files.length === 0)
    throw new Error("A staging generation needs a table");
  await ensureStagingGenerationDirs(args.lakeDir);
  const generationId = `${Date.now().toString().padStart(13, "0")}-${randomUUID()}`;
  const pending = path.join(pendingRoot(args.lakeDir), generationId);
  const committed = path.join(committedRoot(args.lakeDir), generationId);
  const source =
    args.source ??
    localStagingSource(
      args.files
        .map(({ table, content }) => `${table}\u{0}${content}`)
        .join("\u{0}"),
    );
  const manifest = ManifestSchema.parse({
    version: 2,
    generationId,
    projectionKind: args.projectionKind,
    naturalId: args.naturalId,
    observedAt: args.observedAt.toISOString(),
    source,
    tables: args.files.map(({ table }) => table),
  });
  await mkdir(pending);
  try {
    await Promise.all(
      args.files.map(async ({ table, content }) => {
        await Bun.write(path.join(pending, `${table}.jsonl`), content);
      }),
    );
    await Bun.write(
      path.join(pending, "manifest.json"),
      JSON.stringify(manifest),
    );
    await rename(pending, committed);
  } catch (error) {
    await rm(pending, { recursive: true, force: true });
    throw error;
  }
  return { ...manifest, dir: committed };
}

async function committedGenerations(
  lakeDir: string,
): Promise<StagingGeneration[]> {
  let entries;
  try {
    entries = await readdir(committedRoot(lakeDir), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const generations = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = path.join(committedRoot(lakeDir), entry.name);
        let text: string;
        try {
          text = await readFile(path.join(dir, "manifest.json"), "utf8");
        } catch (error) {
          if (!isMissing(error)) throw error;
          try {
            await stat(dir);
          } catch (directoryError) {
            if (isMissing(directoryError)) return;
            throw directoryError;
          }
          // A committed directory without its manifest is corrupt.
          throw error;
        }
        const manifest = ManifestSchema.parse(JSON.parse(text));
        if (manifest.generationId !== entry.name) {
          throw new Error(
            `Staging generation manifest name mismatch at ${dir}`,
          );
        }
        return { ...manifest, dir };
      }),
  );
  return generations.flatMap((generation) =>
    generation === undefined ? [] : [generation],
  );
}

function generationOrder(
  left: StagingGeneration,
  right: StagingGeneration,
): number {
  return (
    left.observedAt.localeCompare(right.observedAt) ||
    left.generationId.localeCompare(right.generationId)
  );
}

export async function snapshotStagingGenerations(
  lakeDir: string,
): Promise<StagingGenerationSnapshot> {
  const captured = await committedGenerations(lakeDir);
  const latest = new Map<string, StagingGeneration>();
  for (const generation of captured) {
    const key = projectionKey(generation.projectionKind, generation.naturalId);
    const previous = latest.get(key);
    if (previous === undefined || generationOrder(previous, generation) < 0) {
      latest.set(key, generation);
    }
  }
  return {
    captured,
    selected: [...latest.values()].toSorted((left, right) =>
      projectionKey(left.projectionKind, left.naturalId).localeCompare(
        projectionKey(right.projectionKind, right.naturalId),
      ),
    ),
  };
}

/** Remove only directories captured before the fold, never a newer commit. */
export async function removeFoldedGenerations(
  snapshot: StagingGenerationSnapshot,
  foldedProjectionKeys: ReadonlySet<string>,
): Promise<number> {
  let removed = 0;
  for (const generation of snapshot.captured) {
    if (
      !foldedProjectionKeys.has(
        projectionKey(generation.projectionKind, generation.naturalId),
      )
    )
      continue;
    await rm(generation.dir, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** A rebuild retires exact sources and superseded siblings of a rebuilt winner. */
export async function removeRebuiltGenerations(
  snapshot: StagingGenerationSnapshot,
  rebuiltSources: ReadonlySet<string>,
): Promise<number> {
  const rebuiltProjectionKeys = new Set(
    snapshot.selected
      .filter(
        (generation) =>
          generation.source.kind === "s3" &&
          rebuiltSources.has(
            s3StagingSourceKey(generation.source.key, generation.source.digest),
          ),
      )
      .map((generation) =>
        projectionKey(generation.projectionKind, generation.naturalId),
      ),
  );
  let removed = 0;
  for (const generation of snapshot.captured) {
    if (
      !rebuiltProjectionKeys.has(
        projectionKey(generation.projectionKind, generation.naturalId),
      ) &&
      (generation.source.kind !== "s3" ||
        !rebuiltSources.has(
          s3StagingSourceKey(generation.source.key, generation.source.digest),
        ))
    )
      continue;
    await rm(generation.dir, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

export function s3StagingSourceKey(key: string, digest: string): string {
  return `${key}\u{0}${digest}`;
}
