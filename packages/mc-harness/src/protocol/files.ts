/**
 * Reading plugin data off a server: `toolkit mc files ls|get` and the rwf
 * recording/trace helpers. Paths are relative to the server's `/data` and
 * confined to an allowlist; the daemon re-checks the resolved path inside the
 * container so a symlink cannot escape it. Everything here is read-only.
 */
import { z } from "zod";

/** Every server image (itzg, the-storm-server) keeps its state here. */
export const DATA_ROOT = "/data";

/** rwf match recordings, `<dir>/yyyy/MM/dd/<matchId>.rwfrec.gz` (owned rwf.yml). */
export const RWF_RECORDINGS_DIR = "plugins/TheStorm/rwf-recordings";
export const RWF_RECORDING_SUFFIX = ".rwfrec.gz";
/** rwfbots decision traces, `<dir>/<matchId>.gz` (owned rwfbots.yml). */
export const RWF_TRACES_DIR = "plugins/TheStorm/rwfbots-traces";
export const RWF_TRACE_SUFFIX = ".gz";

/** A world, namespace or dimension folder name (never `.` or `..`). */
const NAME_SEGMENT = /^[\w-][\w.-]*$/u;

/** The readable roots, as shown in refusals and usage. */
export const READABLE_ROOTS =
  "plugins/TheStorm/**, logs/**, <world>/dimensions/<ns>/<dim>/region/**, <world>/region/**";

function isName(segment: string | undefined): boolean {
  return segment !== undefined && NAME_SEGMENT.test(segment);
}

/**
 * Region folders: `<world>/dimensions/<ns>/<dim>/region` (Minecraft 26.x)
 * and the legacy `<world>/region`, `<world>/DIM-1/region`, `<world>/DIM1/region`.
 */
function isRegionPath(parts: readonly string[]): boolean {
  const [world, second, third, fourth, fifth] = parts;
  if (!isName(world)) {
    return false;
  }
  const legacy =
    second === "region" ||
    ((second === "DIM-1" || second === "DIM1") && third === "region");
  const dimension =
    second === "dimensions" &&
    isName(third) &&
    isName(fourth) &&
    fifth === "region";
  return legacy || dimension;
}

/** True when `rel` (normalized, relative to /data) lies under a readable root. */
export function isAllowedDataPath(rel: string): boolean {
  const parts = rel.split("/");
  const [first, second] = parts;
  return (
    first === "logs" ||
    (first === "plugins" && second === "TheStorm") ||
    isRegionPath(parts)
  );
}

/**
 * Normalizes a user path (strips `./`, duplicate and trailing slashes) and
 * rejects anything absolute, parent-relative, or outside the allowlist.
 */
export function normalizeDataPath(raw: string): string {
  if (raw.includes("\0") || raw.includes("\\")) {
    throw new Error(`Invalid path ${JSON.stringify(raw)}`);
  }
  if (raw.startsWith("/")) {
    throw new Error(
      `Paths are relative to ${DATA_ROOT}; drop the leading slash: ${raw}`,
    );
  }
  const parts = raw.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) {
    throw new Error(`Paths may not contain "..": ${raw}`);
  }
  const rel = parts.join("/");
  if (rel === "" || !isAllowedDataPath(rel)) {
    throw new Error(
      `${raw === "" ? "(empty)" : raw} is outside the readable roots: ${READABLE_ROOTS}`,
    );
  }
  return rel;
}

/** A path relative to /data that passed the allowlist. */
export const DataPathSchema = z
  .string()
  .transform((raw, ctx) => {
    try {
      return normalizeDataPath(raw);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
      });
      return z.NEVER;
    }
  })
  .brand<"DataPath">();
export type DataPath = z.infer<typeof DataPathSchema>;

/** Absolute local paths only: the daemon and the CLI share a machine, not a cwd. */
const LocalPathSchema = z
  .string()
  .refine((value) => value.startsWith("/"), "must be an absolute local path");

export const FileEntrySchema = z.strictObject({
  name: z.string(),
  type: z.enum(["file", "dir", "link", "other"]),
  size: z.number().int().nonnegative(),
  /** Modification time, ISO 8601. */
  mtime: z.string(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

// GET /files/<target>/ls?path=<rel>
export const FilesListResponseSchema = z.strictObject({
  target: z.string(),
  path: z.string(),
  entries: z.array(FileEntrySchema),
});
export type FilesListResponse = z.infer<typeof FilesListResponseSchema>;

// POST /files/<target>/get
export const FilesGetRequestSchema = z.strictObject({
  path: z.string(),
  /** Where the daemon writes the file. */
  out: LocalPathSchema,
  force: z.boolean(),
  /** Decompress a `.gz` file while saving it. */
  gunzip: z.boolean(),
});
export type FilesGetRequest = z.infer<typeof FilesGetRequestSchema>;

export const FilesGetResponseSchema = z.strictObject({
  target: z.string(),
  /** The resolved source, relative to /data. */
  path: z.string(),
  out: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  gunzipped: z.boolean(),
});
export type FilesGetResponse = z.infer<typeof FilesGetResponseSchema>;

export const RwfKindSchema = z.enum(["recording", "trace"]);
export type RwfKind = z.infer<typeof RwfKindSchema>;
export const MatchIdSchema = z.uuid();

export const RwfArtifactSchema = z.strictObject({
  matchId: z.string(),
  kind: RwfKindSchema,
  /** Relative to /data. */
  path: z.string(),
  size: z.number().int().nonnegative(),
  mtime: z.string(),
});
export type RwfArtifact = z.infer<typeof RwfArtifactSchema>;

// GET /files/<target>/rwf
export const RwfListResponseSchema = z.strictObject({
  target: z.string(),
  artifacts: z.array(RwfArtifactSchema),
});
export type RwfListResponse = z.infer<typeof RwfListResponseSchema>;

// POST /files/<target>/rwf-get
export const RwfGetRequestSchema = z.strictObject({
  matchId: MatchIdSchema,
  kind: RwfKindSchema,
  /** Directory the file is written into, named after the match. */
  outDir: LocalPathSchema,
  force: z.boolean(),
  gunzip: z.boolean(),
});
export type RwfGetRequest = z.infer<typeof RwfGetRequestSchema>;
