/**
 * Miscellaneous helper functions (mkdocs, caddyfile, smokeTest).
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, File } from "@dagger.io/dagger";

import {
  BUN_IMAGE,
  CADDY_BUILDER_IMAGE,
  CADDY_IMAGE,
  PYTHON_IMAGE,
  BUN_CACHE,
  GO_BUILD,
  GO_MOD,
  SOURCE_EXCLUDES,
} from "./constants";

/** Build MkDocs documentation site and return the built site/ directory. */
export function mkdocsBuildHelper(source: Directory): Directory {
  return dag
    .container()
    .from(PYTHON_IMAGE)
    .withExec([
      "pip",
      "install",
      "--no-cache-dir",
      "mkdocs-material",
      "mkdocs-minify-plugin",
      "pillow",
      "cairosvg",
    ])
    .withWorkdir("/workspace")
    .withDirectory(
      "/workspace",
      source.directory("packages/discord-plays-pokemon/docs"),
    )
    .withExec(["mkdocs", "build"])
    .directory("/workspace/site");
}

/** Build custom Caddy binary with s3-proxy plugin, using cached Go modules. */
function caddyS3ProxyBinary(): File {
  return dag
    .container()
    .from(CADDY_BUILDER_IMAGE)
    .withMountedCache("/go/pkg/mod", dag.cacheVolume(GO_MOD))
    .withMountedCache("/root/.cache/go-build", dag.cacheVolume(GO_BUILD))
    .withExec([
      "xcaddy",
      "build",
      "--with",
      "github.com/lindenlab/caddy-s3-proxy",
    ])
    .file("/usr/bin/caddy");
}

/** Generate and validate the Caddyfile for S3 static sites. */
export function caddyfileValidateHelper(source: Directory): Container {
  return dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, { exclude: SOURCE_EXCLUDES })
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withWorkdir("/workspace/packages/homelab/src/cdk8s")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withExec([
      "sh",
      "-c",
      "bun run scripts/generate-caddyfile.ts > /tmp/Caddyfile",
    ])
    .withWorkdir("/workspace")
    .withFile("/usr/local/bin/caddy", caddyS3ProxyBinary())
    .withExec(["caddy", "validate", "--config", "/tmp/Caddyfile"]);
}

/** Start a container and verify its health endpoint responds. */
export function smokeTestHelper(
  image: Container,
  port: number = 3000,
  healthPath: string = "/",
  timeoutSeconds: number = 30,
): Container {
  const svc = image.withExposedPort(port).asService();

  return dag
    .container()
    .from(CADDY_IMAGE)
    .withServiceBinding("target", svc)
    .withExec([
      "sh",
      "-c",
      [
        `elapsed=0`,
        `while [ $elapsed -lt ${timeoutSeconds} ]; do`,
        `  if wget -q -O /dev/null "http://target:${port}${healthPath}"; then`,
        `    echo "Health check passed at ${healthPath} after ${"\u0024"}{elapsed}s"`,
        `    exit 0`,
        `  fi`,
        `  sleep 2`,
        `  elapsed=$((elapsed + 2))`,
        `done`,
        `echo "Health check timed out after ${timeoutSeconds}s"`,
        `exit 1`,
      ].join("\n"),
    ]);
}
