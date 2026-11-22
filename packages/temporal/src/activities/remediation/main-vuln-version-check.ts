import { z } from "zod/v4";
import type { GroupedVulnerability } from "#activities/maintenance/main-vuln-scan-report.ts";
import {
  compareSemver,
  parseSemver,
} from "#activities/ops/renovate-delta/semver-utils.ts";
import { runCommand as defaultRunCommand } from "#activities/scout/scout-season-refresh-git.ts";
import {
  FullCatalogSchema,
  VERSION_CATALOG_PATH,
} from "./version-catalog-schema.ts";

const ConcreteRangeSpecifierPattern =
  /^(?:npm:[^@\s]+@)?(?:>=|==|~=|[~^=])?v?(\d+\.\d+(?:\.\d+)?(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?)$/iu;

const ManifestRecordSchema = z.record(z.string(), z.unknown());

const PACKAGE_JSON_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "resolutions",
] as const;

function escapeRegExp(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function isAtLeastHighestFix(
  candidateVersion: string,
  fixes: readonly { raw: string; major: number; minor: number }[],
): boolean {
  const highest = fixes.at(-1);
  return (
    highest !== undefined &&
    (compareSemver(candidateVersion, highest.raw) ?? -1) >= 0
  );
}

function isVersionFixedForAdvisory(
  candidateVersion: string,
  fixedVersionSpec: string,
): boolean {
  const rawFixes = fixedVersionSpec
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (rawFixes.length === 0) {
    return false;
  }

  const parsedCandidate = parseSemver(candidateVersion);
  if (parsedCandidate === undefined) {
    return rawFixes.length === 1 && candidateVersion.trim() === rawFixes[0];
  }

  const parsedFixes: { raw: string; major: number; minor: number }[] = [];
  for (const rawFix of rawFixes) {
    const parsed = parseSemver(rawFix);
    if (parsed === undefined) {
      return false;
    }
    parsedFixes.push({ raw: rawFix, major: parsed.major, minor: parsed.minor });
  }
  parsedFixes.sort((left, right) => compareSemver(left.raw, right.raw) ?? 0);

  const sameMajorMinor = parsedFixes.filter(
    (fix) =>
      fix.major === parsedCandidate.major &&
      fix.minor === parsedCandidate.minor,
  );
  if (sameMajorMinor.length > 0) {
    return isAtLeastHighestFix(candidateVersion, sameMajorMinor);
  }

  const sameMajor = parsedFixes.filter(
    (fix) => fix.major === parsedCandidate.major,
  );
  return sameMajor.length > 0
    ? isAtLeastHighestFix(candidateVersion, sameMajor)
    : isAtLeastHighestFix(candidateVersion, parsedFixes);
}

function extractSpecifierLowerBound(spec: string): string | null {
  const trimmed = spec.trim();
  if (trimmed.startsWith("workspace:")) {
    return "workspace:*";
  }
  const match = ConcreteRangeSpecifierPattern.exec(trimmed);
  return match?.[1] ?? null;
}

function collectSectionVersions(
  block: unknown,
  pkgName: string,
): { versions: string[]; unparseableMatch: boolean } {
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return { versions: [], unparseableMatch: false };
  }
  const versions: string[] = [];
  let unparseableMatch = false;
  for (const [key, value] of Object.entries(block)) {
    if (key !== pkgName && !key.startsWith(`${pkgName}@`)) {
      continue;
    }
    const bound =
      typeof value === "string" ? extractSpecifierLowerBound(value) : null;
    if (bound === "workspace:*") {
      continue;
    }
    if (bound === null) {
      unparseableMatch = true;
    } else {
      versions.push(bound);
    }
  }
  return { versions, unparseableMatch };
}

function extractPackageJsonVersions(
  content: string,
  pkgName: string,
): { versions: string[]; unparseableMatch: boolean } {
  const parsed = ManifestRecordSchema.parse(JSON.parse(content));
  const versions: string[] = [];
  let unparseableMatch = false;
  for (const section of PACKAGE_JSON_SECTIONS) {
    const result = collectSectionVersions(parsed[section], pkgName);
    versions.push(...result.versions);
    unparseableMatch ||= result.unparseableMatch;
  }
  return { versions, unparseableMatch };
}

function extractRegexCaptures(content: string, pattern: RegExp): string[] {
  const results: string[] = [];
  for (const match of content.matchAll(pattern)) {
    if (match[1] !== undefined) {
      results.push(match[1]);
    }
  }
  return results;
}

function extractTomlOrPythonVersions(
  content: string,
  pkgName: string,
): { versions: string[]; unparseableMatch: boolean } {
  const escapedPkg = escapeRegExp(pkgName);
  const rawSpecs = [
    ...extractRegexCaptures(
      content,
      new RegExp(String.raw`"?${escapedPkg}"?\s*=\s*"([^"]+)"`, "gu"),
    ),
    ...extractRegexCaptures(
      content,
      new RegExp(
        String.raw`${escapedPkg}\s*=\s*\{[^}]*?version\s*=\s*"([^"]+)"`,
        "gu",
      ),
    ),
    ...extractRegexCaptures(
      content,
      new RegExp(
        String.raw`"${escapedPkg}\s*(?:>=|==|~=|[\^~=])\s*([^",;\s]+)"`,
        "gu",
      ),
    ),
  ];
  const versions: string[] = [];
  let unparseableMatch = false;
  for (const spec of rawSpecs) {
    const bound = extractSpecifierLowerBound(spec);
    if (bound === null || bound === "workspace:*") {
      unparseableMatch = true;
    } else {
      versions.push(bound);
    }
  }
  return {
    versions,
    unparseableMatch:
      unparseableMatch || (versions.length === 0 && content.includes(pkgName)),
  };
}

function extractTargetVersions(
  target: string,
  content: string,
  pkgName: string,
): { versions: string[]; unparseableMatch: boolean } {
  if (target === VERSION_CATALOG_PATH) {
    const catalog = FullCatalogSchema.parse(JSON.parse(content));
    const versions = catalog.entries
      .filter(
        (entry) =>
          entry.name === pkgName ||
          (entry.management.managed &&
            entry.management.packageName === pkgName),
      )
      .map((entry) => entry.value);
    return { versions, unparseableMatch: false };
  }
  if (target.endsWith("package.json")) {
    return extractPackageJsonVersions(content, pkgName);
  }

  const escapedPkg = escapeRegExp(pkgName);
  if (target === "bun.lock") {
    const versions = extractRegexCaptures(
      content,
      new RegExp(String.raw`"${escapedPkg}@([^"\s]+)"`, "gu"),
    ).filter(
      (ver) => !ver.startsWith("workspace:") && !ver.startsWith("root:"),
    );
    return {
      versions,
      unparseableMatch: versions.length === 0 && content.includes(pkgName),
    };
  }
  if (target.endsWith("Cargo.lock") || target.endsWith("uv.lock")) {
    const versions = extractRegexCaptures(
      content,
      new RegExp(
        String.raw`name\s*=\s*"${escapedPkg}"[\s\S]{0,160}?version\s*=\s*"([^"]+)"`,
        "gu",
      ),
    );
    return {
      versions,
      unparseableMatch: versions.length === 0 && content.includes(pkgName),
    };
  }
  if (target.endsWith("go.mod") || target.endsWith("go.sum")) {
    const versions = extractRegexCaptures(
      content,
      new RegExp(String.raw`(?:^|\s)${escapedPkg}\s+v?([^\s/]+)`, "gmu"),
    );
    return {
      versions,
      unparseableMatch: versions.length === 0 && content.includes(pkgName),
    };
  }
  return extractTomlOrPythonVersions(content, pkgName);
}

export function isTargetAdvisoryResolved(
  target: string,
  content: string,
  group: GroupedVulnerability & { fixedVersion: string },
): boolean {
  let extracted: { versions: string[]; unparseableMatch: boolean };
  try {
    extracted = extractTargetVersions(target, content, group.pkgName);
  } catch {
    return false;
  }
  if (extracted.unparseableMatch) {
    return false;
  }
  return extracted.versions.length === 0
    ? !content.includes(group.pkgName)
    : extracted.versions.every(
        (version) =>
          version !== group.installedVersion &&
          isVersionFixedForAdvisory(version, group.fixedVersion),
      );
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalJsonValue(item));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return Object.fromEntries(
      entries.map(([key, child]) => [key, canonicalJsonValue(child)]),
    );
  }
  return value;
}

function stripAllowedDependencySections(
  manifest: Readonly<Record<string, unknown>>,
): string {
  const allowedSet = new Set<string>(PACKAGE_JSON_SECTIONS);
  const rest = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !allowedSet.has(key)),
  );
  return JSON.stringify(canonicalJsonValue(rest));
}

export async function assertOnlyDependencyFieldsChanged(
  repoDir: string,
  changedFiles: readonly string[],
): Promise<void> {
  for (const file of changedFiles) {
    if (!file.endsWith("package.json")) {
      continue;
    }
    const beforeRaw = await defaultRunCommand(["git", "show", `HEAD:${file}`], {
      cwd: repoDir,
    });
    const afterRaw = await Bun.file(`${repoDir}/${file}`).text();
    const beforeParsed = ManifestRecordSchema.parse(JSON.parse(beforeRaw));
    const afterParsed = ManifestRecordSchema.parse(JSON.parse(afterRaw));
    if (
      stripAllowedDependencySections(beforeParsed) !==
      stripAllowedDependencySections(afterParsed)
    ) {
      throw new Error(
        `Non-dependency field (such as scripts) modified in ${file}`,
      );
    }
  }
}

export async function findWorkspacesDeclaringPackages(
  repoDir: string,
  packageNames: ReadonlySet<string>,
): Promise<string[]> {
  if (packageNames.size === 0) {
    return [];
  }
  const matched: string[] = [];
  const glob = new Bun.Glob("packages/**/package.json");
  for await (const relativePath of glob.scan({ cwd: repoDir })) {
    if (relativePath.includes("node_modules/")) {
      continue;
    }
    try {
      const parsed = ManifestRecordSchema.parse(
        await Bun.file(`${repoDir}/${relativePath}`).json(),
      );
      const wsName = parsed["name"];
      if (typeof wsName !== "string" || wsName === "") {
        continue;
      }
      const declaresAny = PACKAGE_JSON_SECTIONS.some((section) => {
        const block = parsed[section];
        return (
          typeof block === "object" &&
          block !== null &&
          !Array.isArray(block) &&
          Object.keys(block).some((dep) => packageNames.has(dep))
        );
      });
      if (declaresAny) {
        matched.push(wsName);
      }
    } catch {
      // Ignore unreadable or non-standard nested package.json files.
    }
  }
  return [...new Set(matched)].sort((left, right) => left.localeCompare(right));
}
