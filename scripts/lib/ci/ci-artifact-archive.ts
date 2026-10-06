/** Fixed-path, manifest-verified archive handling for CI artifacts. */
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  createGzipDecoder,
  createGzipEncoder,
  createTarDecoder,
  packTar,
  type ParsedTarEntry,
  type TarEntry,
} from "modern-tar";
import { z } from "zod";

const MANIFEST_NAME = "manifest.json";
const PAYLOAD_PREFIX = "payload/";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRY_COUNT = 100_000;
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

type ArtifactDefinition = {
  readonly path: string;
  readonly type: "file" | "directory";
};

const ManifestEntrySchema = z
  .object({
    path: z.string().min(1),
    type: z.enum(["file", "directory"]),
    mode: z.number().int().min(0).max(0o777),
    size: z.number().int().min(0),
    sha256: z
      .string()
      .regex(/^[a-f\d]{64}$/u)
      .optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.type === "file" && entry.sha256 === undefined) {
      context.addIssue({
        code: "custom",
        message: "file entries require a SHA-256 digest",
      });
    }
    if (
      entry.type === "directory" &&
      (entry.size > 0 || entry.sha256 !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "directory entries cannot carry data",
      });
    }
  });

const ManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: z.string(),
    entries: z.array(ManifestEntrySchema).max(MAX_ENTRY_COUNT),
  })
  .strict();

type ManifestEntry = z.infer<typeof ManifestEntrySchema>;
type ArtifactManifest = z.infer<typeof ManifestSchema>;

export function artifactDefinition(key: string): ArtifactDefinition {
  switch (key) {
    case "resume-pdf":
      return { path: "packages/resume/resume.pdf", type: "file" };
    case "sjer-red-dist":
      return { path: "packages/sjer.red/dist", type: "directory" };
    case "wiki-dist":
      return { path: "packages/docs/wiki/dist", type: "directory" };
    default:
      throw new Error(`unknown CI artifact key: ${key}`);
  }
}

function isSafeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value)
  ) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return (
    normalized === value && !normalized.startsWith("../") && normalized !== ".."
  );
}

function isWithinArtifactPath(entryPath: string, rootPath: string): boolean {
  return entryPath === rootPath || entryPath.startsWith(`${rootPath}/`);
}

async function collectEntries(
  absolutePath: string,
  relativePath: string,
): Promise<{ manifest: ManifestEntry[]; tar: TarEntry[] }> {
  const stats = await lstat(absolutePath);
  if (stats.isSymbolicLink()) {
    throw new Error(
      `CI artifacts cannot contain symbolic links: ${relativePath}`,
    );
  }
  const mode = stats.mode & 0o777;
  if (stats.isFile()) {
    const body = await readFile(absolutePath);
    return {
      manifest: [
        {
          path: relativePath,
          type: "file",
          mode,
          size: body.byteLength,
          sha256: createHash("sha256").update(body).digest("hex"),
        },
      ],
      tar: [
        {
          header: {
            name: `${PAYLOAD_PREFIX}${relativePath}`,
            type: "file",
            mode,
            size: body.byteLength,
          },
          body,
        },
      ],
    };
  }
  if (!stats.isDirectory()) {
    throw new Error(
      `CI artifacts only support files and directories: ${relativePath}`,
    );
  }

  const manifest: ManifestEntry[] = [
    { path: relativePath, type: "directory", mode, size: 0 },
  ];
  const tar: TarEntry[] = [
    {
      header: {
        name: `${PAYLOAD_PREFIX}${relativePath}/`,
        type: "directory",
        mode,
        size: 0,
      },
    },
  ];
  const children = await readdir(absolutePath);
  const childNames = children.toSorted();
  for (const childName of childNames) {
    const child = await collectEntries(
      path.join(absolutePath, childName),
      path.posix.join(relativePath, childName),
    );
    manifest.push(...child.manifest);
    tar.push(...child.tar);
    if (manifest.length > MAX_ENTRY_COUNT) {
      throw new Error(
        `CI artifact exceeds ${MAX_ENTRY_COUNT.toString()} entries`,
      );
    }
  }
  return { manifest, tar };
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const body = new Response(bytes).body;
  if (body === null)
    throw new Error("could not create artifact compression stream");
  return new Uint8Array(
    await new Response(body.pipeThrough(createGzipEncoder())).arrayBuffer(),
  );
}

export async function createCiArtifactArchive(
  key: string,
  repositoryRoot = process.cwd(),
): Promise<Uint8Array> {
  const definition = artifactDefinition(key);
  const absolutePath = path.join(repositoryRoot, definition.path);
  const collected = await collectEntries(absolutePath, definition.path);
  const [rootEntry] = collected.manifest;
  if (rootEntry?.type !== definition.type) {
    throw new Error(
      `CI artifact ${key} must be a ${definition.type}: ${definition.path}`,
    );
  }
  const totalSize = collected.manifest.reduce(
    (sum, entry) => sum + entry.size,
    0,
  );
  if (totalSize > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(`CI artifact ${key} exceeds the uncompressed size limit`);
  }

  const manifest: ArtifactManifest = {
    schemaVersion: 1,
    key,
    entries: collected.manifest,
  };
  const manifestBody = new TextEncoder().encode(
    `${JSON.stringify(manifest)}\n`,
  );
  const tar = await packTar([
    {
      header: {
        name: MANIFEST_NAME,
        type: "file",
        mode: 0o644,
        size: manifestBody.byteLength,
      },
      body: manifestBody,
    },
    ...collected.tar,
  ]);
  return gzip(tar);
}

async function readEntryBody(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maximumBytes) {
      throw new Error("CI artifact entry exceeds its declared size limit");
    }
    chunks.push(chunk);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseManifest(bytes: Uint8Array, key: string): ArtifactManifest {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`CI artifact ${key} has an invalid manifest`, {
      cause: error,
    });
  }
  const manifest = ManifestSchema.parse(value);
  if (manifest.key !== key) {
    throw new Error(`CI artifact manifest key mismatch: expected ${key}`);
  }
  const definition = artifactDefinition(key);
  const seen = new Set<string>();
  let totalSize = 0;
  for (const entry of manifest.entries) {
    if (
      !isSafeRelativePath(entry.path) ||
      !isWithinArtifactPath(entry.path, definition.path)
    ) {
      throw new Error(`CI artifact contains an unsafe path: ${entry.path}`);
    }
    if (seen.has(entry.path)) {
      throw new Error(`CI artifact contains a duplicate path: ${entry.path}`);
    }
    seen.add(entry.path);
    totalSize += entry.size;
  }
  const root = manifest.entries.find((entry) => entry.path === definition.path);
  if (root?.type !== definition.type) {
    throw new Error(`CI artifact ${key} has an invalid root entry`);
  }
  if (totalSize > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(`CI artifact ${key} exceeds the uncompressed size limit`);
  }
  return manifest;
}

async function assertNoSymlinkParents(
  repositoryRoot: string,
  relativePath: string,
): Promise<void> {
  let current = repositoryRoot;
  for (const part of relativePath.split("/").slice(0, -1)) {
    current = path.join(current, part);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `refusing to restore through symbolic link: ${current}`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }
}

function normalizedTarName(entry: ParsedTarEntry): string {
  const name = entry.header.name.endsWith("/")
    ? entry.header.name.slice(0, -1)
    : entry.header.name;
  if (!isSafeRelativePath(name)) {
    throw new Error(`CI artifact contains an unsafe archive path: ${name}`);
  }
  return name;
}

async function restorePayloadEntry(
  entry: ParsedTarEntry,
  expected: ReadonlyMap<string, ManifestEntry>,
  restored: Set<string>,
  stagingRoot: string,
): Promise<void> {
  const archiveName = normalizedTarName(entry);
  if (!archiveName.startsWith(PAYLOAD_PREFIX)) {
    throw new Error(`CI artifact contains an unexpected entry: ${archiveName}`);
  }
  const relativePath = archiveName.slice(PAYLOAD_PREFIX.length);
  const manifestEntry = expected.get(relativePath);
  if (manifestEntry === undefined || restored.has(relativePath)) {
    throw new Error(
      `CI artifact contains an unexpected entry: ${relativePath}`,
    );
  }
  restored.add(relativePath);
  const entryType = entry.header.type ?? "file";
  if (entryType !== manifestEntry.type) {
    throw new Error(`CI artifact type mismatch for ${relativePath}`);
  }
  if (entry.header.size !== manifestEntry.size) {
    throw new Error(`CI artifact size mismatch for ${relativePath}`);
  }
  const outputPath = path.join(stagingRoot, relativePath);
  if (manifestEntry.type === "directory") {
    await entry.body.cancel();
    await mkdir(outputPath, { recursive: true, mode: manifestEntry.mode });
    await chmod(outputPath, manifestEntry.mode);
    return;
  }
  const body = await readEntryBody(entry.body, manifestEntry.size);
  if (body.byteLength !== manifestEntry.size) {
    throw new Error(`CI artifact size mismatch for ${relativePath}`);
  }
  const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== manifestEntry.sha256) {
    throw new Error(`CI artifact digest mismatch for ${relativePath}`);
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await Bun.write(outputPath, body);
  await chmod(outputPath, manifestEntry.mode);
}

export async function restoreCiArtifactArchive(
  key: string,
  archive: Uint8Array,
  repositoryRoot = process.cwd(),
): Promise<void> {
  const compressedBody = new Response(archive).body;
  if (compressedBody === null)
    throw new Error("could not read CI artifact archive");
  const decoded = compressedBody
    .pipeThrough(createGzipDecoder())
    .pipeThrough(createTarDecoder({ strict: true }));
  const iterator = decoded[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done === true || normalizedTarName(first.value) !== MANIFEST_NAME) {
    throw new Error(`CI artifact ${key} must begin with ${MANIFEST_NAME}`);
  }
  if ((first.value.header.type ?? "file") !== "file") {
    throw new Error(`CI artifact ${key} manifest is not a file`);
  }
  const manifestBytes = await readEntryBody(
    first.value.body,
    MAX_MANIFEST_BYTES,
  );
  const manifest = parseManifest(manifestBytes, key);
  const expected = new Map(
    manifest.entries.map((entry) => [entry.path, entry]),
  );
  const restored = new Set<string>();
  const stagingRoot = await mkdtemp(path.join(repositoryRoot, ".ci-artifact-"));

  try {
    for await (const entry of { [Symbol.asyncIterator]: () => iterator }) {
      await restorePayloadEntry(entry, expected, restored, stagingRoot);
    }
    if (restored.size !== expected.size) {
      const missing = [...expected.keys()].find(
        (entry) => !restored.has(entry),
      );
      throw new Error(
        `CI artifact is missing manifest entry: ${missing ?? "unknown"}`,
      );
    }

    const definition = artifactDefinition(key);
    await assertNoSymlinkParents(repositoryRoot, definition.path);
    const destination = path.join(repositoryRoot, definition.path);
    const staged = path.join(stagingRoot, definition.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await rename(staged, destination);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
