#!/usr/bin/env bun

type AssetCheck = {
  label: string;
  maxBytes: number;
  patterns: readonly string[];
};

type AssetViolation = {
  label: string;
  maxBytes: number;
  path: string;
  size: number;
};

const BYTES_PER_MIB = 1024 * 1024;
const scoutRoot = `${import.meta.dir}/..`;

const checks: readonly AssetCheck[] = [
  {
    label: "Data Dragon champion loading image",
    maxBytes: 1 * BYTES_PER_MIB,
    patterns: [
      "packages/data/src/data-dragon/assets/img/champion-loading/*.jpg",
      "packages/data/src/data-dragon/assets/img/champion-loading/*.jpeg",
    ],
  },
  {
    label: "Scout top-level image asset",
    maxBytes: 5 * BYTES_PER_MIB,
    patterns: [
      "assets/*.avif",
      "assets/*.jpg",
      "assets/*.jpeg",
      "assets/*.png",
      "assets/*.webp",
    ],
  },
];

function formatMib(bytes: number): string {
  return `${(bytes / BYTES_PER_MIB).toFixed(2)} MiB`;
}

async function scanAssets(): Promise<{
  checkedCount: number;
  violations: AssetViolation[];
}> {
  let checkedCount = 0;
  const checkedPaths = new Set<string>();
  const violations: AssetViolation[] = [];

  for (const check of checks) {
    for (const pattern of check.patterns) {
      const glob = new Bun.Glob(pattern);
      for await (const relativePath of glob.scan({ cwd: scoutRoot })) {
        if (checkedPaths.has(relativePath)) {
          continue;
        }
        checkedPaths.add(relativePath);
        checkedCount++;

        const size = Bun.file(`${scoutRoot}/${relativePath}`).size;
        if (size > check.maxBytes) {
          violations.push({
            label: check.label,
            maxBytes: check.maxBytes,
            path: `packages/scout-for-lol/${relativePath}`,
            size,
          });
        }
      }
    }
  }

  return { checkedCount, violations };
}

const { checkedCount, violations } = await scanAssets();

if (violations.length > 0) {
  console.error("Scout asset size check failed:");
  for (const violation of violations) {
    console.error(
      `- ${violation.path}: ${formatMib(violation.size)} exceeds ${formatMib(violation.maxBytes)} (${violation.label})`,
    );
  }
  process.exit(1);
}

console.log(
  `Checked ${String(checkedCount)} Scout image assets; all are within size limits.`,
);
