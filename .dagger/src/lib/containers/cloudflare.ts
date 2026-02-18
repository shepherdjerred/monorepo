import {
  dag,
  type Container,
  type Directory,
  type Secret,
} from "@dagger.io/dagger";
import versions from "../versions.ts";

export type CloudflarePagesDeployOptions = {
  /** The built static site directory to deploy */
  distDir: Directory;
  /** The Cloudflare Pages project name */
  projectName: string;
  /** The git branch name */
  branch: string;
  /** The git commit SHA */
  commitHash: string;
  /** Cloudflare account ID as a secret */
  accountId: Secret;
  /** Cloudflare API token as a secret */
  apiToken: Secret;
};

export type CloudflareWorkerDeployOptions = {
  /** The source directory containing the worker and wrangler.toml */
  source: Directory;
  /** The worker entry point file (e.g., "src/worker.ts") */
  entryPoint?: string;
  /** Cloudflare API token as a secret */
  apiToken: Secret;
  /** Optional worker name (overrides wrangler.toml) */
  workerName?: string;
  /** Whether this is a dry-run (default: false) */
  dryRun?: boolean;
};

/**
 * Returns a container configured for Cloudflare Pages deployment.
 *
 * @param customVersion - Optional custom Node.js version to override default
 * @returns A configured container with wrangler ready
 */
export function getCloudflareContainer(customVersion?: string): Container {
  const version = customVersion ?? versions.node;
  return dag.container().from(`node:${version}-slim`).withWorkdir("/workspace");
}

/**
 * Deploys a static site directory to Cloudflare Pages.
 *
 * @param options - Deployment configuration options
 * @returns The deployment output string
 *
 * @example
 * ```ts
 * const output = await deployToCloudflarePages({
 *   distDir: builtSite,
 *   projectName: "my-site",
 *   branch: "main",
 *   commitHash: "abc123",
 *   accountId: dag.setSecret("cf-account", process.env.CF_ACCOUNT_ID),
 *   apiToken: dag.setSecret("cf-token", process.env.CF_API_TOKEN),
 * });
 * ```
 */
export async function deployToCloudflarePages(
  options: CloudflarePagesDeployOptions,
): Promise<string> {
  const container = getCloudflareContainer()
    .withDirectory("/workspace/dist", options.distDir)
    .withSecretVariable("CLOUDFLARE_ACCOUNT_ID", options.accountId)
    .withSecretVariable("CLOUDFLARE_API_TOKEN", options.apiToken)
    .withExec([
      "npx",
      "wrangler@latest",
      "pages",
      "deploy",
      "/workspace/dist",
      `--project-name=${options.projectName}`,
      `--branch=${options.branch}`,
      `--commit-hash=${options.commitHash}`,
    ]);

  return await container.stdout();
}

/**
 * Creates a Cloudflare Pages deployment container without executing it.
 * Useful when you want to compose the deployment with other operations.
 *
 * @param options - Deployment configuration options
 * @returns A configured container ready for deployment
 */
export function getCloudflarePagesDeployContainer(
  options: CloudflarePagesDeployOptions,
): Container {
  return getCloudflareContainer()
    .withDirectory("/workspace/dist", options.distDir)
    .withSecretVariable("CLOUDFLARE_ACCOUNT_ID", options.accountId)
    .withSecretVariable("CLOUDFLARE_API_TOKEN", options.apiToken)
    .withExec([
      "npx",
      "wrangler@latest",
      "pages",
      "deploy",
      "/workspace/dist",
      `--project-name=${options.projectName}`,
      `--branch=${options.branch}`,
      `--commit-hash=${options.commitHash}`,
    ]);
}

/**
 * Deploys a Cloudflare Worker using wrangler.
 *
 * @param options - Deployment configuration options
 * @returns The deployment output string
 *
 * @example
 * ```ts
 * const output = await deployToCloudflareWorker({
 *   source: workerSource,
 *   entryPoint: "src/worker.ts",
 *   apiToken: dag.setSecret("cf-token", process.env.CF_API_TOKEN),
 * });
 * ```
 */
export async function deployToCloudflareWorker(
  options: CloudflareWorkerDeployOptions,
): Promise<string> {
  const container = getCloudflareWorkerDeployContainer(options);
  return await container.stdout();
}

/**
 * Creates a Cloudflare Worker deployment container without executing it.
 * Useful when you want to compose the deployment with other operations.
 *
 * @param options - Deployment configuration options
 * @returns A configured container ready for deployment
 */
export function getCloudflareWorkerDeployContainer(
  options: CloudflareWorkerDeployOptions,
): Container {
  const args = ["npx", "wrangler@latest", "deploy"];

  if (options.entryPoint !== undefined) {
    args.push(options.entryPoint);
  }

  if (options.workerName !== undefined) {
    args.push("--name", options.workerName);
  }

  if (options.dryRun === true) {
    args.push("--dry-run");
  }

  return getCloudflareContainer()
    .withDirectory("/workspace", options.source)
    .withSecretVariable("CLOUDFLARE_API_TOKEN", options.apiToken)
    .withExec(["npm", "ci"])
    .withExec(args);
}
