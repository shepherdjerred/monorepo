import { normalizeVersionString, sanitizeHttpsUrl } from "./semver-utils.ts";

export type ParsedPrPackageChange = {
  readonly packageName: string;
  readonly fromVersion: string | null;
  readonly toVersion: string | null;
  readonly compareUrl: string | undefined;
  readonly upstreamGithubRepo: string | undefined;
};

export type ParsedRenovatePrBody = {
  readonly changes: readonly ParsedPrPackageChange[];
  readonly consumers: readonly string[];
  readonly releaseNotesExcerpt: string | undefined;
  readonly releaseUrls: readonly string[];
};

const GithubRepoUrlPattern =
  /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git|[/?#)\s]|$)/giu;

export function extractGithubOwnerRepoFromText(
  text: string,
  ignoreSlug = "shepherdjerred/monorepo",
): string | undefined {
  GithubRepoUrlPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GithubRepoUrlPattern.exec(text)) !== null) {
    const owner = match[1];
    const repo = match[2];
    if (owner === undefined || repo === undefined) {
      continue;
    }
    const slug = `${owner}/${repo}`;
    if (slug.toLowerCase() !== ignoreSlug.toLowerCase()) {
      return slug;
    }
  }
  return undefined;
}

function splitMarkdownRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((c) => c.trim());
}

function parseChangeCell(cell: string): {
  fromVersion: string | null;
  toVersion: string | null;
  compareUrl: string | undefined;
} {
  const urlMatch = /\((https:\/\/[^)\s]+)\)/u.exec(cell);
  const plain = cell
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replaceAll("`", "");
  const parts = plain.split(/\s*(?:->|\u{2192})\s*/u);
  const leftToken = parts[0]?.trim().split(/\s+/u).at(-1);
  const rightToken = parts[1]?.trim().split(/\s+/u)[0];
  return {
    fromVersion: parts.length >= 2 ? normalizeVersionString(leftToken) : null,
    toVersion: parts.length >= 2 ? normalizeVersionString(rightToken) : null,
    compareUrl: sanitizeHttpsUrl(urlMatch?.[1]),
  };
}

function parsePackageCellName(cell: string): string {
  const firstLink = /\[([^\]]+)\]\([^)]+\)/u.exec(cell);
  return firstLink?.[1] === undefined
    ? (cell.split("(")[0] ?? cell).replaceAll("`", "").trim()
    : firstLink[1].replaceAll("`", "").trim();
}

function parsePrTableRow(
  headerCols: readonly string[],
  cells: readonly string[],
): ParsedPrPackageChange | undefined {
  const pkgIdx = headerCols.findIndex(
    (c) => c.includes("package") || c === "name",
  );
  const changeIdx = headerCols.findIndex((c) => c.includes("change"));
  if (pkgIdx === -1 || changeIdx === -1) {
    return undefined;
  }
  const pkgCell = cells[pkgIdx] ?? "";
  const changeCell = cells[changeIdx] ?? "";
  const pkgName = parsePackageCellName(pkgCell);
  if (pkgName === "") {
    return undefined;
  }
  const parsedChange = parseChangeCell(changeCell);
  return {
    packageName: pkgName,
    fromVersion: parsedChange.fromVersion,
    toVersion: parsedChange.toVersion,
    compareUrl: parsedChange.compareUrl,
    upstreamGithubRepo:
      extractGithubOwnerRepoFromText(pkgCell) ??
      extractGithubOwnerRepoFromText(changeCell),
  };
}

export function parseRenovatePrBody(body: string): ParsedRenovatePrBody {
  const lines = body.split(/\r?\n/u);
  const changes: ParsedPrPackageChange[] = [];
  let headerCols: string[] | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      headerCols = undefined;
      continue;
    }
    const cells = splitMarkdownRow(trimmed);
    if (cells.every((c) => /^:?-{2,}:?$/u.test(c))) {
      continue;
    }
    if (headerCols === undefined) {
      headerCols = cells.map((c) => c.toLowerCase());
      continue;
    }
    const rowChange = parsePrTableRow(headerCols, cells);
    if (rowChange !== undefined) {
      changes.push(rowChange);
    }
  }

  return {
    changes,
    consumers: extractConsumersFromPrBody(body),
    releaseNotesExcerpt: extractReleaseNotesDetails(body),
    releaseUrls: extractReleaseUrlsFromPrBody(body),
  };
}

function extractConsumersFromPrBody(body: string): string[] {
  const consumers = new Set<string>();
  const pkgPaths = body.matchAll(
    /\bpackages\/([a-z0-9-]+)(?:\/packages\/([a-z0-9-]+))?/giu,
  );
  for (const match of pkgPaths) {
    const first = match[1]?.toLowerCase();
    const second = match[2]?.toLowerCase();
    if (first === "version-catalog") {
      consumers.add("version-catalog");
      consumers.add("packages/homelab");
    } else if (first !== undefined && second !== undefined) {
      consumers.add(`packages/${first}/packages/${second}`);
    } else if (first !== undefined) {
      consumers.add(`packages/${first}`);
    }
  }
  if (/\b\.mise\.toml\b/u.test(body)) {
    consumers.add(".mise.toml");
  }
  return [...consumers];
}

function extractReleaseNotesDetails(body: string): string | undefined {
  const match =
    /<summary>\s*Release Notes\s*<\/summary>([\s\S]*?)<\/details>/iu.exec(body);
  const raw = match?.[1] ?? body;
  const cleaned = raw
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/<!--[\s\S]*?-->/gu, " ")
    .replaceAll(/[ \t]+\n/gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
  return cleaned.length < 24 ? undefined : cleaned.slice(0, 6000);
}

function extractReleaseUrlsFromPrBody(body: string): string[] {
  const urls: string[] = [];
  const matches = body.matchAll(
    /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/tag\/[^\s)>"]+/gu,
  );
  for (const match of matches) {
    const clean = sanitizeHttpsUrl(match[0]);
    if (clean !== undefined && !urls.includes(clean)) {
      urls.push(clean);
    }
  }
  return urls;
}
