/** `POST /api/uploads`, `PUT /api/uploads/:id/blobs/:sha256`, `POST /api/uploads/:id/commit`. */
import type { z } from "zod";
import {
  CommitUploadResponseSchema,
  CreateUploadRequestSchema,
  CreateUploadResponseSchema,
  Sha256Schema,
  type Actor,
  type ArtifactKind,
  type CommitUploadResponse,
  type CreateUploadRequest,
} from "#shared/contract.ts";
import { CommitConflictSchema } from "#shared/procedures.ts";
import {
  applyOps,
  bumpActivity,
  createBoard,
  boardBySlug,
  defaultFrameSize,
} from "./fake-boards.ts";
import { emitChange } from "./fake-hub.ts";
import {
  actorRef,
  iso,
  newToken,
  origins,
  ownerKeyOf,
  type ArtifactRec,
  type Store,
  type UploadRec,
  type VersionRec,
} from "./fake-types.ts";

const UPLOAD_TTL_MS = 3_600_000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function problem(status: number, error: string): Response {
  return json({ error }, status);
}

function sha256Hex(bytes: ArrayBuffer): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

const EXTENSION_KINDS = new Map<string, ArtifactKind>([
  ["html", "html"],
  ["htm", "html"],
  ["png", "image"],
  ["jpg", "image"],
  ["jpeg", "image"],
  ["gif", "image"],
  ["webp", "image"],
  ["avif", "image"],
  ["svg", "image"],
  ["mp4", "video"],
  ["webm", "video"],
  ["mov", "video"],
  ["m4v", "video"],
  ["pdf", "pdf"],
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["cast", "cast"],
  ["mmd", "mermaid"],
  ["mermaid", "mermaid"],
]);

const MEDIA_TYPE_KINDS: readonly (readonly [string, ArtifactKind])[] = [
  ["text/html", "html"],
  ["image/", "image"],
  ["video/", "video"],
  ["application/pdf", "pdf"],
];

/** The kind a manifest implies when the publisher did not name one. */
export function inferKind(request: CreateUploadRequest): ArtifactKind {
  const mediaType =
    request.files
      .find((file) => file.path === request.entryPath)
      ?.mediaType.toLowerCase() ?? "";
  const kind =
    EXTENSION_KINDS.get(
      request.entryPath.split(".").pop()?.toLowerCase() ?? "",
    ) ??
    MEDIA_TYPE_KINDS.find(([prefix]) => mediaType.startsWith(prefix))?.[1] ??
    "file";
  return kind === "html" && request.files.length > 1 ? "site" : kind;
}

function missingDigests(store: Store, request: CreateUploadRequest): string[] {
  return [
    ...new Set(
      request.files
        .map((file) => file.sha256)
        .filter((digest) => !store.blobs.has(digest)),
    ),
  ];
}

function createUpload(store: Store, request: CreateUploadRequest): Response {
  const digest = JSON.stringify(request);
  const existingId = store.uploadKeys.get(request.idempotencyKey);
  let upload =
    existingId === undefined ? undefined : store.uploads.get(existingId);
  if (upload !== undefined && upload.digest !== digest)
    return problem(409, "idempotencyKey was used with a different request");
  upload ??= {
    id: crypto.randomUUID(),
    request,
    digest,
    expiresAt: store.options.now() + UPLOAD_TTL_MS,
    committed: null,
  } satisfies UploadRec;
  store.uploads.set(upload.id, upload);
  store.uploadKeys.set(request.idempotencyKey, upload.id);
  return json(
    CreateUploadResponseSchema.parse({
      uploadId: upload.id,
      missing: missingDigests(store, request),
      expiresAt: iso(upload.expiresAt),
      deduplicated: upload.committed !== null,
    }),
  );
}

function liveUpload(store: Store, id: string): UploadRec | Response {
  const upload = store.uploads.get(id);
  if (upload === undefined) return problem(404, "upload not found");
  return store.options.now() > upload.expiresAt
    ? problem(410, "upload expired")
    : upload;
}

async function putBlob(
  store: Store,
  request: Request,
  id: string,
  sha256: string,
): Promise<Response> {
  const upload = liveUpload(store, id);
  if (upload instanceof Response) return upload;
  if (!Sha256Schema.safeParse(sha256).success)
    return problem(400, "invalid sha256");
  const declared = upload.request.files.find((file) => file.sha256 === sha256);
  if (declared === undefined)
    return problem(404, "the manifest has no such digest");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== declared.size)
    return problem(
      400,
      `size ${String(bytes.byteLength)} does not match the declared ${String(declared.size)}`,
    );
  if (sha256Hex(bytes) !== sha256)
    return problem(400, "sha256 does not match the body");
  store.blobs.set(sha256, new Blob([bytes]));
  return new Response(null, { status: 204 });
}

function conflict(body: z.infer<typeof CommitConflictSchema>): Response {
  return json(CommitConflictSchema.parse(body), 409);
}

function newVersion(
  store: Store,
  artifact: ArtifactRec,
  request: CreateUploadRequest,
  actor: Actor,
): VersionRec {
  const version: VersionRec = {
    id: crypto.randomUUID(),
    artifactId: artifact.id,
    number: artifact.versionIds.length + 1,
    entryPath: request.entryPath,
    files: request.files.map((file) => ({ ...file })),
    note: request.note ?? "",
    viewport: request.viewport ?? null,
    createdAt: store.options.now(),
    publisher: actorRef(actor),
    token: newToken(),
  };
  store.versions.set(version.id, version);
  store.tokens.set(version.token, version.id);
  artifact.versionIds.push(version.id);
  artifact.currentVersionId = version.id;
  return version;
}

function commitUpload(store: Store, id: string, actor: Actor): Response {
  const upload = liveUpload(store, id);
  if (upload instanceof Response) return upload;
  if (upload.committed !== null)
    return json({ ...upload.committed, deduplicated: true });
  const { request } = upload;
  const missing = missingDigests(store, request);
  if (missing.length > 0)
    return conflict({ error: "blobs are missing", missing });
  const board =
    boardBySlug(store, request.board) ??
    createBoard(store, request.board, request.boardTitle ?? request.board);
  let artifact =
    request.artifactId === undefined
      ? undefined
      : store.artifacts.get(request.artifactId);
  if (request.artifactId !== undefined && artifact?.boardId !== board.id)
    return problem(404, "artifact not found on this board");
  const currentVersionId = artifact?.currentVersionId ?? null;
  if (request.expectedCurrentVersionId !== currentVersionId)
    return conflict({
      error: "expectedCurrentVersionId does not match the current version",
      currentVersionId,
    });
  const kind = request.kind ?? inferKind(request);
  const created = artifact === undefined;
  artifact ??= {
    id: crypto.randomUUID(),
    boardId: board.id,
    title: request.title,
    kind,
    ownerKey: ownerKeyOf(actor),
    createdAt: store.options.now(),
    versionIds: [],
    currentVersionId: null,
  } satisfies ArtifactRec;
  store.artifacts.set(artifact.id, artifact);
  const version = newVersion(store, artifact, request, actor);
  if (created) {
    const size = request.placement ?? defaultFrameSize(kind);
    applyOps(store, board, [
      {
        op: "placeFrame",
        artifactId: artifact.id,
        w: size.w,
        h: size.h,
        ...(request.placement?.rightOf === undefined
          ? {}
          : { rightOf: request.placement.rightOf }),
      },
    ]);
  }
  bumpActivity(store, board);
  emitChange(store, board.id, "version.published", version.id);
  const { app } = origins(store);
  const committed: CommitUploadResponse = CommitUploadResponseSchema.parse({
    artifactId: artifact.id,
    versionId: version.id,
    number: version.number,
    reviewUrl: `${app}/a/${artifact.id}?v=${String(version.number)}`,
    boardUrl: `${app}/b/${board.slug}`,
    deduplicated: false,
  });
  upload.committed = committed;
  return json(committed);
}

const BLOB_ROUTE = /^\/api\/uploads\/([\w-]+)\/blobs\/([\da-f]{64})$/u;
const COMMIT_ROUTE = /^\/api\/uploads\/([\w-]+)\/commit$/u;

/** Null when the path is not an upload route. */
export async function handleUploadRoute(
  store: Store,
  request: Request,
  actor: Actor,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/uploads" && request.method === "POST") {
    const parsed = CreateUploadRequestSchema.safeParse(await request.json());
    return parsed.success
      ? createUpload(store, parsed.data)
      : problem(
          400,
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        );
  }
  const blob = BLOB_ROUTE.exec(pathname);
  if (blob !== null && request.method === "PUT")
    return putBlob(store, request, blob[1] ?? "", blob[2] ?? "");
  const commit = COMMIT_ROUTE.exec(pathname);
  if (commit !== null && request.method === "POST")
    return commitUpload(store, commit[1] ?? "", actor);
  return pathname.startsWith("/api/uploads")
    ? problem(405, "method not allowed")
    : null;
}
