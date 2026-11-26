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
 * A stable digest of an upload request: the same manifest hashes the same
 * whatever order its files arrive in, so a retried publish is recognized.
 */
export async function requestDigest(
  request: CreateUploadRequest,
): Promise<string> {
  const files = request.files.toSorted((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const bytes = new TextEncoder().encode(JSON.stringify({ ...request, files }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}
