import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { installWorkspaceDeps, getPreparedWorkspace } from "@scout-for-lol/.dagger/src/base";

// Helper function for timing
function logWithTimestamp(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

/**
 * Install dependencies for the frontend package
 * @param workspaceSource The full workspace source directory
 * @returns The container with dependencies installed
 */
export function installFrontendDeps(workspaceSource: Directory): Container {
  return installWorkspaceDeps(workspaceSource);
}

/**
 * Run type checking and linting for the frontend package
 * @param workspaceSource The full workspace source directory
 * @param preparedWorkspace Optional pre-prepared container (with deps already installed)
 * @returns The check results container
 */
export function checkFrontend(workspaceSource: Directory, preparedWorkspace?: Container): Container {
  const base = preparedWorkspace ?? getPreparedWorkspace(workspaceSource);
  return base
    .withWorkdir("/workspace/packages/frontend")
    .withExec(["bun", "run", "typecheck"])
    .withExec(["bun", "run", "lint"]);
}

/**
 * Build the frontend for production
 * @param workspaceSource The full workspace source directory
 * @param preparedWorkspace Optional pre-prepared container (with deps already installed)
 * @returns The built dist directory
 */
export function buildFrontend(workspaceSource: Directory, preparedWorkspace?: Container): Directory {
  const base = preparedWorkspace ?? getPreparedWorkspace(workspaceSource);
  const container = base.withWorkdir("/workspace/packages/frontend").withExec(["bun", "run", "build"]);

  return container.directory("/workspace/packages/frontend/dist");
}

/**
 * Build a production container with nginx serving the frontend static files
 * @param workspaceSource The full workspace source directory
 * @param preparedWorkspace Optional pre-prepared container (with deps already installed)
 * @returns A container ready to be published
 */
export function buildFrontendContainer(workspaceSource: Directory, preparedWorkspace?: Container): Container {
  const distDir = buildFrontend(workspaceSource, preparedWorkspace);

  // Build nginx container with static files
  const container = dag
    .container()
    .from("nginx:alpine")
    .withDirectory("/usr/share/nginx/html", distDir)
    .withExposedPort(80);

  logWithTimestamp("Frontend container built successfully");
  return container;
}

type PublishFrontendOptions = {
  workspaceSource: Directory;
  imageName: string;
  ghcrUsername: string;
  ghcrPassword: Secret;
  preparedWorkspace?: Container;
};

/**
 * Publish the frontend container to GHCR
 * @param options Publish options including workspace source, image name, and GHCR credentials
 * @returns The published image reference
 */
export async function publishFrontend(options: PublishFrontendOptions): Promise<string> {
  const container = buildFrontendContainer(options.workspaceSource, options.preparedWorkspace);

  const publishedRef = await container
    .withRegistryAuth("ghcr.io", options.ghcrUsername, options.ghcrPassword)
    .publish(options.imageName);

  logWithTimestamp(`Frontend published: ${publishedRef}`);
  return publishedRef;
}
