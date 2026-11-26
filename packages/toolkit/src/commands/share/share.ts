import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { urlForKey } from "#lib/s3/assets.ts";
import {
  AGG_INSTALL_HINT,
  type CastGifRenderer,
  CastGifRenderError,
  renderCastGifWithAgg,
} from "#lib/s3/cast-gif.ts";
import type { ObjectStore } from "#lib/s3/object-store.ts";
import {
  describeShareError,
  invalidNameReason,
  randomShareId,
  SHARE_TARGETS,
  SHARE_TMP_EXPIRY,
  type ShareVisibility,
  shareKeyPrefix,
} from "#lib/s3/share.ts";
import {
  AGENT_SHARE_PROFILE,
  createUploadClient,
  IMMUTABLE_CACHE_CONTROL,
  planDirectoryObjects,
  planFileObjects,
  type PlannedGifRender,
  type PlannedUpload,
  renderGifs,
  uploadObject,
  walkDirectoryFiles,
} from "#lib/s3/upload.ts";

/** `0` shared; `2` for usage, local input, authentication, and S3 errors. */
export const SHARE_EXIT_CODES = { ok: 0, error: 2 } as const;

export const SHARE_USAGE =
  "Usage: toolkit share <public|private> <file|dir...> [--keep] [--name <name>] [--json] [--profile <name>]";

export type ShareOptions = {
  keep?: boolean | undefined;
  name?: string | undefined;
  json?: boolean | undefined;
  profile?: string | undefined;
};

export type ShareDeps = {
  createClient?: ((profile: string) => Promise<ObjectStore>) | undefined;
  renderCastGif?: CastGifRenderer | undefined;
  now?: (() => Date) | undefined;
  randomId?: (() => string) | undefined;
  /** Stdout line sink; defaults to `console.log`. */
  out?: ((line: string) => void) | undefined;
  /** Stderr line sink (progress and errors); defaults to `console.error`. */
  err?: ((line: string) => void) | undefined;
};

export type ShareItem = {
  /** The local path as given. */
  path: string;
  /** URL of the object (player page for a `.cast`) or directory (trailing `/`). */
  url: string;
  /** Object key `url` addresses, or the key prefix ending in `/` for a directory. */
  key: string;
  /** Total bytes uploaded for this path, including generated objects. */
  bytes: number;
  /** Content type of the object `url` addresses; null for a directory. */
  contentType: string | null;
};

export type ShareResult = {
  visibility: ShareVisibility;
  expires: typeof SHARE_TMP_EXPIRY | "never";
  items: ShareItem[];
};

type PlannedItem = {
  path: string;
  url: string;
  key: string;
  contentType: string | null;
  uploads: PlannedUpload[];
  gifRenders: PlannedGifRender[];
};

type ItemPlan = {
  localPath: string;
  visibility: ShareVisibility;
  /** Object key of the item: `<prefix>/<name>`. */
  key: string;
  gifPath: string;
};

const VisibilitySchema = z.enum(["public", "private"]);

async function planItem(plan: ItemPlan): Promise<PlannedItem | string> {
  const { localPath, key } = plan;
  const stats = await stat(localPath).catch(() => null);
  if (stats === null) {
    return `file or directory not found: ${localPath}`;
  }
  const host = SHARE_TARGETS[plan.visibility].host;
  if (stats.isFile()) {
    const planned = planFileObjects(localPath, key, plan.gifPath);
    return {
      path: localPath,
      url: urlForKey(host, planned.primaryKey),
      key: planned.primaryKey,
      contentType:
        planned.uploads.find((upload) => upload.key === planned.primaryKey)
          ?.contentType ?? null,
      uploads: planned.uploads,
      gifRenders: planned.gifRenders,
    };
  }
  if (stats.isDirectory()) {
    const relativeFiles = await walkDirectoryFiles(localPath);
    if (relativeFiles.length === 0) {
      return `directory '${localPath}' has no files to upload (dotfiles and symlinks are skipped)`;
    }
    return {
      path: localPath,
      url: `${urlForKey(host, key)}/`,
      key: `${key}/`,
      contentType: null,
      uploads: planDirectoryObjects(
        localPath,
        relativeFiles,
        (relative) => `${key}/${relative}`,
      ),
      gifRenders: [],
    };
  }
  return `not a regular file or directory: ${localPath}`;
}

/** Problem with the arguments, or null when they are usable. */
function argumentProblem(
  visibility: string | undefined,
  paths: readonly string[],
  name: string | undefined,
): { message: string; showUsage: boolean } | null {
  if (!VisibilitySchema.safeParse(visibility).success) {
    return {
      message: "the first argument must be 'public' or 'private'",
      showUsage: true,
    };
  }
  if (paths.length === 0) {
    return {
      message: "at least one file or directory is required",
      showUsage: true,
    };
  }
  if (name === undefined) {
    return null;
  }
  const reason = invalidNameReason(name);
  if (paths.length !== 1) {
    return {
      message: "--name needs exactly one file or directory",
      showUsage: false,
    };
  }
  return reason === undefined
    ? null
    : { message: `--name ${reason}`, showUsage: false };
}

type PlanContext = {
  visibility: ShareVisibility;
  paths: readonly string[];
  options: ShareOptions;
  now: Date;
  randomId: () => string;
  gifDir: string;
};

/** Plan every path; the first problem is returned as text. */
async function planAll(context: PlanContext): Promise<PlannedItem[] | string> {
  const planned: PlannedItem[] = [];
  for (const localPath of context.paths) {
    const prefix = shareKeyPrefix({
      keep: context.options.keep === true,
      now: context.now,
      id: context.randomId(),
    });
    const name = context.options.name ?? path.basename(path.resolve(localPath));
    const item = await planItem({
      localPath,
      visibility: context.visibility,
      key: `${prefix}/${name}`,
      gifPath: path.join(context.gifDir, `${String(planned.length)}.gif`),
    });
    if (typeof item === "string") {
      return item;
    }
    planned.push(item);
  }
  return planned;
}

/**
 * Upload files and directories to the public or tailnet-private share bucket
 * under `share/{tmp|keep}/<date>/<random>/<name>` and print one URL per
 * top-level path. Returns the process exit code; never sets it.
 *
 * Every path is validated and every `.cast` GIF preview is rendered before
 * the first upload, so a bad argument leaves nothing behind. Each top-level
 * path gets its own random segment, so keys are unique and immutable.
 */
export async function shareCommand(
  visibility: string | undefined,
  paths: readonly string[],
  options: ShareOptions,
  deps: ShareDeps = {},
): Promise<number> {
  const out =
    deps.out ??
    ((line: string) => {
      console.log(line);
    });
  const err =
    deps.err ??
    ((line: string) => {
      console.error(line);
    });

  const problem = argumentProblem(visibility, paths, options.name);
  if (problem !== null) {
    err(`Error: ${problem.message}`);
    if (problem.showUsage) err(SHARE_USAGE);
    return SHARE_EXIT_CODES.error;
  }
  const parsedVisibility = VisibilitySchema.parse(visibility);

  const gifDir = path.join(os.tmpdir(), `toolkit-share-${randomUUID()}`);
  const planned = await planAll({
    visibility: parsedVisibility,
    paths,
    options,
    now: (deps.now ?? (() => new Date()))(),
    randomId: deps.randomId ?? randomShareId,
    gifDir,
  });
  if (typeof planned === "string") {
    err(`Error: ${planned}`);
    return SHARE_EXIT_CODES.error;
  }

  await mkdir(gifDir, { recursive: true });
  try {
    return await renderAndUpload({
      visibility: parsedVisibility,
      planned,
      options,
      deps,
      out,
      err,
    });
  } finally {
    await rm(gifDir, { recursive: true, force: true });
  }
}

type UploadContext = {
  visibility: ShareVisibility;
  planned: PlannedItem[];
  options: ShareOptions;
  deps: ShareDeps;
  out: (line: string) => void;
  err: (line: string) => void;
};

async function uploadItems(
  context: UploadContext,
  profile: string,
  items: ShareItem[],
): Promise<void> {
  const store = await (context.deps.createClient ?? createUploadClient)(
    profile,
  );
  const target = SHARE_TARGETS[context.visibility];
  for (const item of context.planned) {
    let bytes = 0;
    for (const upload of item.uploads) {
      bytes += await uploadObject(store, target.bucket, upload, {
        cacheControl: IMMUTABLE_CACHE_CONTROL,
        onUpload: (key) => {
          context.err(`uploading ${key}`);
        },
      });
    }
    items.push({
      path: item.path,
      url: item.url,
      key: item.key,
      bytes,
      contentType: item.contentType,
    });
    if (context.options.json !== true) context.out(item.url);
  }
}

async function renderAndUpload(context: UploadContext): Promise<number> {
  const { visibility, planned, options, deps, out, err } = context;
  try {
    await renderGifs(
      planned.flatMap((item) => item.gifRenders),
      deps.renderCastGif ?? renderCastGifWithAgg,
    );
  } catch (error) {
    if (!(error instanceof CastGifRenderError)) {
      throw error;
    }
    err(`Error: ${error.message}`);
    err(
      `Install agg with \`${AGG_INSTALL_HINT}\` (https://docs.asciinema.org/manual/agg/). Nothing was uploaded.`,
    );
    return SHARE_EXIT_CODES.error;
  }

  const profile = options.profile ?? AGENT_SHARE_PROFILE;
  const items: ShareItem[] = [];
  try {
    await uploadItems(context, profile, items);
  } catch (error) {
    err(`Error: ${describeShareError(error, { profile, visibility })}`);
    if (items.length > 0) {
      err(
        `Already uploaded before the failure: ${items.map((item) => item.url).join(" ")}`,
      );
    }
    return SHARE_EXIT_CODES.error;
  }

  const keep = options.keep === true;
  const result: ShareResult = {
    visibility,
    expires: keep ? "never" : SHARE_TMP_EXPIRY,
    items,
  };
  if (options.json === true) out(JSON.stringify(result));
  const audience = SHARE_TARGETS[visibility].audience;
  err(
    keep
      ? `shared ${String(items.length)} item(s) to ${audience}; kept (never expires)`
      : `shared ${String(items.length)} item(s) to ${audience}; expires in ${SHARE_TMP_EXPIRY} (use --keep to keep)`,
  );
  return SHARE_EXIT_CODES.ok;
}
