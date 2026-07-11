#!/usr/bin/env bun
/**
 * Release Metro bundle smoke — the CI guard against Xcode Cloud Archive failures.
 *
 * The Xcode Cloud "Bundle React Native code and images" phase runs Metro in
 * Release mode (`--dev false`), which is the ONLY place source-only `file:`
 * workspace deps (and their transitive deps) get resolved for real. A simulator
 * debug build skips this, so a missing dependency passes locally but fails the
 * cloud Archive. This script reproduces that exact bundle in the Buildkite iOS
 * step (pure JS — no macOS needed), so the failure is caught pre-merge.
 *
 * It caught, and guards against recurrence of, the `@tasknotes/model` resolution
 * failure: `tasknotes-types/src/v2.ts` re-exports a dep that must be installed in
 * `packages/tasknotes-types/node_modules` for Metro to find it. See
 * `ios/ci_scripts/ci_post_clone.sh` and the `xcode-cloud-debug` skill.
 *
 * Runs the same bundle for every source-only dependency the app imports — any new
 * unresolvable import fails here regardless of which package introduced it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A real release bundle for this app is ~12 MB; anything under this means Metro
// produced an empty/stub bundle rather than the full dependency graph.
const MIN_BUNDLE_BYTES = 1_000_000;

function main(): void {
  const workDir = mkdtempSync(path.join(tmpdir(), "tfo-release-bundle-"));
  const bundleOutput = path.join(workDir, "main.jsbundle");
  const assetsDest = path.join(workDir, "assets");

  try {
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
        "--assets-dest",
        assetsDest,
        "--minify",
        "false",
      ],
      { stdio: "inherit" },
    );

    if (result.status !== 0) {
      console.error(
        `\nRelease Metro bundle failed (exit ${String(result.status ?? "unknown")}). ` +
          "This is the same bundle Xcode Cloud runs during Archive — an " +
          "UnableToResolveError above means a dependency is not installed where " +
          "Metro looks. If it names a package from a source-only `file:` workspace " +
          "dep (e.g. tasknotes-types), install that dep's node_modules in " +
          "ios/ci_scripts/ci_post_clone.sh (see the xcode-cloud-debug skill).",
      );
      process.exit(1);
    }

    if (!existsSync(bundleOutput)) {
      console.error(
        `Release bundle reported success but ${bundleOutput} is missing.`,
      );
      process.exit(1);
    }

    const size = statSync(bundleOutput).size;
    if (size < MIN_BUNDLE_BYTES) {
      console.error(
        `Release bundle is only ${String(size)} bytes (< ${String(MIN_BUNDLE_BYTES)}); expected the full graph.`,
      );
      process.exit(1);
    }

    console.log(`Release Metro bundle OK (${String(size)} bytes).`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main();
}
