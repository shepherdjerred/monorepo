import type { DataDragonUpdateInput } from "./data-dragon.ts";

const SCOUT_ROOT = "packages/scout-for-lol";
const DATA_PACKAGE_ROOT = `${SCOUT_ROOT}/packages/data`;
const DATA_DRAGON_IMAGE_ASSETS_ROOT = `${DATA_PACKAGE_ROOT}/src/data-dragon/assets/img/`;
const ARENA_VISUAL_SNAPSHOT_ROOT = `${SCOUT_ROOT}/packages/report/src/html/arena/__snapshots__/`;
const RASTER_IMAGE_EXTENSIONS = new Set([
  ".gif",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);
const ARENA_VISUAL_SNAPSHOT_EXTENSIONS = new Set([".snap", ".svg"]);
const IMAGE_ONLY_SKIP_EMAIL_SUBJECT =
  "Scout Data Dragon refresh skipped: image-only changes";
const DATA_DRAGON_EMAIL_TAG = "scout-data-dragon";

export type GitChangeKind =
  | "added"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "untracked"
  | "other";

export type GitStatusEntry = {
  statusCode: string;
  path: string;
  previousPath: string | undefined;
  kind: GitChangeKind;
};

export type DataDragonSkipEmailContent = {
  subject: string;
  htmlBody: string;
  tag: string;
};

function gitChangeKind(statusCode: string): GitChangeKind {
  if (statusCode === "??") {
    return "untracked";
  }
  if (statusCode.includes("R")) {
    return "renamed";
  }
  if (statusCode.includes("C")) {
    return "copied";
  }
  if (statusCode.includes("A")) {
    return "added";
  }
  if (statusCode.includes("D")) {
    return "deleted";
  }
  if (statusCode.includes("M")) {
    return "modified";
  }
  return "other";
}

export function parseGitStatusLine(line: string): GitStatusEntry | undefined {
  if (line === "") {
    return undefined;
  }
  if (line.length < 4 || line[2] !== " ") {
    throw new Error(`Unexpected git status line: ${JSON.stringify(line)}`);
  }

  const statusCode = line.slice(0, 2);
  const rawPath = line.slice(3);
  const kind = gitChangeKind(statusCode);
  if (kind !== "renamed" && kind !== "copied") {
    return {
      statusCode,
      path: rawPath,
      previousPath: undefined,
      kind,
    };
  }

  const renameSeparator = " -> ";
  const separatorIndex = rawPath.lastIndexOf(renameSeparator);
  if (separatorIndex === -1) {
    return {
      statusCode,
      path: rawPath,
      previousPath: undefined,
      kind,
    };
  }

  return {
    statusCode,
    path: rawPath.slice(separatorIndex + renameSeparator.length),
    previousPath: rawPath.slice(0, separatorIndex),
    kind,
  };
}

function fileExtension(path: string): string {
  const dotIndex = path.lastIndexOf(".");
  if (dotIndex === -1) {
    return "";
  }
  return path.slice(dotIndex).toLowerCase();
}

function isModifiedRasterImageAsset(change: GitStatusEntry): boolean {
  return (
    change.kind === "modified" &&
    change.path.startsWith(DATA_DRAGON_IMAGE_ASSETS_ROOT) &&
    RASTER_IMAGE_EXTENSIONS.has(fileExtension(change.path))
  );
}

function isModifiedArenaVisualSnapshot(change: GitStatusEntry): boolean {
  return (
    change.kind === "modified" &&
    change.path.startsWith(ARENA_VISUAL_SNAPSHOT_ROOT) &&
    ARENA_VISUAL_SNAPSHOT_EXTENSIONS.has(fileExtension(change.path))
  );
}

export function isSuppressibleDataDragonPrChange(
  change: GitStatusEntry,
): boolean {
  return (
    isModifiedRasterImageAsset(change) || isModifiedArenaVisualSnapshot(change)
  );
}

export function nonSuppressibleDataDragonPrChanges(
  changes: GitStatusEntry[],
): GitStatusEntry[] {
  return changes.filter((change) => !isSuppressibleDataDragonPrChange(change));
}

export function shouldCreateDataDragonPr(changes: GitStatusEntry[]): boolean {
  return nonSuppressibleDataDragonPrChanges(changes).length > 0;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildImageOnlySkipEmailContent(
  input: DataDragonUpdateInput,
  changedFileCount: number,
): DataDragonSkipEmailContent {
  const mode = escapeHtml(input.mode);
  const currentVersion = escapeHtml(input.currentVersion);
  const latestVersion = escapeHtml(input.latestVersion);
  const count = String(changedFileCount);

  return {
    subject: IMAGE_ONLY_SKIP_EMAIL_SUBJECT,
    tag: DATA_DRAGON_EMAIL_TAG,
    htmlBody: [
      "<p>Scout Data Dragon refresh was skipped because the updater only changed existing image bytes.</p>",
      "<p>Riot's CDN can return inconsistent image files, so Temporal did not create a PR when no data changed and no images were added or removed.</p>",
      "<ul>",
      `<li>Mode: ${mode}</li>`,
      `<li>Current version: ${currentVersion}</li>`,
      `<li>Latest version: ${latestVersion}</li>`,
      `<li>Changed files: ${count}</li>`,
      "</ul>",
    ].join("\n"),
  };
}
