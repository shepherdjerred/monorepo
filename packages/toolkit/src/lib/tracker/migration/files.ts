import { mkdir, lstat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveCredentials } from "#lib/credentials.ts";
import {
  ExportFileSchema,
  type ExportFile,
  type LinearExport,
} from "./schema.ts";

const uploadHosts = new Set(["uploads.linear.app", "public.linear.app"]);
export const hash = (bytes: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export function isLinearFile(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:" && uploadHosts.has(url.hostname);
}

export function inlineFiles(text: string): string[] {
  return [
    ...new Set(
      text.match(/https:\/\/(?:uploads|public)\.linear\.app\/[^\s<>"')\]]+/gu),
    ),
  ];
}

function fileUrls(snapshot: LinearExport): string[] {
  return [
    ...new Set([
      ...snapshot.issues.flatMap((issue) =>
        inlineFiles(issue.description ?? ""),
      ),
      ...snapshot.comments.flatMap((comment) => inlineFiles(comment.body)),
      ...snapshot.attachments
        .filter((file) => isLinearFile(file.url))
        .map((file) => file.url),
      ...snapshot.projects.flatMap((project) =>
        inlineFiles(project.description + "\n" + (project.content ?? "")),
      ),
    ]),
  ].sort();
}

function filename(url: string, disposition: string | null): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  const quoted = disposition?.match(/filename="?([^";]+)"?/iu)?.[1];
  const name =
    encoded === undefined
      ? (quoted ??
        decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? ""))
      : decodeURIComponent(encoded);
  const safe = (name.replaceAll("\\", "/").split("/").at(-1) ?? "")
    .replaceAll(/\p{Cc}/gu, "")
    .trim()
    .slice(0, 200);
  if (safe === "" || safe === "." || safe === "..")
    throw new Error("Linear file has no usable filename");
  return safe;
}

/** Never forward the Linear credential to redirect destinations. */
export async function downloadLinearFile(
  source: string,
  token: string | undefined,
  request: (url: URL, options: RequestInit) => Promise<Response> = fetch,
): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  if (!isLinearFile(source)) throw new Error("Not a Linear upload URL");
  let url = new URL(source);
  for (let redirect = 0; redirect < 6; redirect++) {
    const headers = new Headers();
    if (url.hostname === "uploads.linear.app") {
      if (token === undefined)
        throw new Error("Linear file credential is required");
      headers.set(
        "Authorization",
        token.startsWith("lin_api_") ? token : "Bearer " + token,
      );
    }
    const response = await request(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = nextFileUrl(response, url);
      continue;
    }
    return downloadedResponse(response, source);
  }
  throw new Error("Too many Linear file redirects");
}

export async function exportFiles(
  snapshot: LinearExport,
  directory: string,
  resume = false,
) {
  await mkdir(path.join(directory, "files"), {
    mode: 0o700,
    recursive: resume,
  });
  const urls = fileUrls(snapshot);
  const journalPath = path.join(directory, "downloaded-files.json");
  const previous =
    resume && (await Bun.file(journalPath).exists())
      ? z.array(ExportFileSchema).parse(await Bun.file(journalPath).json())
      : [];
  if (previous.some((file) => !urls.includes(file.url)))
    throw new Error("Download journal differs from the frozen source snapshot");
  for (const file of previous) await readExportFile(directory, file);
  if (urls.some((url) => new URL(url).hostname === "uploads.linear.app"))
    await resolveCredentials(["LINEAR_MIGRATION_API_KEY"]);
  const files: ExportFile[] = [];
  for (const url of urls) {
    const cached = previous.find((file) => file.url === url);
    if (cached !== undefined) {
      files.push(cached);
      continue;
    }
    const file = await downloadLinearFile(
      url,
      Bun.env["LINEAR_MIGRATION_API_KEY"],
    );
    const sha256 = hash(file.bytes);
    const relativePath = "files/" + sha256;
    await Bun.write(path.join(directory, relativePath), file.bytes, {
      mode: 0o600,
    });
    files.push(
      ExportFileSchema.parse({
        url,
        path: relativePath,
        filename: file.filename,
        sha256,
        contentType: file.contentType,
        sizeBytes: file.bytes.length,
      }),
    );
    await writeFile(journalPath + ".tmp", JSON.stringify(files), {
      mode: 0o600,
    });
    await rename(journalPath + ".tmp", journalPath);
    console.error(
      "Downloaded Linear file " +
        files.length.toString() +
        "/" +
        urls.length.toString(),
    );
  }
  return files;
}

export async function readExportFile(directory: string, file: ExportFile) {
  const destination = path.join(directory, file.path);
  const status = await lstat(destination);
  if (!status.isFile() || status.isSymbolicLink())
    throw new Error("Export attachment must be a regular file");
  const bytes = new Uint8Array(await Bun.file(destination).arrayBuffer());
  if (bytes.length !== file.sizeBytes || hash(bytes) !== file.sha256)
    throw new Error("Export attachment checksum mismatch: " + file.path);
  return bytes;
}

async function downloadedResponse(response: Response, source: string) {
  if (!response.ok)
    throw new Error(
      "Linear file download failed: HTTP " + response.status.toString(),
    );
  const maximum = 100 * 1024 * 1024;
  if (Number(response.headers.get("Content-Length")) > maximum)
    throw new Error("Linear file exceeds the import size limit");
  if (response.body === null)
    throw new Error("Linear file response has no body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    const chunk = z.instanceof(Uint8Array).parse(item.value);
    size += chunk.length;
    if (size > maximum)
      throw new Error("Linear file exceeds the import size limit");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const contentType = response.headers.get("Content-Type");
  if (contentType === null) throw new Error("Linear file has no content type");
  return {
    bytes,
    contentType,
    filename: filename(source, response.headers.get("Content-Disposition")),
  };
}

function nextFileUrl(response: Response, url: URL) {
  const location = response.headers.get("Location");
  if (location === null) throw new Error("Linear file redirect lacks Location");
  const next = new URL(location, url);
  if (
    next.protocol !== "https:" ||
    next.username ||
    next.password ||
    !(
      uploadHosts.has(next.hostname) ||
      next.hostname.endsWith(".amazonaws.com") ||
      next.hostname.endsWith(".cloudfront.net")
    )
  )
    throw new Error("Linear file redirected outside trusted file storage");
  return next;
}
