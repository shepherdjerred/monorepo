/**
 * Miscellaneous helper functions (prettier, shellcheck, mkdocs, caddyfile, smokeTest).
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory } from "@dagger.io/dagger";

import {
  BUN_IMAGE,
  SHELLCHECK_IMAGE,
  CADDY_IMAGE,
  PYTHON_IMAGE,
  BUN_CACHE,
  SOURCE_EXCLUDES,
} from "./constants";

/** Run prettier check across the repo. */
export function prettierHelper(source: Directory): Container {
  return dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, {
      exclude: SOURCE_EXCLUDES,
    })
    .withExec(["bunx", "prettier", "--check", "."]);
}

/** Run shellcheck on all shell scripts. */
export function shellcheckHelper(source: Directory): Container {
  return dag
    .container()
    .from(SHELLCHECK_IMAGE)
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, {
      include: ["**/*.sh"],
      exclude: [
        "**/archive/**",
        "**/node_modules/**",
        "**/Pods/**",
        "**/target/**",
      ],
    })
    .withExec([
      "sh",
      "-c",
      "find /workspace -name '*.sh' -print0 | xargs -0 shellcheck --severity=warning",
    ]);
}

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

/** Generate and validate the Caddyfile for S3 static sites. */
export function caddyfileValidateHelper(source: Directory): Container {
  return dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, { exclude: SOURCE_EXCLUDES })
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withExec([
      "sh",
      "-c",
      "bun run packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts > /tmp/Caddyfile",
    ])
    .withExec([
      "sh",
      "-c",
      [
        `CADDY_URL="https://github.com/caddyserver/caddy/releases/download/v2.9.1/caddy_2.9.1_linux_amd64.tar.gz"`,
        `curl -fsSL "$CADDY_URL" | tar xz -C /usr/local/bin caddy`,
        `caddy validate --config /tmp/Caddyfile`,
      ].join(" && "),
    ]);
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
