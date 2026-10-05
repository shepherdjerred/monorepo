import path from "node:path";
import type {
  FilesGetResponse,
  FilesListResponse,
  RwfArtifact,
  RwfListResponse,
} from "@shepherdjerred/mc-harness/protocol/files.ts";

const TYPE_MARK = { file: "-", dir: "d", link: "l", other: "?" } as const;

function humanBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0
    ? `${bytes.toString()} B`
    : `${value.toFixed(1)} ${units[unit] ?? ""}`;
}

export function renderFilesList(listing: FilesListResponse): string {
  if (listing.entries.length === 0) {
    return `${listing.target}:/data/${listing.path} is empty`;
  }
  return [
    `${listing.target}:/data/${listing.path}`,
    ...listing.entries.map(
      (entry) =>
        `  ${TYPE_MARK[entry.type]} ${humanBytes(entry.size).padStart(10)}  ${entry.mtime}  ${entry.name}${entry.type === "dir" ? "/" : ""}`,
    ),
  ].join("\n");
}

export function renderFilesGet(got: FilesGetResponse): string {
  return `${got.target}:/data/${got.path} → ${got.out} (${humanBytes(got.bytes)}${got.gunzipped ? ", gunzipped" : ""}, sha256 ${got.sha256})`;
}

function rwfRow(artifact: RwfArtifact): string {
  return `${artifact.matchId}  ${artifact.kind.padEnd(9)}  ${humanBytes(artifact.size).padStart(10)}  ${artifact.mtime}  ${artifact.path}`;
}

export function renderRwfList(listing: RwfListResponse): string {
  return listing.artifacts.length === 0
    ? `No rwf recordings or bot traces on ${listing.target}`
    : listing.artifacts.map((artifact) => rwfRow(artifact)).join("\n");
}

/** `--out`, or the file's name in the current directory (minus `.gz` when gunzipping). */
export function defaultOut(
  source: string,
  out: string | undefined,
  gunzip: boolean,
): string {
  if (out !== undefined) {
    return path.resolve(out);
  }
  const name = path.posix.basename(source);
  return path.resolve(
    gunzip && name.endsWith(".gz") ? name.slice(0, -".gz".length) : name,
  );
}
