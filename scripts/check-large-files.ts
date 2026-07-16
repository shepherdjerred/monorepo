#!/usr/bin/env bun
/**
 * Two size gates, ported from the old CI large-file-check:
 * 1. scout-for-lol asset budget (its own script + thresholds)
 * 2. no tracked file > 5 MB, honoring .largeignore (one literal relative
 *    path per line, # comments allowed; trailing `*` = prefix match)
 *
 * Only git-tracked files are checked — local build output (target/, dist/,
 * caches) never ships, and the old CI's source mount excluded it the same way.
 */

const MAX_BYTES = 5 * 1_048_576;

const assetCheck = Bun.spawnSync(
  ["bun", "packages/scout-for-lol/scripts/check-asset-sizes.ts"],
  { stdout: "inherit", stderr: "inherit" },
);

const ignorePatterns: string[] = [];
const largeignore = Bun.file(".largeignore");
if (await largeignore.exists()) {
  const largeignoreText = await largeignore.text();
  for (const line of largeignoreText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    ignorePatterns.push(trimmed);
  }
}

function isIgnored(file: string): boolean {
  return ignorePatterns.some((pattern) =>
    pattern.endsWith("*")
      ? file.startsWith(pattern.slice(0, -1))
      : file === pattern,
  );
}

// -s gives the index mode per entry; 120000 = symlink (its "content" is the
// target path, so size checks are meaningless — and Bun.file would follow it).
const lsFiles = Bun.spawnSync(["git", "ls-files", "-sz"]);
if (lsFiles.exitCode !== 0) {
  throw new Error(`git ls-files failed: ${lsFiles.stderr.toString()}`);
}

const offenders: string[] = [];
for (const entry of lsFiles.stdout.toString().split("\0")) {
  if (entry === "") continue;
  // Format: "<mode> <object> <stage>\t<path>"
  const tabIndex = entry.indexOf("\t");
  if (tabIndex === -1) continue;
  const mode = entry.slice(0, 6);
  const file = entry.slice(tabIndex + 1);
  if (mode === "120000" || file.includes("/archive/") || isIgnored(file)) {
    continue;
  }
  const onDisk = Bun.file(file);
  if (!(await onDisk.exists())) continue; // deleted locally but still tracked
  if (onDisk.size > MAX_BYTES) {
    const mb = Math.round(onDisk.size / 1_048_576);
    offenders.push(`  ${file} (${String(mb)}MB)`);
  }
}

if (offenders.length > 0) {
  console.error("Tracked files exceed 5MB limit:");
  console.error(offenders.join("\n"));
  process.exit(1);
}

process.exit(assetCheck.exitCode);
