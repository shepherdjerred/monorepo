#!/usr/bin/env -S bun
import { Container, Directory, dag } from "@dagger.io/dagger";
import { getWorkspaceContainer } from "./base";
import { execOrThrow } from "./errors";
import { caddyVersionOnly } from "./versions";

/**
 * Creates a prepared CDK8s container with workspace dependencies installed.
 * This is the shared container setup for all CDK8s operations.
 */
export function prepareCdk8sContainer(source: Directory): Container {
  return (
    getWorkspaceContainer(source, "src/cdk8s")
      // Cache TypeScript compilation artifacts
      .withMountedCache("/workspace/node_modules/.cache", dag.cacheVolume("typescript-cache"))
  );
}

export async function typeCheckCdk8s(source: Directory): Promise<string> {
  const container = prepareCdk8sContainer(source);
  return execOrThrow(container, ["bun", "run", "typecheck"]);
}

/**
 * Runs type check using a pre-prepared container.
 */
export function typeCheckCdk8sWithContainer(container: Container): Promise<string> {
  return execOrThrow(container, ["bun", "run", "typecheck"]);
}

export function buildK8sManifests(source: Directory): Directory {
  const builtContainer = prepareCdk8sContainer(source).withExec(["bun", "run", "build"]);
  const manifestsDir = builtContainer.directory("/workspace/src/cdk8s/dist");
  return manifestsDir;
}

/**
 * Builds K8s manifests using a pre-prepared container.
 */
export function buildK8sManifestsWithContainer(container: Container): Directory {
  const builtContainer = container.withExec(["bun", "run", "build"]);
  return builtContainer.directory("/workspace/src/cdk8s/dist");
}

export async function lintCdk8s(source: Directory): Promise<string> {
  const container = prepareCdk8sContainer(source);
  return execOrThrow(container, ["bun", "run", "lint"]);
}

/**
 * Runs lint using a pre-prepared container.
 */
export function lintCdk8sWithContainer(container: Container): Promise<string> {
  return execOrThrow(container, ["bun", "run", "lint"]);
}

export async function testCdk8s(source: Directory): Promise<string> {
  const container = prepareCdk8sContainer(source);
  return execOrThrow(container, ["bun", "run", "test:gpu-resources"]);
}

/**
 * Runs tests using a pre-prepared container.
 * Expects the container to already have the build artifacts.
 */
export function testCdk8sWithContainer(container: Container): Promise<string> {
  return execOrThrow(container, ["bun", "run", "test:gpu-resources"]);
}

/**
 * Builds a Caddy container with the s3proxy plugin for validation.
 * Uses version-only (no digest) because variant tags have different digests than the base image.
 */
function buildCaddyS3ProxyContainer() {
  const builder = dag
    .container()
    .from(`caddy:${caddyVersionOnly}-builder-alpine`)
    .withExec(["xcaddy", "build", "--with", "github.com/lindenlab/caddy-s3-proxy"]);

  const caddyBinary = builder.file("caddy");

  return dag.container().from(`caddy:${caddyVersionOnly}-alpine`).withFile("/usr/bin/caddy", caddyBinary);
}

/**
 * Validates the Caddyfile syntax using caddy validate.
 * Uses the caddy-s3proxy container to ensure the s3proxy directive is recognized.
 */
export async function validateCaddyfile(source: Directory): Promise<string> {
  // First, generate the Caddyfile using bun
  const cdk8sContainer = prepareCdk8sContainer(source);
  const caddyfileContent = await cdk8sContainer.withExec(["bun", "run", "scripts/generate-caddyfile.ts"]).stdout();

  // Then validate it using the caddy-s3proxy container
  const caddyContainer = buildCaddyS3ProxyContainer()
    .withNewFile("/etc/caddy/Caddyfile", caddyfileContent)
    .withExec(["caddy", "validate", "--config", "/etc/caddy/Caddyfile"]);

  return execOrThrow(caddyContainer, ["caddy", "validate", "--config", "/etc/caddy/Caddyfile"]);
}

/**
 * Validates the Caddyfile syntax using a pre-prepared CDK8s container.
 */
export async function validateCaddyfileWithContainer(container: Container): Promise<string> {
  // Generate the Caddyfile
  const caddyfileContent = await container.withExec(["bun", "run", "scripts/generate-caddyfile.ts"]).stdout();

  // Validate using caddy-s3proxy container
  const caddyContainer = buildCaddyS3ProxyContainer().withNewFile("/etc/caddy/Caddyfile", caddyfileContent);

  return execOrThrow(caddyContainer, ["caddy", "validate", "--config", "/etc/caddy/Caddyfile"]);
}
