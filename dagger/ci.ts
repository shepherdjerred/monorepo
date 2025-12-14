/**
 * CI pipeline for @shepherdjerred/share monorepo
 *
 * Usage:
 *   dagger run bun ./dagger/ci.ts [--publish]
 */

import { dag, connection } from "@dagger.io/dagger";
import { runBunWorkspaceCI, publishToNpm } from "../packages/dagger-utils/src/containers/npm";

const PACKAGES = ["eslint-config", "dagger-utils"] as const;

type CIOptions = {
  publish?: boolean;
};

async function ci(options: CIOptions = {}) {
  const { publish = false } = options;

  console.log("Starting CI pipeline...");

  const source = dag.host().directory(".", {
    exclude: ["node_modules", "**/node_modules", "dist", "**/dist", ".git"],
  });

  // Run CI pipeline using shared utilities
  const result = await runBunWorkspaceCI({
    source,
    typecheck: true,
    lint: false, // No lint scripts in packages yet
    test: true,
    build: true,
  });

  console.log("CI steps completed:", result.steps);

  // Publish if requested
  if (publish) {
    const npmToken = process.env.NPM_TOKEN;
    if (!npmToken) {
      throw new Error("NPM_TOKEN environment variable is required for publishing");
    }

    console.log("Publishing packages to npm...");

    const tokenSecret = dag.setSecret("npm-token", npmToken);

    for (const pkg of PACKAGES) {
      console.log(`Publishing @shepherdjerred/${pkg}...`);

      await publishToNpm({
        container: result.container,
        token: tokenSecret,
        packageDir: `./packages/${pkg}`,
        access: "public",
      });

      console.log(`Published @shepherdjerred/${pkg}`);
    }
  }

  console.log("CI pipeline completed successfully!");
}

// Parse CLI args
const args = process.argv.slice(2);
const shouldPublish = args.includes("--publish");

// Run with connection
await connection(async () => {
  await ci({ publish: shouldPublish });
});
