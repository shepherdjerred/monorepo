import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assetKey,
  dirFileKey,
  firstDuplicateKey,
  markdownForAsset,
  markdownForCast,
  PUBLIC_BUCKET,
  publicUrlForKey,
} from "#lib/s3/assets.ts";
import {
  AGG_INSTALL_HINT,
  type CastGifRenderer,
  CastGifRenderError,
  renderCastGifWithAgg,
} from "#lib/s3/cast-gif.ts";
import type { ObjectStore } from "#lib/s3/object-store.ts";
import {
  AGENT_SHARE_PROFILE,
  createUploadClient,
  planDirectoryObjects,
  planFileObjects,
  type PlannedGifRender,
  type PlannedUpload,
  renderGifs,
  uploadObject,
  UploadSetupError,
  walkDirectoryFiles,
} from "#lib/s3/upload.ts";
import { resolvePrNumber } from "#lib/ci/github.ts";

export type AssetOptions = {
  markdown?: boolean | undefined;
  profile?: string | undefined;
  resolvePr?: (() => Promise<number>) | undefined;
  /** Test seam: builds the S3 client for the resolved profile. */
  createClient?: ((profile: string) => Promise<ObjectStore>) | undefined;
};

const USAGE =
  "Usage: toolkit pr asset [pr-number] <file|dir...> [--markdown] [--profile <name>] (default profile: agent-share)";

export type PlannedInput = {
  uploads: PlannedUpload[];
  /** GIFs that must render successfully before the first upload. */
  gifRenders: PlannedGifRender[];
  /** URL printed (and linked from markdown) for this CLI argument. */
  url: string;
  markdown: string;
};

/**
 * Plan the uploads for one file argument. A `.cast` recording also gets a
 * generated player page and a GIF preview; `gifPath` is where the preview
 * will be rendered locally before upload.
 */
export function planFile(
  prNumber: number,
  file: string,
  gifPath: string,
): PlannedInput {
  const base = path.basename(file);
  const planned = planFileObjects(file, assetKey(prNumber, file), gifPath);
  const url = publicUrlForKey(planned.primaryKey);
  return {
    uploads: planned.uploads,
    gifRenders: planned.gifRenders,
    url,
    markdown:
      planned.gifKey === undefined
        ? markdownForAsset(base, url)
        : markdownForCast(base, publicUrlForKey(planned.gifKey), url),
  };
}

function planDirectory(
  prNumber: number,
  dir: string,
  relativeFiles: string[],
): PlannedInput {
  const dirName = path.basename(path.resolve(dir));
  const url = publicUrlForKey(dirFileKey(prNumber, dirName, "index.html"));
  return {
    uploads: planDirectoryObjects(dir, relativeFiles, (relative) =>
      dirFileKey(prNumber, dirName, relative),
    ),
    gifRenders: [],
    url,
    markdown: `[${dirName} (demo site)](${url})`,
  };
}

/**
 * Render every planned GIF preview, in order, stopping at the first failure.
 * Runs before any upload so a missing or failing `agg` never leaves a cast
 * uploaded without its preview.
 */
export async function renderPlannedGifs(
  inputs: PlannedInput[],
  renderer: CastGifRenderer,
): Promise<void> {
  await renderGifs(
    inputs.flatMap((input) => input.gifRenders),
    renderer,
  );
}

/**
 * Upload files, asciinema recordings, and static demo-site directories as PR
 * media to the `public-sjer-red` bucket under `pr/assets/<pr-number>/`,
 * printing the public `public.sjer.red` URL for each argument (or
 * type-appropriate markdown with `--markdown`).
 *
 * - Directories are detected automatically, must contain a root `index.html`
 *   (the printed URL points at it), and upload recursively under
 *   `pr/assets/<pr-number>/<dirname>/`.
 * - `.cast` recordings also upload a generated self-contained HTML player
 *   page (`<name>.cast.html`) and an `agg`-rendered GIF preview
 *   (`<name>.cast.gif`). The printed URL is the player page; `--markdown`
 *   emits the GIF inline, linked to the player.
 *
 * All inputs are validated up front (PR number, every path exists, no object
 * key collisions, demo dirs have an index.html) and every GIF preview is
 * rendered before any upload runs, so the command is atomic — it never
 * leaves a partial set of objects behind on a bad argument or a failed
 * render. A missing or failing `agg` is an error, never a link-only fallback.
 */
async function resolveAssetTarget(
  firstArg: string | undefined,
  rest: string[],
  resolvePr: () => Promise<number>,
): Promise<{ pr: number; files: string[] } | null> {
  if (firstArg === undefined || firstArg.length === 0) {
    console.error("Error: at least one file or directory is required");
    console.error(USAGE);
    process.exitCode = 1;
    return null;
  }
  if (/^[1-9]\d*$/.test(firstArg)) {
    if (rest.length === 0) {
      console.error("Error: at least one file or directory is required");
      console.error(USAGE);
      process.exitCode = 1;
      return null;
    }
    return { pr: Number(firstArg), files: rest };
  }
  if (/^0$|^-\d+$/.test(firstArg)) {
    console.error("Error: a positive integer PR number is required");
    console.error(USAGE);
    process.exitCode = 1;
    return null;
  }
  const files = [firstArg, ...rest];
  for (const file of files) {
    try {
      await stat(file);
    } catch {
      console.error(`Error: file or directory not found: ${file}`);
      process.exitCode = 1;
      return null;
    }
  }
  try {
    const pr = await resolvePr();
    return { pr, files };
  } catch {
    console.error(
      "Error: no open PR found for current branch — create a draft PR first with 'toolkit git-spice branch submit --draft ...', then run 'toolkit pr asset <file|dir...> --markdown'.",
    );
    process.exitCode = 1;
    return null;
  }
}

export async function assetCommand(
  prNumber: string | undefined,
  files: string[],
  options: AssetOptions,
  renderCastGif: CastGifRenderer = renderCastGifWithAgg,
): Promise<void> {
  const target = await resolveAssetTarget(
    prNumber,
    files,
    options.resolvePr ?? (() => resolvePrNumber()),
  );
  if (target === null) {
    return;
  }
  const parsed = target.pr;

  // Plan every upload (resolving directories and generated player pages)
  // before touching the bucket, so a bad later argument doesn't leave
  // earlier uploads committed.
  // GIF previews render into a private temp dir that is created only once
  // validation passes and removed after the uploads.
  const gifDir = path.join(os.tmpdir(), `toolkit-pr-asset-${randomUUID()}`);
  const inputs: PlannedInput[] = [];
  for (const file of target.files) {
    let stats;
    try {
      stats = await stat(file);
    } catch {
      console.error(`Error: file or directory not found: ${file}`);
      process.exitCode = 1;
      return;
    }

    if (stats.isFile()) {
      inputs.push(
        planFile(
          parsed,
          file,
          path.join(gifDir, `${String(inputs.length)}.gif`),
        ),
      );
    } else if (stats.isDirectory()) {
      const relativeFiles = await walkDirectoryFiles(file);
      if (!relativeFiles.includes("index.html")) {
        console.error(
          `Error: directory '${file}' has no root index.html — demo-site uploads need an entry point to link to`,
        );
        process.exitCode = 1;
        return;
      }
      inputs.push(planDirectory(parsed, file, relativeFiles));
    } else {
      console.error(`Error: not a regular file or directory: ${file}`);
      process.exitCode = 1;
      return;
    }
  }

  // Two planned uploads with the same object key would silently overwrite.
  const duplicate = firstDuplicateKey(inputs.flatMap((input) => input.uploads));
  if (duplicate !== undefined) {
    console.error(
      `Error: '${duplicate.first}' and '${duplicate.second}' would collide on the same object key '${duplicate.key}'`,
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(gifDir, { recursive: true });
  try {
    try {
      await renderPlannedGifs(inputs, renderCastGif);
    } catch (error) {
      if (!(error instanceof CastGifRenderError)) {
        throw error;
      }
      console.error(`Error: ${error.message}`);
      console.error(
        `Install agg with \`${AGG_INSTALL_HINT}\` (https://docs.asciinema.org/manual/agg/). Nothing was uploaded.`,
      );
      process.exitCode = 1;
      return;
    }

    const profile = options.profile ?? AGENT_SHARE_PROFILE;
    let client: ObjectStore;
    try {
      client = await (options.createClient ?? createUploadClient)(profile);
    } catch (error) {
      if (!(error instanceof UploadSetupError)) {
        throw error;
      }
      console.error(
        `Error: ${error.message}. Run 'chezmoi apply ~/.aws/config' to render the '${AGENT_SHARE_PROFILE}' profile. Nothing was uploaded.`,
      );
      process.exitCode = 1;
      return;
    }

    for (const input of inputs) {
      for (const upload of input.uploads) {
        await uploadObject(client, PUBLIC_BUCKET, upload);
      }
      console.log(options.markdown === true ? input.markdown : input.url);
    }
  } finally {
    await rm(gifDir, { recursive: true, force: true });
  }
}
