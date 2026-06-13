import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  assetKey,
  contentTypeForFile,
  dirFileKey,
  firstDuplicateKey,
  isCastFile,
  markdownForAsset,
  PUBLIC_BUCKET,
  publicUrlForKey,
} from "#lib/s3/assets.ts";
import { renderCastPlayerHtml } from "#lib/s3/cast-player.ts";
import { createS3Client, putObject } from "#lib/s3/client.ts";

export type AssetOptions = {
  markdown?: boolean | undefined;
  profile?: string | undefined;
};

const USAGE =
  "Usage: toolkit pr asset <pr-number> <file|dir...> [--markdown] [--profile <name>]";

type PlannedUpload = {
  key: string;
  contentType: string;
  /** Human-readable origin, used in collision error messages. */
  source: string;
  body: () => Promise<Uint8Array>;
};

type PlannedInput = {
  uploads: PlannedUpload[];
  /** URL printed (and linked from markdown) for this CLI argument. */
  url: string;
  markdown: string;
};

/**
 * List every regular file in a directory, as sorted POSIX-style relative
 * paths. Dotfiles and dot-directories (`.git`, `.DS_Store`, …) are skipped;
 * symlinks inside the directory are skipped to avoid cycles.
 */
async function walkDirectoryFiles(dir: string): Promise<string[]> {
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

function planFile(prNumber: number, file: string): PlannedInput {
  const base = path.basename(file);
  const key = assetKey(prNumber, file);
  const upload: PlannedUpload = {
    key,
    contentType: contentTypeForFile(base),
    source: file,
    body: async () => new Uint8Array(await Bun.file(file).arrayBuffer()),
  };

  if (isCastFile(base)) {
    // Pair the recording with a self-contained player page and link that —
    // a raw .cast URL just downloads NDJSON, which no reviewer can watch.
    const playerKey = `${key}.html`;
    const playerUpload: PlannedUpload = {
      key: playerKey,
      contentType: "text/html; charset=utf-8",
      source: `${file} (generated player page)`,
      body: () =>
        Promise.resolve(new TextEncoder().encode(renderCastPlayerHtml(base))),
    };
    const url = publicUrlForKey(playerKey);
    return {
      uploads: [upload, playerUpload],
      url,
      markdown: `[${base} (terminal recording)](${url})`,
    };
  }

  const url = publicUrlForKey(key);
  return { uploads: [upload], url, markdown: markdownForAsset(base, url) };
}

function planDirectory(
  prNumber: number,
  dir: string,
  relativeFiles: string[],
): PlannedInput {
  const dirName = path.basename(path.resolve(dir));
  const uploads = relativeFiles.map((relative): PlannedUpload => {
    const localPath = path.join(dir, ...relative.split("/"));
    return {
      key: dirFileKey(prNumber, dirName, relative),
      contentType: contentTypeForFile(relative),
      source: localPath,
      body: async () => new Uint8Array(await Bun.file(localPath).arrayBuffer()),
    };
  });
  const url = publicUrlForKey(dirFileKey(prNumber, dirName, "index.html"));
  return { uploads, url, markdown: `[${dirName} (demo site)](${url})` };
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
 *   page (`<name>.cast.html`); the printed URL is the player page.
 *
 * All inputs are validated up front (PR number, every path exists, no object
 * key collisions, demo dirs have an index.html) before any upload runs, so
 * the command is atomic — it never leaves a partial set of objects behind on
 * a bad argument.
 */
export async function assetCommand(
  prNumber: string | undefined,
  files: string[],
  options: AssetOptions,
): Promise<void> {
  const parsed = Number(prNumber);
  if (
    prNumber == null ||
    prNumber.length === 0 ||
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    console.error("Error: a positive integer PR number is required");
    console.error(USAGE);
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("Error: at least one file or directory is required");
    console.error(USAGE);
    process.exit(1);
  }

  // Plan every upload (resolving directories and generated player pages)
  // before touching the bucket, so a bad later argument doesn't leave
  // earlier uploads committed.
  const inputs: PlannedInput[] = [];
  for (const file of files) {
    let stats;
    try {
      stats = await stat(file);
    } catch {
      console.error(`Error: file or directory not found: ${file}`);
      process.exit(1);
    }

    if (stats.isFile()) {
      inputs.push(planFile(parsed, file));
    } else if (stats.isDirectory()) {
      const relativeFiles = await walkDirectoryFiles(file);
      if (!relativeFiles.includes("index.html")) {
        console.error(
          `Error: directory '${file}' has no root index.html — demo-site uploads need an entry point to link to`,
        );
        process.exit(1);
      }
      inputs.push(planDirectory(parsed, file, relativeFiles));
    } else {
      console.error(`Error: not a regular file or directory: ${file}`);
      process.exit(1);
    }
  }

  // Two planned uploads with the same object key would silently overwrite.
  const duplicate = firstDuplicateKey(inputs.flatMap((input) => input.uploads));
  if (duplicate !== undefined) {
    console.error(
      `Error: '${duplicate.first}' and '${duplicate.second}' would collide on the same object key '${duplicate.key}'`,
    );
    process.exit(1);
  }

  const client = createS3Client(options.profile);

  for (const input of inputs) {
    for (const upload of input.uploads) {
      await putObject(client, {
        bucket: PUBLIC_BUCKET,
        key: upload.key,
        body: await upload.body(),
        contentType: upload.contentType,
      });
    }
    console.log(options.markdown === true ? input.markdown : input.url);
  }
}
