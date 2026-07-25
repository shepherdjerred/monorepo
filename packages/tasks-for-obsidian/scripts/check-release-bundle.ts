#!/usr/bin/env bun
/**
 * Release Metro bundle smoke — the pre-merge guard against Xcode Cloud Archive
 * failures. Run it locally (`bun run check:release-bundle`) before merging; the
 * CI step that used to run it was removed 2026-07 with the pipeline.
 *
 * The Xcode Cloud "Bundle React Native code and images" phase runs Metro in
 * Release mode (`--dev false`), which is the ONLY place source-only `file:`
 * workspace deps (and their transitive deps) get resolved for real. A simulator
 * debug build skips this, so a missing dependency passes locally but fails the
 * cloud Archive. This script reproduces that exact bundle (pure JS — no macOS
 * needed), so the failure is caught pre-merge.
 *
 * It caught, and guards against recurrence of, the `@tasknotes/model` resolution
 * failure: `tasknotes-types/src/v2.ts` re-exports a dep that must be installed in
 * `packages/tasknotes-types/node_modules` for Metro to find it. See
 * `ios/ci_scripts/ci_post_clone.sh` and the `xcode-cloud-debug` skill.
 *
 * Runs the same bundle for every source-only dependency the app imports — any new
 * unresolvable import fails here regardless of which package introduced it. It
 * also asserts each React singleton is bundled exactly once (see below).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

// A real release bundle for this app is ~12 MB; anything under this means Metro
// produced an empty/stub bundle rather than the full dependency graph.
const MIN_BUNDLE_BYTES = 1_000_000;

// Packages that MUST appear exactly once in the bundle. Two copies of any of
// these ship a broken app that only crashes at runtime, not at bundle time:
// e.g. two `react` copies (from the app pinning one version while the hoisted
// monorepo root resolves another) make React's hooks dispatcher null ->
// "Cannot read property 'useEffect' of null" at launch. This bit TestFlight
// build #62; the dev server hides it, so only the Release bundle exposes it.
// See packages/docs/logs/2026-07-24_ios-duplicate-react-startup-crash.md.
const SINGLETON_PACKAGES = ["react", "react-native", "scheduler"] as const;

/**
 * Given a Metro sourcemap's `sources` list, return, for each singleton, the
 * distinct on-disk package roots it resolved to. Each MUST resolve to exactly
 * one root: `> 1` is a duplicate copy (the launch crash), and `0` means the
 * matcher found nothing — a bundled singleton is always present, so zero means
 * the sourcemap path format changed and this guard can no longer see
 * duplicates. Both are violations. Pure + exported so it can be unit-tested
 * without a full bundle.
 */
export function findSingletonViolations(
  sources: string[],
): { pkg: string; roots: string[] }[] {
  const violations: { pkg: string; roots: string[] }[] = [];
  for (const pkg of SINGLETON_PACKAGES) {
    // Match `.../node_modules/<pkg>/` — the trailing slash keeps `react` from
    // matching `react-native` / `react-dom`, and `react-native` from matching
    // `react-native-gesture-handler`.
    const marker = `/node_modules/${pkg}/`;
    const roots = new Set<string>();
    for (const source of sources) {
      const idx = source.lastIndexOf(marker);
      if (idx !== -1) roots.add(source.slice(0, idx + marker.length - 1));
    }
    if (roots.size !== 1) violations.push({ pkg, roots: [...roots].sort() });
  }
  return violations;
}

const SourcemapSchema = z.object({ sources: z.array(z.string()) });

function assertSingletons(sourcemapPath: string): void {
  const parsed = SourcemapSchema.safeParse(
    JSON.parse(readFileSync(sourcemapPath, "utf8")),
  );
  if (!parsed.success) {
    throw new Error(
      `Sourcemap ${sourcemapPath} has no usable "sources" array.`,
    );
  }
  const violations = findSingletonViolations(parsed.data.sources);
  if (violations.length > 0) {
    const details = violations
      .map(({ pkg, roots }) =>
        roots.length > 1
          ? `  ${pkg}: ${String(roots.length)} copies bundled (must be 1):\n` +
            roots.map((r) => `    - ${r}`).join("\n")
          : `  ${pkg}: not found in the bundle (expected exactly 1). The ` +
            "sourcemap path format likely changed; update SINGLETON_PACKAGES " +
            "detection in this script.",
      )
      .join("\n\n");
    throw new Error(
      "\nRelease bundle failed the singleton check. A duplicate copy of a " +
        "singleton ships an app that crashes at launch (e.g. two `react` copies " +
        "-> \"Cannot read property 'useEffect' of null\"). Align the version so " +
        "the monorepo resolves one copy, or dedupe it in metro.config.js " +
        "(resolver.resolveRequest). See " +
        "packages/docs/logs/2026-07-24_ios-duplicate-react-startup-crash.md.\n\n" +
        details,
    );
  }
  console.log(
    `Singleton check OK (${SINGLETON_PACKAGES.join(", ")} each bundled exactly once).`,
  );
}

/** Produce the Release bundle + sourcemap and run all assertions. Throws on any
 * failure so the caller's `finally` can clean up the temp dir. */
function runChecks(workDir: string): void {
  const bundleOutput = path.join(workDir, "main.jsbundle");
  const sourcemapOutput = path.join(workDir, "main.jsbundle.map");
  const assetsDest = path.join(workDir, "assets");

  const result = spawnSync(
    "bun",
    [
      "node_modules/react-native/scripts/bundle.js",
      "bundle",
      "--config-cmd",
      "bun node_modules/.bin/react-native config",
      "--entry-file",
      "index.js",
      "--platform",
      "ios",
      "--dev",
      "false",
      "--reset-cache",
      "--bundle-output",
      bundleOutput,
      "--sourcemap-output",
      sourcemapOutput,
      "--assets-dest",
      assetsDest,
      "--minify",
      "false",
    ],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(
      `\nRelease Metro bundle failed (exit ${String(result.status ?? "unknown")}). ` +
        "This is the same bundle Xcode Cloud runs during Archive — an " +
        "UnableToResolveError above means a dependency is not installed where " +
        "Metro looks. If it names a package from a source-only `file:` workspace " +
        "dep (e.g. tasknotes-types), install that dep's node_modules in " +
        "ios/ci_scripts/ci_post_clone.sh (see the xcode-cloud-debug skill).",
    );
  }

  if (!existsSync(bundleOutput)) {
    throw new Error(
      `Release bundle reported success but ${bundleOutput} is missing.`,
    );
  }

  const size = statSync(bundleOutput).size;
  if (size < MIN_BUNDLE_BYTES) {
    throw new Error(
      `Release bundle is only ${String(size)} bytes (< ${String(MIN_BUNDLE_BYTES)}); expected the full graph.`,
    );
  }
  console.log(`Release Metro bundle OK (${String(size)} bytes).`);

  if (!existsSync(sourcemapOutput)) {
    throw new Error(
      `Release bundle succeeded but ${sourcemapOutput} is missing; cannot check for duplicate packages.`,
    );
  }
  assertSingletons(sourcemapOutput);
}

function main(): void {
  const workDir = mkdtempSync(path.join(tmpdir(), "tfo-release-bundle-"));
  try {
    runChecks(workDir);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
