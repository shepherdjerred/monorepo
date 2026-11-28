import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import {
  ArtifactKindSchema,
  InvalidArtifactPathError,
  LIMIT_DEFAULTS,
  normalizeArtifactPath,
  type ArtifactKind,
} from "@shepherdjerred/artifacts/contract";
import { contentTypeForFile } from "#lib/s3/assets.ts";
import { usageError } from "./errors.ts";

export type Limits = {
  maxFileBytes: number;
  maxVersionBytes: number;
  maxFiles: number;
};

export const DEFAULT_LIMITS: Limits = {
  maxFileBytes: LIMIT_DEFAULTS.maxFileBytes,
  maxVersionBytes: LIMIT_DEFAULTS.maxVersionBytes,
  maxFiles: LIMIT_DEFAULTS.maxFiles,
};

export type ManifestFile = {
  /** Normalized path inside the artifact. */
  path: string;
  /** Where to read the bytes from when uploading. */
  absolutePath: string;
  size: number;
  sha256: string;
  mediaType: string;
};

/** One artifact ready to publish: a file or a directory site. */
export type ArtifactSource = {
  input: string;
  kind: ArtifactKind;
  entryPath: string;
  defaultTitle: string;
  files: ManifestFile[];
  totalBytes: number;
  /** Stable over the same entry and content; feeds the idempotency key. */
  digest: string;
};

/** Types the shared upload map lacks or labels for download. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".mmd": "text/plain; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".json": "application/json",
};

export function mediaTypeFor(filename: string): string {
  return (
    MEDIA_TYPES[path.extname(filename).toLowerCase()] ??
    contentTypeForFile(filename)
  );
}

const KIND_BY_EXTENSION: Readonly<Record<string, ArtifactKind>> = {
  ".html": "html",
  ".htm": "html",
  ".pdf": "pdf",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".avif": "image",
  ".mp4": "video",
  ".webm": "video",
  ".mov": "video",
  ".md": "markdown",
  ".markdown": "markdown",
  ".cast": "cast",
  ".mmd": "mermaid",
};

/** The viewer a single file gets, from its extension. */
export function inferKind(filename: string): ArtifactKind {
  return KIND_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? "file";
}

export function parseKind(value: string): ArtifactKind {
  const parsed = ArtifactKindSchema.safeParse(value);
  if (!parsed.success)
    throw usageError(
      `--kind must be one of ${ArtifactKindSchema.options.join(", ")}`,
    );
  return parsed.data;
}

/** A Mermaid source is always served as `diagram.mmd` so the viewer finds it. */
const MERMAID_ENTRY = "diagram.mmd";
const SKIPPED_NAMES = new Set([".git", ".DS_Store"]);

function artifactPath(input: string, original: string): string {
  try {
    return normalizeArtifactPath(input);
  } catch (error) {
    if (error instanceof InvalidArtifactPathError)
      throw usageError(
        `Cannot publish ${original}: ${error.message}. Rename it (a leading "_" is reserved for the service).`,
      );
    throw error;
  }
}

async function sha256File(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

type Found = { relative: string; absolutePath: string; size: number };

async function walk(
  root: string,
  directory: string,
  found: Found[],
  limits: Limits,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (SKIPPED_NAMES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    const relative = path
      .relative(root, absolutePath)
      .split(path.sep)
      .join("/");
    if (entry.isSymbolicLink())
      throw usageError(
        `${relative} is a symbolic link. Publish real files: copy the target into the directory.`,
      );
    if (entry.isDirectory()) {
      await walk(root, absolutePath, found, limits);
      continue;
    }
    if (!entry.isFile())
      throw usageError(`${relative} is not a regular file or directory.`);
    const { size } = await lstat(absolutePath);
    found.push({ relative, absolutePath, size });
    if (found.length > limits.maxFiles)
      throw usageError(
        `${root} holds more than ${String(limits.maxFiles)} files, the per-version limit. Publish the build output (for example dist/), not the project.`,
      );
  }
}

function checkLimits(
  files: readonly { path: string; size: number }[],
  input: string,
  limits: Limits,
): number {
  let total = 0;
  for (const file of files) {
    if (file.size > limits.maxFileBytes)
      throw usageError(
        `${file.path} is ${mib(file.size)} MiB, over the ${mib(limits.maxFileBytes)} MiB per-file limit. Trim or split it.`,
      );
    total += file.size;
  }
  if (files.length > limits.maxFiles)
    throw usageError(
      `${input} has ${String(files.length)} files, over the ${String(limits.maxFiles)} file limit.`,
    );
  if (total > limits.maxVersionBytes)
    throw usageError(
      `${input} is ${mib(total)} MiB in total, over the ${mib(limits.maxVersionBytes)} MiB per-version limit.`,
    );
  return total;
}

function mib(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/u, "");
}

/** Hash up to this many files at once. */
const HASH_CONCURRENCY = 8;

async function hashAll(
  found: readonly Found[],
  entryName: (relative: string) => string,
  original: string,
): Promise<ManifestFile[]> {
  const result: ManifestFile[] = [];
  for (let start = 0; start < found.length; start += HASH_CONCURRENCY) {
    const batch = found.slice(start, start + HASH_CONCURRENCY);
    result.push(
      ...(await Promise.all(
        batch.map(async (file) => {
          const name = artifactPath(entryName(file.relative), original);
          return {
            path: name,
            absolutePath: file.absolutePath,
            size: file.size,
            sha256: await sha256File(file.absolutePath),
            mediaType: mediaTypeFor(name),
          } satisfies ManifestFile;
        }),
      )),
    );
  }
  return result;
}

/** Digest of what a version contains: entry and every file, in path order. */
export function manifestDigest(
  entryPath: string,
  files: readonly Pick<
    ManifestFile,
    "path" | "sha256" | "size" | "mediaType"
  >[],
): string {
  const lines = files
    .map((f) => `${f.path}\0${f.sha256}\0${String(f.size)}\0${f.mediaType}`)
    .toSorted();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${entryPath}\n${lines.join("\n")}`);
  return hasher.digest("hex");
}

export type BuildOptions = {
  /** Overrides the kind inferred from the extension. */
  kind?: ArtifactKind | undefined;
  limits?: Limits | undefined;
};

/**
 * Reads a file or directory into a manifest. A file is its own entry; a
 * directory needs a root `index.html` and becomes a `site`.
 */
export async function buildSource(
  input: string,
  options: BuildOptions = {},
): Promise<ArtifactSource> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const absolute = path.resolve(input);
  const stat = await lstat(absolute).catch(() => null);
  if (stat === null) throw usageError(`${input} does not exist.`);
  if (stat.isSymbolicLink())
    throw usageError(
      `${input} is a symbolic link. Publish real files: copy the target.`,
    );

  if (stat.isFile()) {
    const kind = options.kind ?? inferKind(absolute);
    if (kind === "site")
      throw usageError(
        `${input} is a file, not a directory: --kind site needs a directory with index.html.`,
      );
    const baseName = path.basename(absolute);
    const entryPath = artifactPath(
      kind === "mermaid" && path.extname(baseName).toLowerCase() === ".mmd"
        ? MERMAID_ENTRY
        : baseName,
      input,
    );
    const files = await hashAll(
      [{ relative: entryPath, absolutePath: absolute, size: stat.size }],
      (name) => name,
      input,
    );
    const totalBytes = checkLimits(files, input, limits);
    return {
      input,
      kind,
      entryPath,
      defaultTitle: path.basename(baseName, path.extname(baseName)),
      files,
      totalBytes,
      digest: manifestDigest(entryPath, files),
    };
  }

  if (!stat.isDirectory())
    throw usageError(`${input} is not a regular file or directory.`);
  if (options.kind !== undefined && options.kind !== "site")
    throw usageError(
      `${input} is a directory, which publishes as a site; --kind ${options.kind} needs a single file.`,
    );
  const found: Found[] = [];
  await walk(absolute, absolute, found, limits);
  if (!found.some((file) => file.relative === "index.html"))
    throw usageError(
      `${input} has no index.html at its root. A directory publishes as a site and needs one; to publish several files pass them as separate paths.`,
    );
  const files = await hashAll(found, (relative) => relative, input);
  const totalBytes = checkLimits(files, input, limits);
  return {
    input,
    kind: "site",
    entryPath: "index.html",
    defaultTitle: path.basename(absolute),
    files,
    totalBytes,
    digest: manifestDigest("index.html", files),
  };
}
