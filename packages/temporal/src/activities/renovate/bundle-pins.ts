import nodePath from "node:path";
import { z } from "zod/v4";
import type { RenovateTarget } from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { dependencyFields } from "./bundle-policy.ts";

const ManifestSchema = z.record(z.string(), z.unknown());

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  const parsed = ManifestSchema.safeParse(value);
  return parsed.success
    ? Object.fromEntries(
        Object.entries(parsed.data)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, sortJson(child)]),
      )
    : value;
}

function versionMatches(key: string, dependency: string): boolean {
  return key === dependency || key.startsWith(`${dependency}@`);
}

function replaceManifestDependency(
  tree: Record<string, unknown>,
  target: RenovateTarget,
): number {
  let replacements = 0;
  for (const [key, value] of Object.entries(tree)) {
    if (
      versionMatches(key, target.packageName) &&
      value === target.currentValue
    ) {
      tree[key] = target.targetValue;
      replacements += 1;
    } else {
      const nested = ManifestSchema.safeParse(value);
      if (nested.success) {
        const replaced = replaceManifestDependency(nested.data, target);
        if (replaced > 0) tree[key] = nested.data;
        replacements += replaced;
      }
    }
  }
  return replacements;
}

function expectedPackageManifest(
  before: string,
  targets: readonly RenovateTarget[],
): string | undefined {
  const manifest = ManifestSchema.parse(JSON.parse(before));
  const dependencies = dependencyFields(manifest);
  for (const target of targets) {
    if (
      target.currentValue === null ||
      target.currentValue === target.targetValue ||
      target.digest !== null ||
      replaceManifestDependency(dependencies, target) === 0
    ) {
      return undefined;
    }
  }
  return JSON.stringify(sortJson({ ...manifest, ...dependencies }));
}

function escapePattern(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function replaceUnambiguousPin(
  before: string,
  target: RenovateTarget,
  current: string,
  next: string,
): string | undefined {
  if (current === next || current.length === 0 || next.length === 0)
    return undefined;
  // Exclude substrings of other versions (for example 1.2 in 1.2.3).
  const pattern = new RegExp(
    String.raw`(?<![\w.+-])${escapePattern(current)}(?![\w.+-])`,
    "gu",
  );
  const matches = [...before.matchAll(pattern)];
  const onlyMatch = matches[0];
  if (onlyMatch !== undefined && matches.length === 1) {
    return (
      before.slice(0, onlyMatch.index) +
      next +
      before.slice(onlyMatch.index + current.length)
    );
  }
  // Most repeated versions can be disambiguated by the dependency name on
  // the declaration or immediately preceding Renovate hint.
  const anchored = matches.filter((match) => {
    const beginningOfLine = before.lastIndexOf("\n", match.index - 1);
    const previousLine = before.lastIndexOf("\n", beginningOfLine - 1);
    const endOfLine = before.indexOf("\n", match.index);
    return before
      .slice(previousLine + 1, endOfLine === -1 ? undefined : endOfLine)
      .includes(target.packageName);
  });
  const match = anchored[0];
  return match !== undefined && anchored.length === 1
    ? before.slice(0, match.index) +
        next +
        before.slice(match.index + current.length)
    : undefined;
}

function replaceTextPin(
  content: string,
  target: RenovateTarget,
): string | undefined {
  const { currentValue, targetValue, currentDigest, digest } = target;
  if (currentValue === null) return undefined;
  const withVersion =
    currentValue === targetValue
      ? content
      : replaceUnambiguousPin(content, target, currentValue, targetValue);
  if (withVersion === undefined || digest === null || digest === currentDigest)
    return withVersion;
  return currentDigest === null
    ? undefined
    : replaceUnambiguousPin(withVersion, target, currentDigest, digest);
}

function expectedTextManifest(
  before: string,
  targets: readonly RenovateTarget[],
): string | undefined {
  const baseline = before.replaceAll("\r\n", "\n");
  let content = baseline;
  for (const target of targets) {
    const replaced = replaceTextPin(content, target);
    if (replaced === undefined || replaced === content) return undefined;
    content = replaced;
  }
  return content === baseline ? undefined : content;
}

export function expectedPinFile(
  file: string,
  before: string,
  targets: readonly RenovateTarget[],
): string | undefined {
  return nodePath.posix.basename(file) === "package.json"
    ? expectedPackageManifest(before, targets)
    : expectedTextManifest(before, targets);
}

export function actualPinFile(file: string, after: string): string {
  return nodePath.posix.basename(file) === "package.json"
    ? JSON.stringify(sortJson(ManifestSchema.parse(JSON.parse(after))))
    : after.replaceAll("\r\n", "\n");
}

export function targetsByFile(
  targets: readonly RenovateTarget[],
): Map<string, RenovateTarget[]> {
  const files = new Map<string, Map<string, RenovateTarget>>();
  for (const target of targets) {
    const key = JSON.stringify([
      target.packageName,
      target.currentValue,
      target.targetValue,
      target.currentDigest,
      target.digest,
    ]);
    const previous = files.get(target.filePath);
    if (previous === undefined) {
      files.set(target.filePath, new Map([[key, target]]));
    } else {
      previous.set(key, target);
    }
  }
  return new Map(
    [...files].map(([file, entries]) => [file, [...entries.values()]]),
  );
}

function codeInTable(value: string | null): string {
  const text = (value ?? "unknown")
    .replaceAll("|", String.raw`\|`)
    .replaceAll("`", "′")
    .replaceAll("\n", " ");
  return `\`${text}\``;
}

export function verifiedPinTable(targets: readonly RenovateTarget[]): string {
  const rows = [...targetsByFile(targets).values()].flat();
  return [
    "| Dependency | File | Before | After |",
    "| --- | --- | --- | --- |",
    ...rows.map((target) => {
      const before =
        target.currentDigest === null
          ? target.currentValue
          : `${target.currentValue ?? "unknown"}@${target.currentDigest}`;
      const after =
        target.digest === null
          ? target.targetValue
          : `${target.targetValue}@${target.digest}`;
      return `| ${codeInTable(target.packageName)} | ${codeInTable(target.filePath)} | ${codeInTable(before)} | ${codeInTable(after)} |`;
    }),
  ].join("\n");
}
