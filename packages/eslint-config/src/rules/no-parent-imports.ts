/**
 * ESLint rule: no-parent-imports
 *
 * Disallows relative imports that navigate to parent directories using ../ syntax.
 * This rule checks the literal import string, not the resolved path.
 *
 * Options:
 * - packagePrefix: The package scope prefix to use for auto-fix (default: "@shepherdjerred")
 *
 * Example with options:
 * "custom-rules/no-parent-imports": ["error", { "packagePrefix": "@myorg" }]
 */

import fs from "node:fs";
import path from "node:path";
import type { TSESLint } from "@typescript-eslint/utils";

type Options = [{ packagePrefix?: string }?];
type MessageIds = "noParentImports";

type PackageManifest = {
  name?: string | undefined;
  imports?: Record<string, unknown> | undefined;
  exports?: unknown;
};

type PackageLocation = {
  dir: string;
  manifest: PackageManifest;
};

type PatternMatch = {
  replacement: string;
  specificity: number;
};

const KNOWN_SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];
const manifestCache = new Map<string, PackageLocation | null>();

function hasKnownExtension(filePath: string): boolean {
  return KNOWN_SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function stripKnownExtension(filePath: string): string {
  for (const ext of KNOWN_SOURCE_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      return filePath.slice(0, -ext.length);
    }
  }
  return filePath;
}

function extractConditionTargets(conditionValue: unknown): string[] {
  if (typeof conditionValue === "string") {
    return [conditionValue];
  }
  if (Array.isArray(conditionValue)) {
    return conditionValue.flatMap((entry) => extractConditionTargets(entry));
  }
  if (typeof conditionValue === "object" && conditionValue !== null) {
    const obj = conditionValue as Record<string, unknown>;
    const preferredOrder = ["bun", "import", "default", "types"];
    const orderedKeys = [
      ...preferredOrder.filter((key) => key in obj),
      ...Object.keys(obj).filter((key) => !preferredOrder.includes(key)),
    ];
    return orderedKeys.flatMap((key) => extractConditionTargets(obj[key]));
  }
  return [];
}

function matchSinglePattern(
  keyPattern: string,
  targetPattern: string,
  dotRelTarget: string,
): PatternMatch | null {
  const keyHasWildcard = keyPattern.includes("*");
  const targetStarIndex = targetPattern.indexOf("*");

  if (!keyHasWildcard && targetStarIndex === -1) {
    if (dotRelTarget === targetPattern) {
      return { replacement: keyPattern, specificity: Number.MAX_SAFE_INTEGER };
    }
    if (
      !hasKnownExtension(dotRelTarget) &&
      stripKnownExtension(targetPattern) === dotRelTarget
    ) {
      return {
        replacement: keyPattern,
        specificity: Number.MAX_SAFE_INTEGER - 1,
      };
    }
    return null;
  }

  if (!keyHasWildcard || targetStarIndex === -1) {
    return null;
  }

  const targetPrefix = targetPattern.slice(0, targetStarIndex);
  const targetSuffix = targetPattern.slice(targetStarIndex + 1);

  if (
    dotRelTarget.startsWith(targetPrefix) &&
    dotRelTarget.endsWith(targetSuffix) &&
    dotRelTarget.length > targetPrefix.length + targetSuffix.length
  ) {
    const captured = dotRelTarget.slice(
      targetPrefix.length,
      dotRelTarget.length - targetSuffix.length,
    );
    return {
      replacement: keyPattern.replace("*", captured),
      specificity: targetPrefix.length + targetSuffix.length,
    };
  }

  if (
    !hasKnownExtension(dotRelTarget) &&
    KNOWN_SOURCE_EXTENSIONS.includes(targetSuffix) &&
    dotRelTarget.startsWith(targetPrefix) &&
    dotRelTarget.length > targetPrefix.length
  ) {
    const captured = dotRelTarget.slice(targetPrefix.length);
    return {
      replacement: keyPattern.replace("*", captured),
      specificity: targetPrefix.length + targetSuffix.length - 1,
    };
  }

  return null;
}

function selectBestMatch(
  entries: [string, unknown][],
  dotRelTarget: string,
): string | null {
  let best: PatternMatch | null = null;
  for (const [keyPattern, rawTarget] of entries) {
    for (const targetPattern of extractConditionTargets(rawTarget)) {
      const candidate = matchSinglePattern(
        keyPattern,
        targetPattern,
        dotRelTarget,
      );
      if (
        candidate !== null &&
        (best === null || candidate.specificity > best.specificity)
      ) {
        best = candidate;
      }
    }
  }
  return best?.replacement ?? null;
}

function matchPackageImports(
  importsField: Record<string, unknown> | undefined,
  dotRelTarget: string,
): string | null {
  if (importsField === undefined) {
    return null;
  }
  const entries = Object.entries(importsField).filter(([key]) =>
    key.startsWith("#"),
  );
  return selectBestMatch(entries, dotRelTarget);
}

function normalizeExportsEntries(exportsField: unknown): [string, unknown][] {
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    return [[".", exportsField]];
  }
  if (typeof exportsField === "object" && exportsField !== null) {
    const obj = exportsField as Record<string, unknown>;
    const keys = Object.keys(obj);
    return keys.some((key) => key.startsWith("."))
      ? Object.entries(obj).filter(([key]) => key.startsWith("."))
      : [[".", obj]];
  }
  return [];
}

function matchPackageExports(
  exportsField: unknown,
  dotRelTarget: string,
): string | null {
  const entries = normalizeExportsEntries(exportsField);
  return selectBestMatch(entries, dotRelTarget);
}

function parseManifestFile(manifestPath: string): PackageManifest | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return null;
    }
    const record = raw as Record<string, unknown>;
    const importsValue = record["imports"];
    return {
      name: typeof record["name"] === "string" ? record["name"] : undefined,
      imports:
        typeof importsValue === "object" &&
        importsValue !== null &&
        !Array.isArray(importsValue)
          ? (importsValue as Record<string, unknown>)
          : undefined,
      exports: record["exports"],
    };
  } catch {
    return null;
  }
}

function findNearestPackage(
  startDir: string,
  stopAtDir: string,
): PackageLocation | null {
  const cached = manifestCache.get(startDir);
  if (cached !== undefined) {
    return cached;
  }

  const visited: string[] = [];
  let current = startDir;
  let result: PackageLocation | null = null;

  while (true) {
    const existing = manifestCache.get(current);
    if (existing !== undefined) {
      result = existing;
      break;
    }
    visited.push(current);

    const manifestPath = path.join(current, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = parseManifestFile(manifestPath);
      if (manifest !== null) {
        result = { dir: current, manifest };
        break;
      }
    }

    if (current === stopAtDir) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  for (const dir of visited) {
    manifestCache.set(dir, result);
  }
  return result;
}

type FixRequest = {
  currentFilePath: string;
  cwd: string;
  importPath: string;
  packagePrefix: string;
  hasExplicitPrefix: boolean;
};

function resolveManifestSpecifier(options: {
  pkgLocation: PackageLocation;
  resolvedFile: string;
  importPath: string;
  targetFromSrc: string;
  packageName: string;
}): string | null {
  const { pkgLocation, resolvedFile, importPath, targetFromSrc, packageName } =
    options;
  const pkgDirPosix = pkgLocation.dir.replaceAll("\\", "/");
  const targetAbsPosix = path.posix.resolve(
    path.posix.dirname(resolvedFile),
    importPath,
  );
  const relToPkg = path.posix.relative(pkgDirPosix, targetAbsPosix);
  if (
    relToPkg === "" ||
    relToPkg.startsWith("..") ||
    path.posix.isAbsolute(relToPkg)
  ) {
    return null;
  }

  const dotRelTarget = `./${relToPkg}`;
  const hashSpecifier = matchPackageImports(
    pkgLocation.manifest.imports,
    dotRelTarget,
  );
  if (hashSpecifier !== null) {
    return hashSpecifier;
  }

  if (pkgLocation.manifest.exports !== undefined) {
    const exportSubpath = matchPackageExports(
      pkgLocation.manifest.exports,
      dotRelTarget,
    );
    if (exportSubpath === null) {
      return null;
    }
    return exportSubpath === "."
      ? packageName
      : `${packageName}/${exportSubpath.slice(2)}`;
  }

  return targetFromSrc.startsWith("..")
    ? null
    : `${packageName}/${targetFromSrc}`;
}

function computeFixedSpecifier(request: FixRequest): string | null {
  const { currentFilePath, cwd, importPath, packagePrefix, hasExplicitPrefix } =
    request;
  const absoluteFile = path.isAbsolute(currentFilePath)
    ? currentFilePath
    : path.resolve(cwd, currentFilePath);
  const resolvedFile = absoluteFile.replaceAll("\\", "/");

  // Match the LAST /packages/<name>/ segment so nested workspaces resolve to
  // the leaf package rather than a parent workspace container.
  const packageRegex = /^(.*\/packages\/([^/]+))\/(?:src\/)?(.+)$/;
  const fileMatch = packageRegex.exec(resolvedFile);
  if (!fileMatch) {
    return null;
  }

  const packageDirPosix = fileMatch[1];
  const currentPackage = fileMatch[2];
  const fileRelativeFromSrc = fileMatch[3];
  if (
    packageDirPosix === undefined ||
    currentPackage === undefined ||
    fileRelativeFromSrc === undefined
  ) {
    return null;
  }

  const targetFromSrc = path.posix.normalize(
    path.posix.join(path.posix.dirname(fileRelativeFromSrc), importPath),
  );
  const pkgLocation = findNearestPackage(
    path.dirname(absoluteFile),
    path.normalize(packageDirPosix),
  );

  const fallbackPackageName = `${packagePrefix}/${currentPackage}`;
  if (pkgLocation === null) {
    return targetFromSrc.startsWith("..")
      ? null
      : `${fallbackPackageName}/${targetFromSrc}`;
  }

  const packageName = hasExplicitPrefix
    ? fallbackPackageName
    : (pkgLocation.manifest.name ?? fallbackPackageName);

  return resolveManifestSpecifier({
    pkgLocation,
    resolvedFile,
    importPath,
    targetFromSrc,
    packageName,
  });
}

export const noParentImports: TSESLint.RuleModule<MessageIds, Options> = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "Disallow relative imports that navigate to parent directories",
    },
    messages: {
      noParentImports:
        "Relative parent imports are not allowed. Use package imports (e.g., '@scope/package/...') instead of relative paths (e.g., '../...').",
    },
    schema: [
      {
        type: "object",
        properties: {
          packagePrefix: {
            type: "string",
            description: "The package scope prefix to use for auto-fix",
          },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{ packagePrefix: "@shepherdjerred" }],
  create(context) {
    const rawOptions = context.options[0];
    const hasExplicitPrefix = rawOptions?.packagePrefix !== undefined;
    const packagePrefix = rawOptions?.packagePrefix ?? "@shepherdjerred";

    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;

        if (typeof importPath === "string" && importPath.includes("../")) {
          const currentFilePath = context.filename;

          context.report({
            node: node.source,
            messageId: "noParentImports",
            fix(fixer) {
              const fixedImportPath = computeFixedSpecifier({
                currentFilePath,
                cwd: context.cwd,
                importPath,
                packagePrefix,
                hasExplicitPrefix,
              });
              return fixedImportPath === null
                ? null
                : fixer.replaceText(node.source, `"${fixedImportPath}"`);
            },
          });
        }
      },
    };
  },
};
