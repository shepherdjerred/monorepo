/**
 * `/files/<target>/*`: read-only pulls of plugin data (`ls`, `get`) and the
 * rwf recording/trace helpers. Every path is allowlisted as typed and again
 * after the server resolves its symlinks, so a link cannot reach outside.
 */
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  DATA_ROOT,
  type DataPath,
  DataPathSchema,
  type FileEntry,
  FilesGetRequestSchema,
  type FilesGetResponse,
  FilesGetResponseSchema,
  FilesListResponseSchema,
  isAllowedDataPath,
  MatchIdSchema,
  RWF_RECORDING_SUFFIX,
  RWF_RECORDINGS_DIR,
  RWF_TRACE_SUFFIX,
  RWF_TRACES_DIR,
  type RwfArtifact,
  RwfGetRequestSchema,
  type RwfKind,
  RwfListResponseSchema,
} from "#protocol/files.ts";
import type { DataFiles, FileRead } from "#src/files/data-files.ts";
import { body, DaemonError, reply } from "./http.ts";

type FilesContext = {
  files: (id: string) => Promise<DataFiles>;
  log: (msg: string, extra?: Record<string, unknown>) => void;
};

function dataPath(raw: string): DataPath {
  const parsed = DataPathSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DaemonError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return parsed.data;
}

/**
 * The canonical path relative to /data, refusing anything whose resolved
 * location leaves the allowlist; null when it does not exist.
 */
async function resolveAllowed(
  files: DataFiles,
  rel: string,
): Promise<string | null> {
  const real = await files.resolve(`${DATA_ROOT}/${rel}`);
  if (real === null) {
    return null;
  }
  const prefix = `${DATA_ROOT}/`;
  const resolved = real.startsWith(prefix) ? real.slice(prefix.length) : null;
  if (resolved === null || !isAllowedDataPath(resolved)) {
    throw new DaemonError(
      `${rel} resolves to ${real}, outside the readable roots`,
      403,
    );
  }
  return resolved;
}

async function requireAllowed(files: DataFiles, rel: string): Promise<string> {
  const resolved = await resolveAllowed(files, rel);
  if (resolved === null) {
    throw new DaemonError(`No such path ${rel} under ${DATA_ROOT}`, 404);
  }
  return resolved;
}

/** Copies a stream into a file, returning what was written. */
async function copyInto(
  stream: ReadableStream<Uint8Array>,
  file: string,
): Promise<{ bytes: number; sha256: string }> {
  const hash = new Bun.CryptoHasher("sha256");
  const sink = Bun.file(file).writer();
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      hash.update(chunk);
      bytes += chunk.byteLength;
      await sink.write(chunk);
    }
  } finally {
    await sink.end();
  }
  return { bytes, sha256: hash.digest("hex") };
}

/** Writes a stream into a transform's writable side, closing or aborting it. */
async function feed(
  source: ReadableStream<Uint8Array>,
  writer: {
    write: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>;
    close: () => Promise<void>;
    abort: (reason: unknown) => Promise<void>;
  },
): Promise<void> {
  try {
    for await (const chunk of source) {
      // Copied: stream chunks may view a shared buffer; the gunzipper's may not.
      await writer.write(new Uint8Array(chunk));
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error);
    throw error;
  }
}

async function discard(partial: string, reason: unknown): Promise<never> {
  await rm(partial, { force: true });
  throw reason instanceof Error ? reason : new Error(String(reason));
}

/** Streams a server file to `out` (via a partial file), optionally gunzipped. */
async function save(
  read: FileRead,
  out: string,
  gunzip: boolean,
): Promise<{ bytes: number; sha256: string }> {
  const partial = `${out}.partial`;
  let stream = read.stream;
  let fed: Promise<void> = Promise.resolve();
  if (gunzip) {
    const gunzipper = new DecompressionStream("gzip");
    fed = feed(read.stream, gunzipper.writable.getWriter());
    stream = gunzipper.readable;
  }
  // The exit status explains a failed copy better than a truncated stream.
  const [exit, input, copy] = await Promise.allSettled([
    read.done,
    fed,
    copyInto(stream, partial),
  ]);
  if (exit.status === "rejected") {
    return discard(partial, exit.reason);
  }
  if (input.status === "rejected") {
    return discard(partial, input.reason);
  }
  if (copy.status === "rejected") {
    return discard(partial, copy.reason);
  }
  await rename(partial, out);
  return copy.value;
}

async function pull(
  files: DataFiles,
  options: {
    target: string;
    source: string;
    out: string;
    force: boolean;
    gunzip: boolean;
  },
): Promise<FilesGetResponse> {
  const { source, out, gunzip } = options;
  if (gunzip && !source.endsWith(".gz")) {
    throw new DaemonError(`--gunzip needs a .gz file, got ${source}`);
  }
  const existing = await stat(out).catch(() => null);
  if (existing !== null && !options.force) {
    throw new DaemonError(`${out} already exists; pass --force`, 409);
  }
  await mkdir(path.dirname(out), { recursive: true });
  const written = await save(files.read(`${DATA_ROOT}/${source}`), out, gunzip);
  return {
    target: options.target,
    path: source,
    out,
    ...written,
    gunzipped: gunzip,
  };
}

const RWF_SOURCES: readonly {
  kind: RwfKind;
  dir: string;
  suffix: string;
}[] = [
  { kind: "recording", dir: RWF_RECORDINGS_DIR, suffix: RWF_RECORDING_SUFFIX },
  { kind: "trace", dir: RWF_TRACES_DIR, suffix: RWF_TRACE_SUFFIX },
];

/** Every recording and trace on the server, newest first. */
export async function listRwf(files: DataFiles): Promise<RwfArtifact[]> {
  const artifacts: RwfArtifact[] = [];
  for (const source of RWF_SOURCES) {
    const dir = await resolveAllowed(files, source.dir);
    if (dir === null) {
      continue;
    }
    for (const entry of await files.list(`${DATA_ROOT}/${dir}`, true)) {
      const name = path.posix.basename(entry.rel);
      const matchId = name.slice(0, -source.suffix.length);
      if (
        entry.type === "file" &&
        name.endsWith(source.suffix) &&
        MatchIdSchema.safeParse(matchId).success
      ) {
        artifacts.push({
          matchId,
          kind: source.kind,
          path: `${dir}/${entry.rel}`,
          size: entry.size,
          mtime: entry.mtime,
        });
      }
    }
  }
  return artifacts.toSorted((a, b) => b.mtime.localeCompare(a.mtime));
}

type FilesCall = {
  ctx: FilesContext;
  url: URL;
  request: Request;
  target: string;
  files: DataFiles;
};

async function listDir(call: FilesCall): Promise<Response> {
  const { files, target } = call;
  const rel = await requireAllowed(
    files,
    dataPath(call.url.searchParams.get("path") ?? ""),
  );
  const raw = await files.list(`${DATA_ROOT}/${rel}`, false);
  const entries: FileEntry[] = raw
    .map((entry) => ({
      name: entry.rel,
      type: entry.type,
      size: entry.size,
      mtime: entry.mtime,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return reply(FilesListResponseSchema, { target, path: rel, entries });
}

async function getFile(call: FilesCall): Promise<Response> {
  const { files, target } = call;
  const get = await body(call.request, FilesGetRequestSchema);
  const source = await requireAllowed(files, dataPath(get.path));
  call.ctx.log("files get", { target, path: source });
  return reply(
    FilesGetResponseSchema,
    await pull(files, {
      target,
      source,
      out: get.out,
      force: get.force,
      gunzip: get.gunzip,
    }),
  );
}

async function listRwfRoute(call: FilesCall): Promise<Response> {
  const match = call.url.searchParams.get("match");
  const artifacts = await listRwf(call.files);
  return reply(RwfListResponseSchema, {
    target: call.target,
    artifacts:
      match === null
        ? artifacts
        : artifacts.filter((artifact) => artifact.matchId === match),
  });
}

async function getRwf(call: FilesCall): Promise<Response> {
  const { files, target } = call;
  const get = await body(call.request, RwfGetRequestSchema);
  const artifacts = await listRwf(files);
  const found = artifacts.filter(
    (artifact) =>
      artifact.matchId === get.matchId && artifact.kind === get.kind,
  );
  const [artifact, ...more] = found;
  if (artifact === undefined) {
    throw new DaemonError(`No rwf ${get.kind} for match ${get.matchId}`, 404);
  }
  if (more.length > 0) {
    throw new DaemonError(
      `Several rwf ${get.kind}s for match ${get.matchId}: ${found.map((candidate) => candidate.path).join(", ")}`,
      409,
    );
  }
  const name = path.posix.basename(artifact.path);
  call.ctx.log("files rwf get", { target, path: artifact.path });
  return reply(
    FilesGetResponseSchema,
    await pull(files, {
      target,
      source: artifact.path,
      out: path.join(
        get.outDir,
        get.gunzip ? name.slice(0, -".gz".length) : name,
      ),
      force: get.force,
      gunzip: get.gunzip,
    }),
  );
}

const ROUTES: Record<string, (call: FilesCall) => Promise<Response>> = {
  "GET ls": listDir,
  "POST get": getFile,
  "GET rwf": listRwfRoute,
  "POST rwf-get": getRwf,
};

export async function dispatchFiles(
  ctx: FilesContext,
  url: URL,
  request: Request,
  route: { target: string; action: string },
): Promise<Response> {
  const { target, action } = route;
  const handler = ROUTES[`${request.method} ${action}`];
  if (handler === undefined) {
    throw new DaemonError(
      `Unknown route ${request.method} /files/${target}/${action}`,
      404,
    );
  }
  return handler({ ctx, url, request, target, files: await ctx.files(target) });
}
