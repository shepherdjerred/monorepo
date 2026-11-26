import type { ArtifactKind, CreateUploadRequest } from "#shared/contract.ts";
import { essence } from "./content-types.ts";

function extension(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * The kind of an upload that did not name one, from the entry file: HTML is a
 * `site` when it has companions and a single `html` page when it does not.
 */
export function inferKind(request: CreateUploadRequest): ArtifactKind {
  const entry = request.files.find((file) => file.path === request.entryPath);
  const type = essence(entry?.mediaType ?? "");
  const ext = extension(request.entryPath);
  if (type === "text/html" || ext === "html" || ext === "htm")
    return request.files.length > 1 ? "site" : "html";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type === "application/pdf") return "pdf";
  if (type === "text/markdown" || ext === "md" || ext === "markdown")
    return "markdown";
  if (type === "application/x-asciicast" || ext === "cast") return "cast";
  return ext === "mmd" || ext === "mermaid" ? "mermaid" : "file";
}

/**
 * A stable digest of what an upload publishes: the artifact target and the
 * manifest, in path order. It leaves out `expectedCurrentVersionId`, `note`
 * and `boardTitle`, so a retry after a successful commit, by a client that
 * re-read the now-advanced current version, is recognized as the same upload.
 */
export async function requestDigest(
  request: CreateUploadRequest,
): Promise<string> {
  const files = request.files
    .map((file) => ({
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      mediaType: file.mediaType,
    }))
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const target = {
    board: request.board,
    artifactId: request.artifactId ?? null,
    title: request.title,
    kind: request.kind ?? null,
    entryPath: request.entryPath,
    files,
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(target)),
  );
  return Buffer.from(digest).toString("hex");
}
