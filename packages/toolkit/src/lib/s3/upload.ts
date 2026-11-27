import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  castGifKey,
  castPlayerKey,
  contentTypeForFile,
  isCastFile,
} from "#lib/s3/assets.ts";
import type { CastGifRenderer } from "#lib/s3/cast-gif.ts";
import { renderCastPlayerHtml } from "#lib/s3/cast-player.ts";
import { createS3Client, profileEndpointUrl } from "#lib/s3/client.ts";
import {
  type MultipartPart,
  type ObjectStore,
  s3ObjectStore,
} from "#lib/s3/object-store.ts";

/**
 * Upload core shared by `toolkit pr asset` and `toolkit share`: planning
 * (directory walks, content types, `.cast` player pages and GIF previews),
 * collision checks, and the transfer itself (single PUT, or multipart above
 * 16 MiB). Callers own key naming, URLs, and output.
 */

/** AWS profile both commands use unless `--profile` is given. */
export const AGENT_SHARE_PROFILE = "agent-share";

/** Files above this size are uploaded in parts of this size. */
export const MULTIPART_THRESHOLD_BYTES = 16 * 1024 * 1024;

/**
 * `Cache-Control` for objects whose key is unique per upload, so the bytes
 * behind a URL can never change.
 */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export type PlannedUpload = {
  key: string;
  contentType: string;
  /** Human-readable origin, used in collision error messages. */
  source: string;
  body: () => Promise<Uint8Array>;
  /**
   * Local file the body is read from. When set, files above the multipart
   * threshold stream from it in parts instead of loading into memory.
   */
  localPath?: string | undefined;
};

/** A `.cast` recording to render to a GIF before anything is uploaded. */
export type PlannedGifRender = {
  castPath: string;
  gifPath: string;
};

/** Raised when the S3 client cannot be pointed at SeaweedFS. */
export class UploadSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadSetupError";
  }
}

async function readFileBytes(file: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(file).arrayBuffer());
}

/**
 * List every regular file in a directory, as sorted POSIX-style relative
 * paths. Dotfiles and dot-directories (`.git`, `.DS_Store`, …) are skipped;
 * symlinks inside the directory are skipped to avoid cycles.
 */
export async function walkDirectoryFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const absolute = path.join(entry.parentPath, entry.name);
    const segments = path.relative(dir, absolute).split(path.sep);
    if (segments.some((segment) => segment.startsWith("."))) {
      continue;
    }
    files.push(segments.join("/"));
  }
  return files.toSorted();
}

export type PlannedFileObjects = {
  uploads: PlannedUpload[];
  /** GIFs that must render successfully before the first upload. */
  gifRenders: PlannedGifRender[];
  /** Key of the object a reader opens: the player page for a `.cast`. */
  primaryKey: string;
  /** Key of the GIF preview, for `.cast` recordings only. */
  gifKey: string | undefined;
};

/**
 * Plan the objects for one file stored at `key`. A `.cast` recording also
 * gets a generated player page and a GIF preview; `gifPath` is where the
 * preview will be rendered locally before upload.
 *
 * The recording is paired with a self-contained player page because a raw
 * .cast URL just downloads NDJSON, which no reader can watch. GitHub cannot
 * embed the player, so the GIF renders inline and clicks through to it.
 */
export function planFileObjects(
  file: string,
  key: string,
  gifPath: string,
): PlannedFileObjects {
  const base = path.basename(file);
  const upload: PlannedUpload = {
    key,
    contentType: contentTypeForFile(base),
    source: file,
    body: () => readFileBytes(file),
    localPath: file,
  };
  if (!isCastFile(base)) {
    return {
      uploads: [upload],
      gifRenders: [],
      primaryKey: key,
      gifKey: undefined,
    };
  }
  const playerKey = castPlayerKey(key);
  const gifKey = castGifKey(key);
  return {
    uploads: [
      upload,
      {
        key: playerKey,
        contentType: "text/html; charset=utf-8",
        source: `${file} (generated player page)`,
        body: () =>
          Promise.resolve(
            // The player fetches the recording by its stored name, which
            // `share --name` may have changed from the local filename.
            new TextEncoder().encode(
              renderCastPlayerHtml(path.posix.basename(key)),
            ),
          ),
      },
      {
        key: gifKey,
        contentType: contentTypeForFile(gifKey),
        source: `${file} (generated GIF preview)`,
        body: () => readFileBytes(gifPath),
        localPath: gifPath,
      },
    ],
    gifRenders: [{ castPath: file, gifPath }],
    primaryKey: playerKey,
    gifKey,
  };
}

/** Plan one object per file of a directory, keyed by `keyFor(relativePath)`. */
export function planDirectoryObjects(
  dir: string,
  relativeFiles: readonly string[],
  keyFor: (relativePath: string) => string,
): PlannedUpload[] {
  return relativeFiles.map((relative): PlannedUpload => {
    const localPath = path.join(dir, ...relative.split("/"));
    return {
      key: keyFor(relative),
      contentType: contentTypeForFile(relative),
      source: localPath,
      body: () => readFileBytes(localPath),
      localPath,
    };
  });
}

/**
 * Render every planned GIF preview, in order, stopping at the first failure.
 * Runs before any upload so a missing or failing `agg` never leaves a cast
 * uploaded without its preview.
 */
export async function renderGifs(
  renders: readonly PlannedGifRender[],
  renderer: CastGifRenderer,
): Promise<void> {
  for (const render of renders) {
    await renderer(render.castPath, render.gifPath);
  }
}

/**
 * S3 client for an upload profile. The profile must carry an `endpoint_url`
 * (or the environment must set one): without it the SDK would send the
 * request to AWS itself.
 */
export async function createUploadClient(
  profile: string | null = AGENT_SHARE_PROFILE,
): Promise<ObjectStore> {
  const environment = Bun.env;
  const hasEnvEndpoint =
    (environment["AWS_ENDPOINT_URL_S3"] ?? environment["AWS_ENDPOINT_URL"]) !==
    undefined;
  if (profile === null) {
    if (!hasEnvEndpoint) {
      throw new UploadSetupError(
        "Static AWS credentials require AWS_ENDPOINT_URL_S3 or AWS_ENDPOINT_URL to target SeaweedFS",
      );
    }
    return s3ObjectStore(await createS3Client());
  }
  if (!hasEnvEndpoint && (await profileEndpointUrl(profile)) === undefined) {
    throw new UploadSetupError(
      `AWS profile '${profile}' is not configured with a SeaweedFS endpoint_url in ~/.aws/config`,
    );
  }
  return s3ObjectStore(await createS3Client(profile));
}

export type UploadOptions = {
  cacheControl?: string | undefined;
  /** Files larger than this use multipart upload. */
  multipartThresholdBytes?: number | undefined;
  /** Called with each object key just before it is transferred. */
  onUpload?: ((key: string) => void) | undefined;
};

type MultipartRequest = {
  bucket: string;
  key: string;
  contentType: string;
  localPath: string;
  size: number;
  partSize: number;
  cacheControl: string | undefined;
};

async function uploadMultipart(
  store: ObjectStore,
  request: MultipartRequest,
): Promise<void> {
  const location = { bucket: request.bucket, key: request.key };
  const uploadId = await store.createMultipart({
    ...location,
    contentType: request.contentType,
    cacheControl: request.cacheControl,
  });
  try {
    const parts: MultipartPart[] = [];
    const file = Bun.file(request.localPath);
    for (
      let offset = 0, partNumber = 1;
      offset < request.size;
      offset += request.partSize, partNumber += 1
    ) {
      const end = Math.min(offset + request.partSize, request.size);
      const body = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      const etag = await store.uploadPart({
        ...location,
        uploadId,
        partNumber,
        body,
      });
      parts.push({ partNumber, etag });
    }
    await store.completeMultipart({ ...location, uploadId, parts });
  } catch (error) {
    // Best effort: an orphaned multipart upload costs space, but the original
    // failure is the one worth reporting.
    await store.abortMultipart({ ...location, uploadId }).catch(() => {
      /* the upload failure above is the one to surface */
    });
    throw error;
  }
}

/**
 * Transfer one planned object and return the bytes uploaded. Local files
 * above the multipart threshold go up in threshold-sized parts; everything
 * else is a single PUT.
 */
export async function uploadObject(
  store: ObjectStore,
  bucket: string,
  upload: PlannedUpload,
  options: UploadOptions = {},
): Promise<number> {
  const threshold =
    options.multipartThresholdBytes ?? MULTIPART_THRESHOLD_BYTES;
  options.onUpload?.(upload.key);
  if (upload.localPath !== undefined) {
    const size = Bun.file(upload.localPath).size;
    if (size > threshold) {
      await uploadMultipart(store, {
        bucket,
        key: upload.key,
        contentType: upload.contentType,
        localPath: upload.localPath,
        size,
        partSize: threshold,
        cacheControl: options.cacheControl,
      });
      return size;
    }
  }
  const body = await upload.body();
  await store.put({
    bucket,
    key: upload.key,
    body,
    contentType: upload.contentType,
    cacheControl: options.cacheControl,
  });
  return body.byteLength;
}
