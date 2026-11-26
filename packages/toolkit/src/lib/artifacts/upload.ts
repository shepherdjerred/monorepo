import { z } from "zod";
import {
  CommitUploadResponseSchema,
  CreateUploadRequestSchema,
  CreateUploadResponseSchema,
  Sha256Schema,
  type ArtifactKind,
  type CommitUploadResponse,
  type CreateUploadRequest,
  type Viewport,
} from "@shepherdjerred/artifacts/contract";
import type { ArtifactsClient } from "./client.ts";
import { failureFromResponse } from "./client.ts";
import { ArtifactsCliError, usageError } from "./errors.ts";
import type { ArtifactSource, ManifestFile } from "./manifest.ts";

/** The service may report that a commit replayed an earlier one. */
const CommitResultSchema = CommitUploadResponseSchema.extend({
  deduplicated: z.boolean().optional(),
});

export type UploadParams = {
  board: string;
  title: string;
  kind: ArtifactKind;
  artifactId?: string | undefined;
  expectedCurrentVersionId: string | null;
  idempotencyKey: string;
  note?: string | undefined;
  viewport?: Viewport | undefined;
  placement?: CreateUploadRequest["placement"];
};

export type UploadResult = CommitUploadResponse & { deduplicated: boolean };

/** The artifact's current version is not the one this publish was based on. */
export class PublishConflictError extends ArtifactsCliError {
  readonly currentVersionId: string | null;
  constructor(currentVersionId: string | null, message: string) {
    super("conflict", message, { exitCode: 2 });
    this.name = "PublishConflictError";
    this.currentVersionId = currentVersionId;
  }
}

export function idempotencyKey(parts: {
  workspaceKey: string;
  board: string;
  /** The artifact id for a new version, or `new:<title>` for a new artifact. */
  target: string;
  digest: string;
}): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(
    [parts.workspaceKey, parts.board, parts.target, parts.digest].join("\0"),
  );
  return hasher.digest("hex");
}

export type UploadRuntime = {
  sleep?: (ms: number) => Promise<void>;
  /** Attempts per request for transient failures. Default 3. */
  attempts?: number;
  /** Concurrent blob uploads. Default 4. */
  concurrency?: number;
  signal?: AbortSignal | undefined;
};

const BLOB_CONCURRENCY = 4;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  runtime: UploadRuntime,
  run: () => Promise<T>,
): Promise<T> {
  const attempts = runtime.attempts ?? 3;
  const sleep = runtime.sleep ?? delay;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (
        !(error instanceof ArtifactsCliError) ||
        !error.transient ||
        attempt >= attempts
      )
        throw error;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
}

function conflictMessage(currentVersionId: string | null): string {
  return currentVersionId === null
    ? "The artifact has no published version yet, but this publish expected one."
    : `The artifact changed since this publish was prepared; its current version is ${currentVersionId}.`;
}

const StaleConflictSchema = z.looseObject({
  currentVersionId: z.string().nullable(),
});
const MissingConflictSchema = z.looseObject({
  missing: z.array(Sha256Schema),
});

type Conflict =
  | { kind: "stale"; currentVersionId: string | null }
  | { kind: "missing"; missing: string[] }
  | { kind: "other"; text: string };

async function readConflict(response: Response): Promise<Conflict> {
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: reported as text below.
  }
  const missing = MissingConflictSchema.safeParse(json);
  if (missing.success)
    return { kind: "missing", missing: missing.data.missing };
  const stale = StaleConflictSchema.safeParse(json);
  return stale.success
    ? { kind: "stale", currentVersionId: stale.data.currentVersionId }
    : { kind: "other", text };
}

/** A 409 that is not a retryable missing-blob report ends the publish. */
async function failFromConflict(
  conflict: Conflict,
  baseUrl: string,
): Promise<never> {
  if (conflict.kind === "stale")
    throw new PublishConflictError(
      conflict.currentVersionId,
      conflictMessage(conflict.currentVersionId),
    );
  throw await failureFromResponse(
    new Response(conflict.kind === "other" ? conflict.text : "", {
      status: 409,
    }),
    baseUrl,
  );
}

async function parseOk<S extends z.ZodType>(
  client: ArtifactsClient,
  response: Response,
  schema: S,
  what: string,
): Promise<z.infer<S>> {
  if (!response.ok) throw await failureFromResponse(response, client.baseUrl);
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw new ArtifactsCliError(
      "server",
      `The artifacts service sent an unexpected ${what} response. The toolkit and the service may be out of step: run \`bun run --cwd packages/toolkit install:local\` to rebuild the binary.`,
    );
  return parsed.data;
}

function jsonInit(body: unknown, signal: AbortSignal | undefined): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  };
}

async function putBlob(
  client: ArtifactsClient,
  uploadId: string,
  file: ManifestFile,
  runtime: UploadRuntime,
): Promise<void> {
  await withRetry(runtime, async () => {
    const response = await client.request(
      `/api/uploads/${uploadId}/blobs/${file.sha256}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(file.size),
        },
        body: Bun.file(file.absolutePath),
        timeoutMs: 60_000 + Math.ceil(file.size / 262_144) * 1000,
        ...(runtime.signal === undefined ? {} : { signal: runtime.signal }),
      },
    );
    if (!response.ok) {
      const failure = await failureFromResponse(response, client.baseUrl);
      if (failure.kind === "rejected")
        throw new ArtifactsCliError(
          "rejected",
          `${file.path} was refused: ${failure.message}. If the file changed while publishing, run the command again.`,
        );
      throw failure;
    }
  });
}

type MissingUpload = {
  client: ArtifactsClient;
  uploadId: string;
  missing: readonly string[];
  files: readonly ManifestFile[];
  runtime: UploadRuntime;
};

async function putMissing(upload: MissingUpload): Promise<void> {
  const { client, uploadId, missing, files, runtime } = upload;
  const bySha = new Map(files.map((file) => [file.sha256, file]));
  const queue = [...new Set(missing)].map((sha) => {
    const file = bySha.get(sha);
    if (file === undefined)
      throw new ArtifactsCliError(
        "server",
        "The artifacts service asked for a file that is not in this manifest.",
      );
    return file;
  });
  const workers = Array.from(
    { length: Math.min(runtime.concurrency ?? BLOB_CONCURRENCY, queue.length) },
    async () => {
      for (let file = queue.shift(); file !== undefined; file = queue.shift())
        await putBlob(client, uploadId, file, runtime);
    },
  );
  await Promise.all(workers);
}

/** The most commit attempts: each one after the first re-sends what was missing. */
const COMMIT_ATTEMPTS = 3;

/**
 * Create the upload, send only the blobs the service lacks, and commit. The
 * idempotency key makes a retried publish resume rather than duplicate.
 */
export async function uploadVersion(
  client: ArtifactsClient,
  source: ArtifactSource,
  params: UploadParams,
  runtime: UploadRuntime = {},
): Promise<UploadResult> {
  const request = CreateUploadRequestSchema.safeParse({
    board: params.board,
    ...(params.artifactId === undefined
      ? {}
      : { artifactId: params.artifactId }),
    title: params.title,
    kind: params.kind,
    entryPath: source.entryPath,
    ...(params.note === undefined ? {} : { note: params.note }),
    ...(params.viewport === undefined ? {} : { viewport: params.viewport }),
    ...(params.placement === undefined ? {} : { placement: params.placement }),
    idempotencyKey: params.idempotencyKey,
    expectedCurrentVersionId: params.expectedCurrentVersionId,
    files: source.files.map(({ path, size, sha256, mediaType }) => ({
      path,
      size,
      sha256,
      mediaType,
    })),
  });
  if (!request.success)
    throw usageError(
      `The publish request is invalid: ${request.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );

  const created = await withRetry(runtime, async () => {
    const response = await client.request(
      "/api/uploads",
      jsonInit(request.data, runtime.signal),
    );
    return response.status === 409
      ? failFromConflict(await readConflict(response), client.baseUrl)
      : parseOk(client, response, CreateUploadResponseSchema, "upload");
  });
  const upload = {
    client,
    uploadId: created.uploadId,
    files: source.files,
    runtime,
  };
  await putMissing({ ...upload, missing: created.missing });

  for (let attempt = 1; ; attempt++) {
    const outcome = await commitOnce(client, created.uploadId, runtime);
    if (outcome.kind === "committed") return outcome.result;
    if (attempt >= COMMIT_ATTEMPTS)
      throw new ArtifactsCliError(
        "server",
        "The artifacts service kept reporting missing files after they were uploaded. Run the command again.",
      );
    await putMissing({ ...upload, missing: outcome.missing });
  }
}

type CommitOutcome =
  | { kind: "committed"; result: UploadResult }
  | { kind: "missing"; missing: string[] };

async function commitOnce(
  client: ArtifactsClient,
  uploadId: string,
  runtime: UploadRuntime,
): Promise<CommitOutcome> {
  return withRetry(runtime, async () => {
    const response = await client.request(`/api/uploads/${uploadId}/commit`, {
      ...jsonInit({}, runtime.signal),
      timeoutMs: 120_000,
    });
    if (response.status === 409) {
      const conflict = await readConflict(response);
      return conflict.kind === "missing"
        ? ({ kind: "missing", missing: conflict.missing } as const)
        : failFromConflict(conflict, client.baseUrl);
    }
    const { deduplicated = false, ...result } = await parseOk(
      client,
      response,
      CommitResultSchema,
      "commit",
    );
    return { kind: "committed", result: { ...result, deduplicated } } as const;
  });
}
