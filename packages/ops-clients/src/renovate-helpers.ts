/**
 * Internal metadata, deprecation table, and callout parsers for Renovate
 * Dependency Dashboard Markdown bodies.
 */

import type {
  RenovateDeprecation,
  RenovateUpdateType,
} from "@shepherdjerred/ops-clients/renovate.ts";

const ECOSYSTEM_KEYWORDS: readonly (readonly [RegExp, string])[] = [
  [/\brust crate\b/iu, "rust"],
  [/\bdocker (?:digest|tag)\b/iu, "docker"],
  [/\bhelm release\b/iu, "helm"],
  [/\bgithub[- ]actions?\b|\saction\s+to\b/iu, "github-actions"],
  [/\bmodule\s+\S+/iu, "gomod"],
  [/\bterraform\b/iu, "terraform"],
  [/\bnpm\b/iu, "npm"],
  [/\bbun\b/iu, "bun"],
  [/\bpython\b|\bpip\b/iu, "python"],
  [/\bdotnet\b|\bnuget\b/iu, "nuget"],
  [/\bmaven\b|\bgradle\b/iu, "maven"],
];

const PACKAGE_PREFIXES = [
  "rust crate ",
  "helm release ",
  "npm package ",
  "dependency ",
  "terraform ",
  "package ",
  "module ",
] as const;

const PACKAGE_SUFFIXES = [" docker tag", " action"] as const;

export function stripOuterMarkdownLink(raw: string): string {
  const trimmed = raw.trim();
  const match = /^\[([^\]]+)\]\([^)]+\)$/u.exec(trimmed);
  return match?.[1] === undefined ? trimmed : match[1].trim();
}

export function inferEcosystem(
  title: string,
  packageName: string | undefined,
): string | undefined {
  for (const [pattern, ecosystem] of ECOSYSTEM_KEYWORDS) {
    if (pattern.test(title)) {
      return ecosystem;
    }
  }
  if (packageName !== undefined) {
    const prefix = /^([a-z0-9-]+):[\w.-]+\//iu.exec(packageName)?.[1];
    if (prefix !== undefined && prefix.toLowerCase() !== "https") {
      return prefix.toLowerCase();
    }
    if (packageName.startsWith("ghcr.io/")) {
      return "docker";
    }
  }
  return undefined;
}

function stripActionVerb(raw: string): string | undefined {
  const withoutConventional = raw
    .replace(/^[a-z]+(?:\([^)]*\))?!?:/iu, "")
    .trim();
  const lower = withoutConventional.toLowerCase();
  if (lower.startsWith("update ")) {
    return withoutConventional.slice("update ".length).trim();
  }
  return lower.startsWith("pin ")
    ? withoutConventional.slice("pin ".length).trim()
    : undefined;
}

function cleanPackageDescriptor(raw: string): string {
  let text = raw.replaceAll("`", "").trim();
  const lower = text.toLowerCase();
  for (const prefix of PACKAGE_PREFIXES) {
    if (lower.startsWith(prefix)) {
      text = text.slice(prefix.length).trim();
      break;
    }
  }
  const fromIdx = text.toLowerCase().lastIndexOf(" from ");
  if (fromIdx !== -1) {
    text = text.slice(0, fromIdx).trim();
  }
  for (const suffix of PACKAGE_SUFFIXES) {
    if (text.toLowerCase().endsWith(suffix)) {
      text = text.slice(0, -suffix.length).trim();
      break;
    }
  }
  return text;
}

function firstToken(raw: string): string {
  const token = raw.trim().split(/\s+/u)[0] ?? "";
  return token.replaceAll(/[),;]+$/gu, "");
}

export function extractPackageAndVersion(title: string): {
  packageName: string | undefined;
  targetVersion: string | undefined;
} {
  const rest = stripActionVerb(title);
  if (rest === undefined || rest === "") {
    return { packageName: undefined, targetVersion: undefined };
  }
  const beforeParen = (rest.split("(")[0] ?? rest).trim();
  const lower = beforeParen.toLowerCase();

  const digestMarker = " docker digest to ";
  const digestIdx = lower.indexOf(digestMarker);
  if (digestIdx !== -1) {
    const pkg = beforeParen.slice(0, digestIdx).replaceAll("`", "").trim();
    const ver = firstToken(beforeParen.slice(digestIdx + digestMarker.length));
    return {
      packageName: pkg === "" ? undefined : pkg,
      targetVersion: ver === "" ? undefined : ver,
    };
  }

  const toIdx = lower.lastIndexOf(" to ");
  if (toIdx !== -1) {
    const pkg = cleanPackageDescriptor(beforeParen.slice(0, toIdx));
    const ver = firstToken(beforeParen.slice(toIdx + 4));
    return {
      packageName: pkg === "" ? undefined : pkg,
      targetVersion: ver === "" ? undefined : ver,
    };
  }

  const groupName = beforeParen.replaceAll("`", "").trim();
  return {
    packageName: groupName === "" ? undefined : groupName,
    targetVersion: undefined,
  };
}

function parseSemverTuple(
  version: string,
): readonly [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/iu.exec(version);
  return match?.[1] !== undefined &&
    match[2] !== undefined &&
    match[3] !== undefined
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : undefined;
}

function compareSemverChange(
  fromVer: readonly [number, number, number],
  toVer: readonly [number, number, number],
): RenovateUpdateType {
  if (fromVer[0] !== toVer[0]) {
    return "major";
  }
  if (fromVer[1] !== toVer[1]) {
    return "minor";
  }
  return fromVer[2] === toVer[2] ? "unknown" : "patch";
}

function extractFromToSemver(title: string): RenovateUpdateType | undefined {
  const tokens = title.split(/\s+/u);
  for (let idx = 0; idx + 3 < tokens.length; idx += 1) {
    if (
      tokens[idx]?.toLowerCase() === "from" &&
      tokens[idx + 2]?.toLowerCase() === "to"
    ) {
      const fromTuple = parseSemverTuple(tokens[idx + 1] ?? "");
      const toTuple = parseSemverTuple(tokens[idx + 3] ?? "");
      if (fromTuple !== undefined && toTuple !== undefined) {
        return compareSemverChange(fromTuple, toTuple);
      }
    }
  }
  return undefined;
}

function inferFromTargetVersion(
  targetVersion: string | undefined,
): RenovateUpdateType {
  if (targetVersion === undefined || targetVersion === "") {
    return "unknown";
  }
  if (/^v?\d+$/iu.test(targetVersion)) {
    return "major";
  }
  const semver = parseSemverTuple(targetVersion);
  if (semver !== undefined) {
    if (semver[0] > 0 && semver[1] === 0 && semver[2] === 0) {
      return "major";
    }
    return semver[2] === 0 ? "minor" : "patch";
  }
  if (/^v?\d+\.\d+$/iu.test(targetVersion)) {
    return "minor";
  }
  return /^[0-9a-f]{7,64}$/iu.test(targetVersion) ? "digest" : "unknown";
}

export function inferUpdateType(
  title: string,
  branch: string,
  targetVersion: string | undefined,
): RenovateUpdateType {
  if (/\bdigest(?:\s+to)?\b/iu.test(title)) {
    return "digest";
  }
  if (/(?:^|:\s*)pin\b/iu.test(title)) {
    return "pin";
  }
  if (branch.includes("/major-") || /\(major\)/iu.test(title)) {
    return "major";
  }
  if (branch.includes("/minor-") || /\(minor\)/iu.test(title)) {
    return "minor";
  }
  return branch.includes("/patch-") || /\(patch\)/iu.test(title)
    ? "patch"
    : (extractFromToSemver(title) ?? inferFromTargetVersion(targetVersion));
}

function parseMarkdownCellLink(cell: string): {
  text: string;
  url: string | undefined;
} {
  const trimmed = cell.trim();
  const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(trimmed);
  return linkMatch?.[1] !== undefined && linkMatch[2] !== undefined
    ? { text: linkMatch[1].trim(), url: linkMatch[2].trim() }
    : { text: trimmed.replaceAll("`", "").trim(), url: undefined };
}

function splitTableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return inner.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/u.test(cell));
}

function rowToDeprecation(
  headerCols: readonly string[],
  cells: readonly string[],
): RenovateDeprecation | undefined {
  const dsIdx = headerCols.findIndex((c) => c.includes("datasource"));
  const pkgIdx = headerCols.findIndex(
    (c) => c.includes("package") || c === "name",
  );
  const replIdx = headerCols.indexOf("replacement");
  const prIdx = headerCols.findIndex((c) => c.includes("replacement pr"));

  const datasource = (dsIdx === -1 ? cells[0] : cells[dsIdx]) ?? "";
  const rawPkg = (pkgIdx === -1 ? cells[1] : cells[pkgIdx]) ?? "";
  const parsedPkg = parseMarkdownCellLink(rawPkg);
  if (datasource === "" || parsedPkg.text === "") {
    return undefined;
  }
  const rawRepl = replIdx === -1 ? "" : (cells[replIdx] ?? "").trim();
  const replacement =
    rawRepl === "" || rawRepl === "-"
      ? undefined
      : parseMarkdownCellLink(rawRepl).text;
  const rawPr = (prIdx === -1 ? cells.at(-1) : cells[prIdx]) ?? "";
  const replacementAvailable =
    rawPr !== "" && !/unavailable|none|^-\s*$/iu.test(rawPr);
  return {
    datasource: datasource.replaceAll("`", "").trim(),
    packageName: parsedPkg.text,
    packageUrl: parsedPkg.url,
    replacement,
    replacementAvailable,
  };
}

export function parseDeprecationRows(
  lines: readonly string[],
): RenovateDeprecation[] {
  const deprecations: RenovateDeprecation[] = [];
  let headerCols: string[] | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      headerCols = undefined;
      continue;
    }
    const cells = splitTableCells(trimmed);
    if (isSeparatorRow(cells)) {
      continue;
    }
    if (headerCols === undefined) {
      headerCols = cells.map((c) => c.toLowerCase());
      continue;
    }
    const entry = rowToDeprecation(headerCols, cells);
    if (entry !== undefined) {
      deprecations.push(entry);
    }
  }
  return deprecations;
}

const DEPRECATION_CALLOUT_BOILERPLATE =
  /^The following dependencies are either deprecated or have replacements available\.?$/iu;

function stripBlockquotePrefix(line: string): string | undefined {
  const trimmed = line.trimStart();
  return trimmed.startsWith(">") ? trimmed.slice(1).trim() : undefined;
}

function collectWarningBlock(
  lines: readonly string[],
  startIndex: number,
  initialText: string,
): { text: string; nextIndex: number } {
  const parts = initialText === "" ? [] : [initialText];
  let cursor = startIndex;
  while (cursor + 1 < lines.length) {
    const quoted = stripBlockquotePrefix(lines[cursor + 1] ?? "");
    if (quoted === undefined || /^\[![A-Z]+\]/iu.test(quoted)) {
      break;
    }
    cursor += 1;
    if (quoted !== "") {
      parts.push(quoted);
    }
  }
  return { text: parts.join(" ").trim(), nextIndex: cursor };
}

export function parseLookupWarnings(lines: readonly string[]): string[] {
  const warnings: string[] = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const quoted = stripBlockquotePrefix(lines[idx] ?? "");
    if (quoted?.toUpperCase().startsWith("[!WARNING]") !== true) {
      continue;
    }
    const trailing = quoted.slice("[!WARNING]".length).trim();
    const collected = collectWarningBlock(lines, idx, trailing);
    idx = collected.nextIndex;
    if (
      collected.text !== "" &&
      !DEPRECATION_CALLOUT_BOILERPLATE.test(collected.text)
    ) {
      warnings.push(collected.text);
    }
  }
  return warnings;
}
